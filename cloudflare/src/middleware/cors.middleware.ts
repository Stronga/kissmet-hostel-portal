import type { Context, Next } from "hono";
import type { Env } from "../types/bindings";
import { parseOriginList, sanitizeCorsOriginsForEnv } from "../config/production-secrets";

/**
 * Explicit browser origins allowed to call the Worker with Authorization.
 * ADMIN_ALLOWED_ORIGINS is the historical env var name; it lists Admin + Resident portals.
 *
 * Rules:
 * - Never use wildcard origins for authenticated API calls.
 * - Never reflect arbitrary Origin headers.
 * - Production/staging strip localhost, http://, and wildcard entries even if misconfigured.
 * - Dev origins must not silently remain in production.
 */
const defaultOrigins = {
  local: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174"
  ],
  staging: [
    "https://staging-admin.kissmetgroup.org",
    "https://staging-portal.kissmetgroup.org"
  ],
  production: [
    "https://admin.kissmetgroup.org",
    "https://portal.kissmetgroup.org"
  ]
} satisfies Record<Env["APP_ENV"], string[]>;

export function allowedOrigins(env: Env): string[] {
  const configured = parseOriginList(env.ADMIN_ALLOWED_ORIGINS);
  return sanitizeCorsOriginsForEnv(
    env.APP_ENV,
    configured.length ? configured : undefined,
    defaultOrigins[env.APP_ENV] ?? defaultOrigins.production
  );
}

function applyCors(c: Context<{ Bindings: Env }>) {
  const origin = c.req.header("Origin");
  if (!origin) return;

  const allowlist = allowedOrigins(c.env);
  if (!allowlist.includes(origin)) {
    // Explicit deny: do not set ACAO (no reflection).
    return;
  }

  c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  c.header("Access-Control-Max-Age", "86400");
  // Bearer-token auth (not cookies). Do not pair wildcard with credentials.
  // Credentials header omitted intentionally — Authorization header is enough.
}

export async function corsMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  applyCors(c);
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
  applyCors(c);
}

export { defaultOrigins as corsDefaultOrigins };
