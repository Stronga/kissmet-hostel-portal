/**
 * Pre-Pi: connector heartbeat (migration 0020) + Worker → connector Cloudflare Access headers.
 * LOCAL/TEST ONLY: sql.js in-memory D1 with all migrations applied. No remote D1, no Pi.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Database } from "sql.js";
import { createSqlJsD1, get, listMigrationFiles, openMigratedDatabase, readMigrationSql } from "./apply-migrations";
import type { Env } from "../src/types/bindings";
import type { AuthUser } from "../src/auth/context";
import type { RoleCode } from "../src/auth/permissions";
import app from "../src/index";
import { internetAccessRoutes } from "../src/routes/internet-access.routes";
import {
  ConnectorHeartbeatService,
  HEARTBEAT_MAX_SKEW_SECONDS,
  HeartbeatError,
  canonicalHeartbeatString,
  parseAllowedConnectorIds,
  signHeartbeat
} from "../src/services/connector-heartbeat.service";
import { resetRateLimitsForTests } from "../src/auth/rate-limit";
import { validateProductionConfig } from "../src/config/production-secrets";
import { ConnectorUnavailableError, MikroTikConnectorClient } from "../src/services/mikrotik-connector.client";

const ID = "3f1c2b9e-8a7d-4c6b-9e5f-0a1b2c3d4e5f";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";
const SECRET = "hb-test-secret-0123456789abcdefghijklmnop";
const PREV = "hb-previous-secret-0123456789abcdefghijkl";
const enc = new TextEncoder();

let db: Database;
let d1: D1Database;
let nowMs: number;

function baseEnv(extra: Partial<Env> = {}): Env {
  return {
    DB: d1,
    DOCUMENTS: {} as R2Bucket,
    APP_NAME: "test",
    APP_ENV: "local",
    APP_VERSION: "0",
    PUBLIC_BASE_URL: "http://localhost",
    CONNECTOR_HEARTBEAT_SECRET: SECRET,
    CONNECTOR_HEARTBEAT_ALLOWED_IDS: ID,
    ...extra
  } as Env;
}

async function signed(opts: {
  id?: string;
  ts?: number;
  nonce?: string;
  body?: unknown;
  secret?: string;
  rawBody?: string;
}) {
  const id = opts.id ?? ID;
  const ts = String(opts.ts ?? Math.floor(nowMs / 1000));
  const nonce = opts.nonce ?? `n${crypto.randomUUID().replace(/-/g, "")}`;
  const bodyText = opts.rawBody ?? JSON.stringify(opts.body ?? { version: "0.1.0", hostname: "kissmet-pi", connectorStatus: "ok", routerosStatus: "ok", uptimeSeconds: 42 });
  const body = enc.encode(bodyText);
  const signature = await signHeartbeat(opts.secret ?? SECRET, id, ts, nonce, body);
  return { connectorId: id, timestamp: ts, nonce, signature, body, sourceIp: "203.0.113.7" };
}

beforeEach(async () => {
  db = await openMigratedDatabase();
  d1 = createSqlJsD1(db);
  nowMs = Date.UTC(2026, 10, 22, 12, 0, 0);
  resetRateLimitsForTests();
});

afterEach(() => db.close());

describe("migration 0020", () => {
  it("is the next forward migration after 0019 and is additive", () => {
    const files = listMigrationFiles();
    expect(files).toContain("0020_connector_heartbeats.sql");
    expect(files.indexOf("0020_connector_heartbeats.sql")).toBe(files.indexOf("0019_agreement_aware_allocations.sql") + 1);
    const sql = readMigrationSql("0020_connector_heartbeats.sql");
    expect(sql).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE)\b/i);
  });

  it("creates connector_heartbeats with constraints", () => {
    const cols = (db.exec("PRAGMA table_info(connector_heartbeats)")[0].values as unknown[][]).map((r) => r[1]);
    expect(cols).toEqual(expect.arrayContaining(["connector_id", "last_heartbeat_ts", "last_nonce", "last_seen_at", "connector_status", "routeros_status", "heartbeat_count"]));
    expect(() => db.run(`INSERT INTO connector_heartbeats (connector_id, last_heartbeat_ts, last_nonce, last_seen_at) VALUES ('NOT-A-UUID', 1, 'nnnnnnnnnnnnnnnn', 'x')`)).toThrow();
    expect(() => db.run(`INSERT INTO connector_heartbeats (connector_id, last_heartbeat_ts, last_nonce, last_seen_at, connector_status) VALUES (?, 1, 'nnnnnnnnnnnnnnnn', 'x', 'bogus')`, [ID])).toThrow();
  });

  it("applies cleanly on a database migrated through 0019 with data present", async () => {
    const pre = await openMigratedDatabase("0019_agreement_aware_allocations.sql");
    const before = (pre.exec("SELECT count(*) FROM sqlite_master WHERE type='table'")[0].values[0][0]) as number;
    pre.run(readMigrationSql("0020_connector_heartbeats.sql"));
    const after = (pre.exec("SELECT count(*) FROM sqlite_master WHERE type='table'")[0].values[0][0]) as number;
    expect(after).toBe(before + 1);
    // Idempotent (IF NOT EXISTS)
    pre.run(readMigrationSql("0020_connector_heartbeats.sql"));
    pre.close();
  });
});

describe("ConnectorHeartbeatService.accept", () => {
  const svc = (env: Partial<Env> = {}) => new ConnectorHeartbeatService(d1, baseEnv(env), () => nowMs);

  it("accepts a valid signed heartbeat and records last-seen", async () => {
    const r = await svc().accept(await signed({}));
    expect(r.connectorId).toBe(ID);
    const row = get<Record<string, unknown>>(db, "SELECT * FROM connector_heartbeats WHERE connector_id = ?", [ID])!;
    expect(row).toMatchObject({ agent_version: "0.1.0", hostname: "kissmet-pi", connector_status: "ok", routeros_status: "ok", uptime_seconds: 42, heartbeat_count: 1, source_ip: "203.0.113.7" });
    expect(row.last_seen_at).toBe(new Date(nowMs).toISOString());
  });

  it("upserts one row per connector and counts heartbeats", async () => {
    await svc().accept(await signed({}));
    nowMs += 60_000;
    await svc().accept(await signed({ body: { connectorStatus: "degraded", routerosStatus: "unavailable" } }));
    const rows = db.exec("SELECT heartbeat_count, connector_status, routeros_status FROM connector_heartbeats")[0].values;
    expect(rows).toEqual([[2, "degraded", "unavailable"]]);
  });

  it("rejects an exact replay and any non-increasing timestamp (409)", async () => {
    const hb = await signed({});
    await svc().accept(hb);
    await expect(svc().accept(hb)).rejects.toMatchObject({ code: "replay", status: 409 });
    const older = await signed({ ts: Math.floor(nowMs / 1000) - 10 });
    await expect(svc().accept(older)).rejects.toMatchObject({ code: "replay" });
    const row = get<{ heartbeat_count: number }>(db, "SELECT heartbeat_count FROM connector_heartbeats")!;
    expect(row.heartbeat_count).toBe(1);
  });

  it("rejects timestamps outside the skew window (reported as unauthorized)", async () => {
    const s = Math.floor(nowMs / 1000);
    for (const ts of [s - HEARTBEAT_MAX_SKEW_SECONDS - 1, s + HEARTBEAT_MAX_SKEW_SECONDS + 1]) {
      await expect(svc().accept(await signed({ ts }))).rejects.toMatchObject({ code: "stale_timestamp", status: 401 });
    }
    await expect(svc().accept(await signed({ ts: s - HEARTBEAT_MAX_SKEW_SECONDS }))).resolves.toBeTruthy();
  });

  it("rejects bad signatures, wrong secret, tampered body or headers", async () => {
    await expect(svc().accept(await signed({ secret: "x".repeat(40) }))).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    const hb = await signed({});
    await expect(svc().accept({ ...hb, body: enc.encode('{"connectorStatus":"down"}') })).rejects.toMatchObject({ code: "unauthorized" });
    await expect(svc().accept({ ...hb, nonce: hb.nonce + "x" })).rejects.toMatchObject({ code: "unauthorized" });
    await expect(svc().accept({ ...hb, timestamp: String(Number(hb.timestamp) + 1) })).rejects.toMatchObject({ code: "unauthorized" });
    expect(db.exec("SELECT count(*) FROM connector_heartbeats")[0].values[0][0]).toBe(0);
  });

  it("rejects malformed headers before doing any work", async () => {
    const hb = await signed({});
    for (const bad of [
      { connectorId: null },
      { connectorId: "not-a-uuid" },
      { timestamp: "abc" },
      { timestamp: null },
      { nonce: "short" },
      { nonce: "has spaces in it!!!!" },
      { signature: "deadbeef" },
      { signature: null }
    ]) {
      await expect(svc().accept({ ...hb, ...bad })).rejects.toMatchObject({ code: "unauthorized" });
    }
  });

  it("rejects a correctly signed heartbeat from a connector that is not allowlisted", async () => {
    await expect(svc().accept(await signed({ id: OTHER_ID }))).rejects.toMatchObject({ code: "unauthorized" });
    await expect(svc({ CONNECTOR_HEARTBEAT_ALLOWED_IDS: `${ID}, ${OTHER_ID.toUpperCase()}` }).accept(await signed({ id: OTHER_ID }))).resolves.toBeTruthy();
  });

  it("accepts the previous secret during rotation only when configured", async () => {
    await expect(svc().accept(await signed({ secret: PREV }))).rejects.toMatchObject({ code: "unauthorized" });
    await expect(svc({ CONNECTOR_HEARTBEAT_SECRET_PREVIOUS: PREV }).accept(await signed({ secret: PREV }))).resolves.toBeTruthy();
  });

  it("fails closed (503) when the secret or allowlist is missing or the secret is too short", async () => {
    for (const env of [
      { CONNECTOR_HEARTBEAT_SECRET: undefined },
      { CONNECTOR_HEARTBEAT_SECRET: "short-secret" },
      { CONNECTOR_HEARTBEAT_ALLOWED_IDS: undefined },
      { CONNECTOR_HEARTBEAT_ALLOWED_IDS: "not-a-uuid" }
    ]) {
      const s = svc(env as Partial<Env>);
      expect(s.configured).toBe(false);
      await expect(s.accept(await signed({}))).rejects.toMatchObject({ code: "not_configured", status: 503 });
    }
  });

  it("validates the signed payload strictly", async () => {
    for (const body of [
      { connectorStatus: "great" },
      { routerosStatus: "ok!" },
      { version: "x".repeat(40) },
      { hostname: "bad host" },
      { uptimeSeconds: -1 },
      { uptimeSeconds: 1.5 },
      [1, 2]
    ]) {
      nowMs += 1000;
      await expect(svc().accept(await signed({ body }))).rejects.toMatchObject({ code: "bad_request", status: 400 });
    }
    nowMs += 1000;
    await expect(svc().accept(await signed({ rawBody: "{not json" }))).rejects.toMatchObject({ code: "bad_request" });
    nowMs += 1000;
    await expect(svc().accept(await signed({ rawBody: "" }))).resolves.toBeTruthy();
  });

  it("rejects oversized bodies (413)", async () => {
    await expect(svc().accept(await signed({ rawBody: JSON.stringify({ pad: "x".repeat(5000) }) }))).rejects.toMatchObject({ code: "payload_too_large", status: 413 });
  });

  it("canonical string and allowlist parsing are stable", () => {
    expect(canonicalHeartbeatString(ID, "1790000000", "nonce-0123456789ab", "ab")).toBe(`v1\nPOST\n/connector/heartbeat\n${ID}\n1790000000\nnonce-0123456789ab\nab`);
    expect([...parseAllowedConnectorIds(` ${ID.toUpperCase()} ,junk,, ${OTHER_ID}`)]).toEqual([ID, OTHER_ID]);
  });
});

describe("POST /connector/heartbeat (Worker app)", () => {
  async function post(hb: Awaited<ReturnType<typeof signed>>, env: Partial<Env> = {}, headers: Record<string, string> = {}) {
    return app.fetch(
      new Request("http://api/connector/heartbeat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kissmet-Connector-Id": hb.connectorId,
          "X-Kissmet-Timestamp": hb.timestamp,
          "X-Kissmet-Nonce": hb.nonce,
          "X-Kissmet-Signature": hb.signature,
          ...headers
        },
        body: hb.body
      }),
      baseEnv(env)
    );
  }

  it("200 for a valid heartbeat (real clock), then 409 on replay", async () => {
    nowMs = Date.now();
    const hb = await signed({});
    const res = await post(hb);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
    const replay = await post(hb);
    expect(replay.status).toBe(409);
  });

  it("401 with a generic body for bad signature; never echoes secrets or headers", async () => {
    nowMs = Date.now();
    const hb = await signed({ secret: "y".repeat(40) });
    const res = await post(hb);
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).toContain('"code":"unauthorized"');
    expect(text).not.toContain(hb.signature.slice(3, 20));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(ID);
  });

  it("stale timestamp is indistinguishable from a bad signature to the caller", async () => {
    nowMs = Date.now() - 3600_000;
    const res = await post(await signed({}));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('"code":"unauthorized"');
  });

  it("503 when not configured", async () => {
    nowMs = Date.now();
    const res = await post(await signed({}), { CONNECTOR_HEARTBEAT_SECRET: undefined });
    expect(res.status).toBe(503);
  });

  it("413 on a declared oversized body", async () => {
    nowMs = Date.now();
    const res = await post(await signed({}), {}, { "Content-Length": "999999" });
    expect(res.status).toBe(413);
  });

  it("429 after 60 requests per minute per IP (isolate-local brake)", async () => {
    nowMs = Date.now();
    const hb = await signed({ secret: "z".repeat(40) });
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await post(hb, {}, { "CF-Connecting-IP": "198.51.100.9" })).status;
    expect(last).toBe(429);
  });

  it("GET is not routed", async () => {
    const res = await app.fetch(new Request("http://api/connector/heartbeat"), baseEnv());
    expect(res.status).toBe(404);
  });
});

describe("GET /admin/internet-access/connector-status", () => {
  function staff(role: RoleCode): AuthUser {
    return { id: 1, userType: "staff", displayName: role, email: null, role, staffId: 1, residentId: null, sessionId: 1 };
  }
  function adminApp(role: RoleCode) {
    const a = new Hono<{ Bindings: Env; Variables: { authUser: AuthUser } }>();
    a.use("*", async (c, next) => {
      c.set("authUser", staff(role));
      await next();
    });
    a.route("/", internetAccessRoutes);
    return a;
  }

  it("returns last-seen, age and stale flag for internet:read roles, without nonce/IP", async () => {
    const svc = new ConnectorHeartbeatService(d1, baseEnv(), () => nowMs);
    const realNow = Date.now();
    nowMs = realNow - 600_000; // heartbeat 10 minutes ago → stale (default 180 s)
    await svc.accept(await signed({}));
    const res = await adminApp("manager").fetch(new Request("http://api/internet-access/connector-status"), baseEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { configured: boolean; staleAfterSeconds: number; connectors: Array<Record<string, unknown>> } };
    expect(body.data.configured).toBe(true);
    expect(body.data.staleAfterSeconds).toBe(180);
    expect(body.data.connectors).toHaveLength(1);
    const c0 = body.data.connectors[0];
    expect(c0).toMatchObject({ connectorId: ID, stale: true, connectorStatus: "ok", routerosStatus: "ok", heartbeatCount: 1, version: "0.1.0" });
    expect(c0.ageSeconds as number).toBeGreaterThanOrEqual(599);
    expect(JSON.stringify(body)).not.toMatch(/203\.0\.113\.7|last_nonce|nonce|source_ip/);
  });

  it("is forbidden for roles without internet:read", async () => {
    const res = await adminApp("maintenance").fetch(new Request("http://api/internet-access/connector-status"), baseEnv());
    expect(res.status).toBe(403);
  });

  it("honours CONNECTOR_HEARTBEAT_STALE_SECONDS and falls back on invalid values", () => {
    expect(new ConnectorHeartbeatService(d1, baseEnv({ CONNECTOR_HEARTBEAT_STALE_SECONDS: "600" })).staleAfterSeconds()).toBe(600);
    expect(new ConnectorHeartbeatService(d1, baseEnv({ CONNECTOR_HEARTBEAT_STALE_SECONDS: "-5" })).staleAfterSeconds()).toBe(180);
  });
});

describe("Worker → connector Cloudflare Access service token", () => {
  function capture(status = 200, payload: unknown = { ok: true, data: { process: "ok", routeros: "ok" } }) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(payload === null ? "<html>login</html>" : JSON.stringify(payload), { status, headers: status >= 300 && status < 400 ? { Location: "https://kissmet.cloudflareaccess.com/login" } : {} });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("sends CF-Access-Client-Id/Secret when both are configured, and never follows redirects", async () => {
    const { calls, fetchImpl } = capture();
    const env = baseEnv({ MIKROTIK_CONNECTOR_URL: "https://connector.example", MIKROTIK_CONNECTOR_SECRET: "sec", MIKROTIK_CONNECTOR_ACCESS_CLIENT_ID: "abc.access", MIKROTIK_CONNECTOR_ACCESS_CLIENT_SECRET: "access-secret-value" });
    await MikroTikConnectorClient.fromEnv(env, fetchImpl).health();
    const h = calls[0].init!.headers as Record<string, string>;
    expect(h["CF-Access-Client-Id"]).toBe("abc.access");
    expect(h["CF-Access-Client-Secret"]).toBe("access-secret-value");
    expect(h.Authorization).toBe("Bearer sec");
    expect(calls[0].init!.redirect).toBe("manual");
    expect(calls[0].url).not.toMatch(/access-secret-value/);
  });

  it("sends no Access headers when unset or half-configured", async () => {
    for (const extra of [{}, { MIKROTIK_CONNECTOR_ACCESS_CLIENT_ID: "abc.access" }, { MIKROTIK_CONNECTOR_ACCESS_CLIENT_SECRET: "s" }]) {
      const { calls, fetchImpl } = capture();
      await MikroTikConnectorClient.fromEnv(baseEnv({ MIKROTIK_CONNECTOR_URL: "https://connector.example", MIKROTIK_CONNECTOR_SECRET: "sec", ...extra }), fetchImpl).health();
      const h = calls[0].init!.headers as Record<string, string>;
      expect(h).not.toHaveProperty("CF-Access-Client-Id");
      expect(h).not.toHaveProperty("CF-Access-Client-Secret");
    }
  });

  it("maps an Access 302 login redirect or 403 to ConnectorUnavailableError", async () => {
    for (const status of [302, 403]) {
      const { fetchImpl } = capture(status, null);
      const client = new MikroTikConnectorClient("https://connector.example", "sec", fetchImpl);
      await expect(client.health()).rejects.toBeInstanceOf(ConnectorUnavailableError);
      await expect(client.health()).rejects.toThrow(/access denied/);
    }
  });

  it("production config flags a half-configured Access token (high) and a missing one (medium)", () => {
    const prodEnv = (extra: Partial<Env>) =>
      ({
        APP_ENV: "production",
        SMS_PROVIDER: "arkesel",
        ARKESEL_API_KEY: "k",
        ARKESEL_SENDER_ID: "KISSMET",
        ADMIN_ALLOWED_ORIGINS: "https://admin.kissmetgroup.org",
        PUBLIC_BASE_URL: "https://api.kissmetgroup.org",
        MIKROTIK_CONNECTOR_URL: "https://connector.kissmetgroup.org",
        MIKROTIK_CONNECTOR_SECRET: "s".repeat(40),
        ...extra
      }) as Env;
    const codes = (e: Env) => validateProductionConfig(e).map((i) => `${i.code}:${i.severity}`);
    expect(codes(prodEnv({}))).toContain("connector_access_missing:medium");
    expect(codes(prodEnv({ MIKROTIK_CONNECTOR_ACCESS_CLIENT_ID: "a" }))).toContain("connector_access_partial:high");
    expect(codes(prodEnv({ MIKROTIK_CONNECTOR_ACCESS_CLIENT_ID: "a", MIKROTIK_CONNECTOR_ACCESS_CLIENT_SECRET: "b" })).filter((c) => c.startsWith("connector_access"))).toEqual([]);
    expect(codes(prodEnv({ CONNECTOR_HEARTBEAT_SECRET: "short" }))).toContain("heartbeat_secret_short:high");
    expect(codes(prodEnv({ CONNECTOR_HEARTBEAT_SECRET: "h".repeat(40) }))).toContain("heartbeat_ids_missing:medium");
  });
});

it("HeartbeatError carries only a code", () => {
  const e = new HeartbeatError("replay", 409);
  expect(e.message).toBe("replay");
});
