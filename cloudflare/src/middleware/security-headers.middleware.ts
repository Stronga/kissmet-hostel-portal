import type { Context, Next } from "hono";
import type { Env } from "../types/bindings";

/**
 * Application-level security headers for the Worker API.
 * HSTS must be set at the Cloudflare edge for production HTTPS; Workers behind
 * Cloudflare often rely on the zone SSL/TLS + edge HSTS policy.
 *
 * CSP is intentionally minimal and API-oriented (JSON responses). Do not tighten
 * to a document CSP that would break Admin/Resident portal frontends — those are
 * separate static origins.
 */
export async function securityHeadersMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  await next();

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");

  const path = new URL(c.req.url).pathname;
  if (
    path.startsWith("/auth") ||
    path.startsWith("/admin") ||
    path.startsWith("/resident")
  ) {
    c.header("Cache-Control", "no-store");
  }
}
