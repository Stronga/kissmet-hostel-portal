import type { Context, Next } from "hono";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Constant-time-ish length mismatch: still compare against self to avoid early return timing side-channel on equal-length path only.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * True when the request carries `Authorization: Bearer <CONNECTOR_SECRET>` and does not
 * try to pass a secret in the query string.
 */
export function isConnectorAuthorized(c: Context, secret: string): boolean {
  // Reject accidental query-string secret leakage attempts.
  const url = new URL(c.req.url);
  if (url.searchParams.has("secret") || url.searchParams.has("token") || url.searchParams.has("Authorization")) {
    return false;
  }
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  return !!token && safeEqual(token, secret);
}

/**
 * Require Authorization: Bearer <CONNECTOR_SECRET>.
 * Secret must never appear in query strings, browser bundles, or logs.
 */
export function requireConnectorAuth(secret: string) {
  return async (c: Context, next: Next) => {
    if (!isConnectorAuthorized(c, secret)) {
      return c.json({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    return next();
  };
}
