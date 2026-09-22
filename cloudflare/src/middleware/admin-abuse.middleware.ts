import type { Context, Next } from "hono";
import type { Env } from "../types/bindings";
import { checkRateLimit, rateLimitKey } from "../auth/rate-limit";
import { clientIpFromRequest } from "../config/production-secrets";

/**
 * Isolate-local abuse ceiling for sensitive admin write methods.
 * NOT distributed / NOT edge-global — Cloudflare WAF rate rules remain required.
 * Does not permanently lock accounts; windows expire.
 */
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const LIMIT = 120;
const WINDOW_MS = 15 * 60_000;

export async function adminWriteAbuseMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  if (!WRITE_METHODS.has(c.req.method)) return next();

  const ip = clientIpFromRequest(c.req.raw);
  const key = rateLimitKey({ surface: "admin-write", ip });
  if (!checkRateLimit(key, LIMIT, WINDOW_MS)) {
    return c.json({ error: "Too many requests" }, 429);
  }
  return next();
}
