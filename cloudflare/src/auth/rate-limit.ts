/**
 * Isolate-local fixed-window rate limiter.
 *
 * IMPORTANT: This Map lives in a single Worker isolate. It is NOT a distributed
 * or Cloudflare-edge global limiter. Multiple isolates / POPs can each allow
 * `limit` requests. Callers that need durable cross-isolate behavior must also
 * use D1-backed counters (see AuthService staff login / OTP). Edge / WAF rate
 * limiting remains a PRODUCTION DASHBOARD ACTION REQUIRED.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitEntry>();

/** Max tracked keys to avoid unbounded memory growth in long-lived isolates. */
const MAX_KEYS = 5_000;

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      // Evict expired entries first; if still full, drop oldest insertion.
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
      if (buckets.size >= MAX_KEYS) {
        const first = buckets.keys().next().value;
        if (first !== undefined) buckets.delete(first);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

/**
 * Build a composite abuse key (identity + client IP).
 * Avoids permanent lockouts: windows expire; identity alone and IP alone are also limited.
 */
export function rateLimitKey(parts: { surface: string; identity?: string; ip?: string }): string {
  const identity = (parts.identity ?? "anon").slice(0, 128);
  const ip = (parts.ip ?? "unknown").slice(0, 64);
  return `${parts.surface}:${identity}:${ip}`;
}

export function resetRateLimitsForTests() {
  buckets.clear();
}

/** Topology label for docs/tests — never claim this is distributed. */
export const RATE_LIMIT_TOPOLOGY = "isolate-local-map" as const;
