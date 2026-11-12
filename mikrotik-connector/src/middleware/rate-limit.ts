import type { Context, Next } from "hono";
import { isConnectorAuthorized } from "./auth.js";
import { clientKey } from "./client-key.js";
import { log } from "../logger.js";

interface Bucket {
  count: number;
  resetAt: number;
}

/** Fixed-window in-memory counter keyed by client key. Single-host connector only. */
class WindowCounter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly windowMs: number) {}

  private prune(now: number) {
    if (this.buckets.size < 500) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  private bucket(key: string, now: number): Bucket {
    this.prune(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  count(key: string, now = Date.now()): Bucket {
    return this.bucket(key, now);
  }

  hit(key: string, now = Date.now()): Bucket {
    const bucket = this.bucket(key, now);
    bucket.count += 1;
    return bucket;
  }
}

function tooMany(c: Context, bucket: Bucket) {
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
  c.header("Retry-After", String(retryAfter));
  return c.json({ ok: false, error: { code: "rate_limited", message: "Too many requests" } }, 429);
}

export interface GuardOptions {
  secret: string;
  windowMs: number;
  /** Max authenticated requests per client key per window (RATE_LIMIT_MAX). */
  max: number;
  /** Max failed-auth (401) attempts per client key per window before lockout (AUTH_FAIL_RATE_LIMIT_MAX). */
  authFailMax: number;
  /** TRUST_PROXY. */
  trustProxy: boolean;
}

/**
 * Combined auth + rate-limit guard for /v1 (F4).
 *
 * 1. If the client key has already used up its failed-auth budget in this window → 429
 *    (lockout; the token is not even compared, so guessing gets no feedback).
 * 2. Check Bearer auth. On failure → count a failed attempt, 401.
 * 3. On success → count against the authenticated budget (RATE_LIMIT_MAX); over → 429.
 *
 * Unauthenticated requests never consume the authenticated budget, and spoofed
 * forwarding headers do not change the key unless TRUST_PROXY is on (see client-key.ts).
 */
export function createAuthRateGuard(opts: GuardOptions) {
  const failures = new WindowCounter(opts.windowMs);
  const authenticated = new WindowCounter(opts.windowMs);

  return async (c: Context, next: Next) => {
    const key = clientKey(c, opts.trustProxy);

    const failBucket = failures.count(key);
    if (failBucket.count >= opts.authFailMax) {
      return tooMany(c, failBucket);
    }

    if (!isConnectorAuthorized(c, opts.secret)) {
      const after = failures.hit(key);
      if (after.count === opts.authFailMax) {
        log.warn("auth_failure_lockout", { windowMs: opts.windowMs, max: opts.authFailMax });
      }
      return c.json({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }

    const okBucket = authenticated.hit(key);
    if (okBucket.count > opts.max) {
      return tooMany(c, okBucket);
    }
    return next();
  };
}

/**
 * Legacy per-key request limiter (counts every request). Kept for compatibility;
 * the app now uses createAuthRateGuard. Never trusts forwarding headers unless trustProxy.
 */
export function createRateLimiter(windowMs: number, max: number, trustProxy = false) {
  const counter = new WindowCounter(windowMs);
  return async (c: Context, next: Next) => {
    const bucket = counter.hit(clientKey(c, trustProxy));
    if (bucket.count > max) return tooMany(c, bucket);
    return next();
  };
}
