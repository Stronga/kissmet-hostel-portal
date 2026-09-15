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
 * Require Authorization: Bearer <CONNECTOR_SECRET>.
 * Secret must never appear in query strings, browser bundles, or logs.
 */
export function requireConnectorAuth(secret: string) {
  return async (c: Context, next: Next) => {
    // Reject accidental query-string secret leakage attempts.
    const url = new URL(c.req.url);
    if (url.searchParams.has("secret") || url.searchParams.has("token") || url.searchParams.has("Authorization")) {
      return c.json({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }

    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token || !safeEqual(token, secret)) {
      return c.json({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    return next();
  };
}
