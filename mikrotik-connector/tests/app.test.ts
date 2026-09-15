import { describe, expect, it, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { MockRouterOsClient } from "../src/routeros/mock-client.js";
import type { ConnectorConfig } from "../src/config.js";
import { DEFAULT_PROFILE_NAME, RESIDENT_PROFILE_NAME, loadConfig } from "../src/config.js";
import { RouterOsUnavailableError } from "../src/routeros/types.js";
import { log } from "../src/logger.js";

const config: ConnectorConfig = {
  port: 8788,
  bindHost: "127.0.0.1",
  connectorSecret: "test-connector-secret-with-enough-length",
  mikrotikHost: "192.168.88.1",
  mikrotikApiPort: 8728,
  mikrotikApiUser: "portal-api",
  mikrotikApiPassword: "unused",
  mode: "local",
  maxBodyBytes: 16 * 1024,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 120,
  routerosTimeoutMs: 10_000
};

describe("connector HTTP API", () => {
  let client: MockRouterOsClient;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    client = new MockRouterOsClient();
    client.profiles.set(DEFAULT_PROFILE_NAME, { id: "*0", name: DEFAULT_PROFILE_NAME, sharedUsers: 250 });
    app = createApp(config, client);
  });

  function authHeaders(json = false): Record<string, string> {
    return {
      Authorization: `Bearer ${config.connectorSecret}`,
      ...(json ? { "Content-Type": "application/json" } : {})
    };
  }

  it("rejects missing bearer auth", async () => {
    const res = await app.request("/v1/ensureResidentProfile", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("rejects wrong bearer auth", async () => {
    const res = await app.request("/v1/ensureResidentProfile", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret-value-here" }
    });
    expect(res.status).toBe(401);
  });

  it("rejects secret in query string", async () => {
    const res = await app.request(`/v1/ensureResidentProfile?secret=${config.connectorSecret}`, {
      method: "POST",
      headers: authHeaders()
    });
    expect(res.status).toBe(401);
  });

  it("process health works without auth and without RouterOS", async () => {
    const unavailable: MockRouterOsClient = Object.assign(client, {
      health: async () => {
        throw new RouterOsUnavailableError("should not be called");
      }
    });
    const localApp = createApp(config, unavailable);
    const res = await localApp.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("up");
  });

  it("authenticated deep health returns redacted RouterOS info", async () => {
    const res = await app.request("/v1/health", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(body.ok).toBe(true);
    expect(body.data.routeros).toBe("reachable");
    expect(JSON.stringify(body)).not.toMatch(/password|CONNECTOR_SECRET|Bearer /i);
  });

  it("deep health maps RouterOS unavailable to 503 without secrets", async () => {
    const failing = new MockRouterOsClient();
    failing.health = async () => {
      throw new RouterOsUnavailableError("down");
    };
    const localApp = createApp(config, failing);
    const res = await localApp.request("/v1/health", { headers: authHeaders() });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toMatch(/portal-api|unused|test-connector-secret/i);
  });

  it("ensures profile with auth", async () => {
    const res = await app.request("/v1/ensureResidentProfile", {
      method: "POST",
      headers: authHeaders()
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { profile: { sharedUsers: number } } };
    expect(body.ok).toBe(true);
    expect(body.data.profile.sharedUsers).toBe(3);
  });

  it("maps profile conflict to 409", async () => {
    client.profiles.set(RESIDENT_PROFILE_NAME, { id: "*9", name: RESIDENT_PROFILE_NAME, sharedUsers: 99 });
    const res = await app.request("/v1/ensureResidentProfile", { method: "POST", headers: authHeaders() });
    expect(res.status).toBe(409);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe("profile_conflict");
  });

  it("creates, enables, disables, resets, lists sessions, and disconnects", async () => {
    const headers = authHeaders(true);
    const create = await app.request("/v1/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "KSM-RES-0099", password: "temp-pass" })
    });
    expect(create.status).toBe(201);

    const disable = await app.request("/v1/users/KSM-RES-0099/disable", { method: "POST", headers });
    expect(disable.status).toBe(200);
    const disabledBody = await disable.json() as { data: { disabled: boolean } };
    expect(disabledBody.data.disabled).toBe(true);

    const enable = await app.request("/v1/users/KSM-RES-0099/enable", { method: "POST", headers });
    expect((await enable.json() as { data: { disabled: boolean } }).data.disabled).toBe(false);

    const reset = await app.request("/v1/users/KSM-RES-0099/reset-password", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "new-temp" })
    });
    expect(reset.status).toBe(200);
    expect(client.passwords.get("KSM-RES-0099")).toBe("new-temp");

    client.sessions.set("KSM-RES-0099", [{ id: "*1", user: "KSM-RES-0099", address: "10.0.0.9" }]);
    const sessions = await app.request("/v1/users/KSM-RES-0099/sessions", { headers });
    expect(((await sessions.json()) as { data: unknown[] }).data).toHaveLength(1);

    const disconnect = await app.request("/v1/users/KSM-RES-0099/disconnect", { method: "POST", headers });
    expect(((await disconnect.json()) as { data: { disconnected: number } }).data.disconnected).toBe(1);
  });

  it("maps missing user to 404", async () => {
    const res = await app.request("/v1/users/KSM-RES-missing/disable", {
      method: "POST",
      headers: authHeaders()
    });
    expect(res.status).toBe(404);
  });

  it("rejects oversized JSON bodies", async () => {
    const huge = "x".repeat(20 * 1024);
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: {
        ...authHeaders(true),
        "content-length": String(huge.length + 64)
      },
      body: JSON.stringify({ username: "KSM-RES-0001", password: huge })
    });
    expect(res.status).toBe(413);
  });

  it("unknown authenticated route returns 404", async () => {
    const res = await app.request("/v1/not-a-real-route", { headers: authHeaders() });
    expect(res.status).toBe(404);
  });

  it("sets correlation id header", async () => {
    const res = await app.request("/health", { headers: { "x-correlation-id": "corr-test-1" } });
    expect(res.headers.get("x-correlation-id")).toBe("corr-test-1");
  });
});

describe("loadConfig production gates", () => {
  it("requires CONNECTOR_SECRET", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/CONNECTOR_SECRET/);
  });

  it("rejects short secrets in production", () => {
    expect(() =>
      loadConfig({
        CONNECTOR_SECRET: "short",
        CONNECTOR_MODE: "production",
        MIKROTIK_API_PASSWORD: "router-pass"
      } as NodeJS.ProcessEnv)
    ).toThrow(/at least 32/);
  });

  it("rejects missing RouterOS password in production", () => {
    expect(() =>
      loadConfig({
        CONNECTOR_SECRET: "a".repeat(32),
        CONNECTOR_MODE: "production"
      } as NodeJS.ProcessEnv)
    ).toThrow(/MIKROTIK_API_PASSWORD/);
  });

  it("loads local mode with defaults", () => {
    const cfg = loadConfig({
      CONNECTOR_SECRET: "local-dev-secret-value"
    } as NodeJS.ProcessEnv);
    expect(cfg.mode).toBe("local");
    expect(cfg.bindHost).toBe("127.0.0.1");
    expect(cfg.mikrotikHost).toBe("192.168.88.1");
  });
});

describe("log redaction", () => {
  it("redacts secret-bearing keys and bearer values", () => {
    const redacted = log._redactForTest({
      password: "hotspot-secret",
      CONNECTOR_SECRET: "abc",
      Authorization: "Bearer super-secret-token-value",
      ok: true,
      nested: { token: "xyz", username: "KSM-RES-0001" }
    }) as Record<string, unknown>;
    expect(redacted.password).toBe("[redacted]");
    expect(redacted.CONNECTOR_SECRET).toBe("[redacted]");
    expect(redacted.Authorization).toBe("[redacted]");
    expect((redacted.nested as Record<string, unknown>).token).toBe("[redacted]");
    expect((redacted.nested as Record<string, unknown>).username).toBe("KSM-RES-0001");
  });
});
