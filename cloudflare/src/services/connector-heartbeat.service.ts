import type { Env } from "../types/bindings";

/**
 * Pi → Worker connector heartbeat (Stage pre-Pi, migration 0020).
 *
 * Wire protocol v1 (see docs/CONNECTOR_HEARTBEAT.md):
 *   POST /connector/heartbeat
 *   X-Kissmet-Connector-Id: <lowercase UUID, must be in CONNECTOR_HEARTBEAT_ALLOWED_IDS>
 *   X-Kissmet-Timestamp:    <unix seconds>
 *   X-Kissmet-Nonce:        <16-64 chars [A-Za-z0-9_-]>
 *   X-Kissmet-Signature:    v1=<hex HMAC-SHA256(secret, canonical)>
 *   canonical = "v1\nPOST\n/connector/heartbeat\n<id>\n<ts>\n<nonce>\n<hex sha256(body)>"
 *
 * Replay protection: |now - ts| <= skew window AND ts strictly greater than the last accepted
 * ts for that connector (atomic conditional upsert). Secret rotation: CONNECTOR_HEARTBEAT_SECRET
 * plus optional CONNECTOR_HEARTBEAT_SECRET_PREVIOUS during the overlap window.
 */

export const HEARTBEAT_PATH = "/connector/heartbeat";
export const HEARTBEAT_MAX_BODY_BYTES = 4096;
export const HEARTBEAT_MAX_SKEW_SECONDS = 300;
export const HEARTBEAT_DEFAULT_STALE_SECONDS = 180;
const MIN_SECRET_LENGTH = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SIG_RE = /^v1=([0-9a-f]{64})$/;
const VERSION_RE = /^[A-Za-z0-9._+-]{1,32}$/;
const HOSTNAME_RE = /^[A-Za-z0-9.-]{1,64}$/;

export type HeartbeatRejection =
  | "not_configured"
  | "bad_request"
  | "unauthorized"
  | "stale_timestamp"
  | "replay"
  | "payload_too_large";

export class HeartbeatError extends Error {
  constructor(
    public readonly code: HeartbeatRejection,
    public readonly status: 400 | 401 | 409 | 413 | 503
  ) {
    super(code);
    this.name = "HeartbeatError";
  }
}

export interface HeartbeatPayload {
  version: string | null;
  hostname: string | null;
  connectorStatus: "ok" | "degraded" | "down" | "unknown";
  routerosStatus: "ok" | "unavailable" | "unknown";
  uptimeSeconds: number | null;
}

export interface ConnectorStatusView {
  connectorId: string;
  lastSeenAt: string;
  ageSeconds: number;
  stale: boolean;
  version: string | null;
  hostname: string | null;
  connectorStatus: string;
  routerosStatus: string;
  uptimeSeconds: number | null;
  heartbeatCount: number;
  firstSeenAt: string;
}

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

export function canonicalHeartbeatString(connectorId: string, ts: string, nonce: string, bodySha256Hex: string): string {
  return ["v1", "POST", HEARTBEAT_PATH, connectorId, ts, nonce, bodySha256Hex].join("\n");
}

async function hmacKey(secret: string, usage: Array<"sign" | "verify">) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

/** Sign a heartbeat (used by tests and as the reference for the Pi client). */
export async function signHeartbeat(secret: string, connectorId: string, ts: string, nonce: string, body: Uint8Array): Promise<string> {
  const key = await hmacKey(secret, ["sign"]);
  const canonical = canonicalHeartbeatString(connectorId, ts, nonce, await sha256Hex(body));
  return `v1=${toHex(await crypto.subtle.sign("HMAC", key, enc.encode(canonical)))}`;
}

/** Constant-time verification via WebCrypto HMAC verify, against current and (optional) previous secret. */
async function verifySignature(secrets: string[], canonical: string, sigHex: string): Promise<boolean> {
  const sig = fromHex(sigHex);
  let ok = false;
  for (const s of secrets) {
    const key = await hmacKey(s, ["verify"]);
    // Evaluate every secret (no early exit) so timing does not reveal which one matched.
    const r = await crypto.subtle.verify("HMAC", key, sig, enc.encode(canonical));
    ok = ok || r;
  }
  return ok;
}

export function parseAllowedConnectorIds(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => UUID_RE.test(s))
  );
}

export function heartbeatSecrets(env: Pick<Env, "CONNECTOR_HEARTBEAT_SECRET" | "CONNECTOR_HEARTBEAT_SECRET_PREVIOUS">): string[] {
  return [env.CONNECTOR_HEARTBEAT_SECRET, env.CONNECTOR_HEARTBEAT_SECRET_PREVIOUS]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length >= MIN_SECRET_LENGTH);
}

function optString(v: unknown, re: RegExp): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !re.test(v)) throw new HeartbeatError("bad_request", 400);
  return v;
}

export function parseHeartbeatPayload(bodyText: string): HeartbeatPayload {
  let raw: unknown;
  try {
    raw = bodyText.trim() === "" ? {} : JSON.parse(bodyText);
  } catch {
    throw new HeartbeatError("bad_request", 400);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HeartbeatError("bad_request", 400);
  const o = raw as Record<string, unknown>;
  const connectorStatus = o.connectorStatus ?? "unknown";
  const routerosStatus = o.routerosStatus ?? "unknown";
  if (!["ok", "degraded", "down", "unknown"].includes(connectorStatus as string)) throw new HeartbeatError("bad_request", 400);
  if (!["ok", "unavailable", "unknown"].includes(routerosStatus as string)) throw new HeartbeatError("bad_request", 400);
  let uptimeSeconds: number | null = null;
  if (o.uptimeSeconds !== undefined && o.uptimeSeconds !== null) {
    if (typeof o.uptimeSeconds !== "number" || !Number.isInteger(o.uptimeSeconds) || o.uptimeSeconds < 0 || o.uptimeSeconds > 10 * 365 * 86400) {
      throw new HeartbeatError("bad_request", 400);
    }
    uptimeSeconds = o.uptimeSeconds;
  }
  return {
    version: optString(o.version, VERSION_RE),
    hostname: optString(o.hostname, HOSTNAME_RE),
    connectorStatus: connectorStatus as HeartbeatPayload["connectorStatus"],
    routerosStatus: routerosStatus as HeartbeatPayload["routerosStatus"],
    uptimeSeconds
  };
}

export interface HeartbeatRequestParts {
  connectorId: string | null;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  body: Uint8Array;
  sourceIp: string | null;
}

export class ConnectorHeartbeatService {
  constructor(
    private readonly db: D1Database,
    private readonly env: Pick<
      Env,
      "CONNECTOR_HEARTBEAT_SECRET" | "CONNECTOR_HEARTBEAT_SECRET_PREVIOUS" | "CONNECTOR_HEARTBEAT_ALLOWED_IDS" | "CONNECTOR_HEARTBEAT_STALE_SECONDS"
    >,
    private readonly now: () => number = () => Date.now()
  ) {}

  get configured(): boolean {
    return heartbeatSecrets(this.env).length > 0 && parseAllowedConnectorIds(this.env.CONNECTOR_HEARTBEAT_ALLOWED_IDS).size > 0;
  }

  /** Verify and record one heartbeat. Throws HeartbeatError; never reveals which check failed beyond the code. */
  async accept(req: HeartbeatRequestParts): Promise<{ connectorId: string; acceptedAt: string }> {
    const secrets = heartbeatSecrets(this.env);
    const allowed = parseAllowedConnectorIds(this.env.CONNECTOR_HEARTBEAT_ALLOWED_IDS);
    if (!secrets.length || !allowed.size) throw new HeartbeatError("not_configured", 503);

    if (req.body.byteLength > HEARTBEAT_MAX_BODY_BYTES) throw new HeartbeatError("payload_too_large", 413);

    const connectorId = (req.connectorId ?? "").trim().toLowerCase();
    const ts = (req.timestamp ?? "").trim();
    const nonce = (req.nonce ?? "").trim();
    const sigMatch = SIG_RE.exec((req.signature ?? "").trim());
    if (!UUID_RE.test(connectorId) || !/^\d{9,11}$/.test(ts) || !NONCE_RE.test(nonce) || !sigMatch) {
      throw new HeartbeatError("unauthorized", 401);
    }

    // Signature first (so unauthenticated callers learn nothing about allowlist or clock state).
    const canonical = canonicalHeartbeatString(connectorId, ts, nonce, await sha256Hex(req.body));
    const sigOk = await verifySignature(secrets, canonical, sigMatch[1]);
    if (!sigOk || !allowed.has(connectorId)) throw new HeartbeatError("unauthorized", 401);

    const tsNum = Number(ts);
    const nowSec = Math.floor(this.now() / 1000);
    if (Math.abs(nowSec - tsNum) > HEARTBEAT_MAX_SKEW_SECONDS) throw new HeartbeatError("stale_timestamp", 401);

    const payload = parseHeartbeatPayload(new TextDecoder().decode(req.body));
    const acceptedAt = new Date(this.now()).toISOString();
    const sourceIp = req.sourceIp ? req.sourceIp.slice(0, 64) : null;

    // Atomic monotonic upsert: the UPDATE branch only fires for a strictly newer timestamp.
    const result = await this.db
      .prepare(
        `INSERT INTO connector_heartbeats (
           connector_id, last_heartbeat_ts, last_nonce, last_seen_at, agent_version, hostname,
           connector_status, routeros_status, uptime_seconds, source_ip, heartbeat_count, first_seen_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(connector_id) DO UPDATE SET
           last_heartbeat_ts = excluded.last_heartbeat_ts,
           last_nonce = excluded.last_nonce,
           last_seen_at = excluded.last_seen_at,
           agent_version = excluded.agent_version,
           hostname = excluded.hostname,
           connector_status = excluded.connector_status,
           routeros_status = excluded.routeros_status,
           uptime_seconds = excluded.uptime_seconds,
           source_ip = excluded.source_ip,
           heartbeat_count = connector_heartbeats.heartbeat_count + 1,
           updated_at = excluded.updated_at
         WHERE excluded.last_heartbeat_ts > connector_heartbeats.last_heartbeat_ts`
      )
      .bind(
        connectorId,
        tsNum,
        nonce,
        acceptedAt,
        payload.version,
        payload.hostname,
        payload.connectorStatus,
        payload.routerosStatus,
        payload.uptimeSeconds,
        sourceIp,
        acceptedAt,
        acceptedAt
      )
      .run();

    if (!result.meta || Number(result.meta.changes) < 1) throw new HeartbeatError("replay", 409);
    return { connectorId, acceptedAt };
  }

  staleAfterSeconds(): number {
    const n = Number(this.env.CONNECTOR_HEARTBEAT_STALE_SECONDS ?? HEARTBEAT_DEFAULT_STALE_SECONDS);
    return Number.isInteger(n) && n > 0 ? n : HEARTBEAT_DEFAULT_STALE_SECONDS;
  }

  /** Admin read model (no source IP, nonce, or signature material). */
  async status(): Promise<{ configured: boolean; staleAfterSeconds: number; connectors: ConnectorStatusView[] }> {
    const rows = await this.db
      .prepare(
        `SELECT connector_id, last_seen_at, agent_version, hostname, connector_status, routeros_status,
                uptime_seconds, heartbeat_count, first_seen_at
           FROM connector_heartbeats ORDER BY last_seen_at DESC LIMIT 20`
      )
      .all<Record<string, unknown>>();
    const staleAfter = this.staleAfterSeconds();
    const nowMs = this.now();
    const connectors = (rows.results ?? []).map((r) => {
      const lastSeenAt = String(r.last_seen_at);
      const ageSeconds = Math.max(0, Math.floor((nowMs - Date.parse(lastSeenAt)) / 1000));
      return {
        connectorId: String(r.connector_id),
        lastSeenAt,
        ageSeconds,
        stale: ageSeconds > staleAfter,
        version: (r.agent_version as string | null) ?? null,
        hostname: (r.hostname as string | null) ?? null,
        connectorStatus: String(r.connector_status),
        routerosStatus: String(r.routeros_status),
        uptimeSeconds: r.uptime_seconds === null || r.uptime_seconds === undefined ? null : Number(r.uptime_seconds),
        heartbeatCount: Number(r.heartbeat_count),
        firstSeenAt: String(r.first_seen_at)
      };
    });
    return { configured: this.configured, staleAfterSeconds: staleAfter, connectors };
  }
}
