import type { Context, Next } from "hono";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory per-IP rate limit for a single-host connector.
 * Not a WAF substitute — reverse proxy / host firewall remain primary.
 */
export function createRateLimiter(windowMs: number, max: number) {
  const buckets = new Map<string, Bucket>();

  function prune(now: number) {
    if (buckets.size < 500) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return async (c: Context, next: Next) => {
    const now = Date.now();
    prune(now);
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip")?.trim() ||
      "local";
    let bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return c.json(
        { ok: false, error: { code: "rate_limited", message: "Too many requests" } },
        429
      );
    }
    return next();
  };
}
