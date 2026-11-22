import { Hono } from "hono";
import type { Env } from "../types/bindings";
import { clientIpFromRequest } from "../config/production-secrets";
import { checkRateLimit, rateLimitKey } from "../auth/rate-limit";
import {
  ConnectorHeartbeatService,
  HEARTBEAT_MAX_BODY_BYTES,
  HeartbeatError
} from "../services/connector-heartbeat.service";
import { newCorrelationId } from "../http/safe-log";

/**
 * Machine-to-machine routes for the on-site Pi. Not browser-facing: no cookies/sessions,
 * HMAC-signed requests only (see ConnectorHeartbeatService).
 */
export const connectorRoutes = new Hono<{ Bindings: Env }>();

const PUBLIC_MESSAGES: Record<string, string> = {
  not_configured: "Heartbeat endpoint not configured",
  bad_request: "Invalid heartbeat",
  unauthorized: "Unauthorized",
  stale_timestamp: "Unauthorized",
  replay: "Duplicate heartbeat",
  payload_too_large: "Payload too large",
  rate_limited: "Too many requests"
};

function reject(code: string, status: 400 | 401 | 409 | 413 | 429 | 503) {
  return Response.json(
    { ok: false, error: { code: code === "stale_timestamp" ? "unauthorized" : code, message: PUBLIC_MESSAGES[code], correlationId: newCorrelationId() } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

connectorRoutes.post("/heartbeat", async (c) => {
  const ip = clientIpFromRequest(c.req.raw);
  // Isolate-local abuse brake (60/min/IP); edge WAF rate limiting is the durable control.
  if (!checkRateLimit(rateLimitKey({ surface: "connector-heartbeat", ip }), 60, 60_000)) {
    return reject("rate_limited", 429);
  }

  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > HEARTBEAT_MAX_BODY_BYTES) return reject("payload_too_large", 413);
  const body = new Uint8Array(await c.req.arrayBuffer());

  const service = new ConnectorHeartbeatService(c.env.DB, c.env);
  try {
    const result = await service.accept({
      connectorId: c.req.header("x-kissmet-connector-id") ?? null,
      timestamp: c.req.header("x-kissmet-timestamp") ?? null,
      nonce: c.req.header("x-kissmet-nonce") ?? null,
      signature: c.req.header("x-kissmet-signature") ?? null,
      body,
      sourceIp: ip === "unknown" ? null : ip
    });
    return c.json({ ok: true, data: { acceptedAt: result.acceptedAt } }, 200, { "Cache-Control": "no-store" });
  } catch (e) {
    if (e instanceof HeartbeatError) return reject(e.code, e.status);
    return Response.json(
      { ok: false, error: { code: "internal_error", message: "Internal error", correlationId: newCorrelationId() } },
      { status: 500 }
    );
  }
});
