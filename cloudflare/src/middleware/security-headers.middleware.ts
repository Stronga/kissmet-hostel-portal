import type { Context, Next } from "hono";
import type { Env } from "../types/bindings";

/**
 * Application-level security headers for the Worker API.
 *
 * HSTS: Do NOT set Strict-Transport-Security from the Worker until production
 * HTTPS and custom domains are verified at the Cloudflare edge. Premature HSTS
 * can brick clients. Activation is a PRODUCTION DASHBOARD ACTION REQUIRED —
 * see docs/SECURITY_AUDIT_PHASE2.md.
 *
 * CSP here is API-oriented (JSON). Admin/Resident portal document CSP belongs
 * on the static hosting origin (Cloudflare Pages `_headers` examples in docs/).
 */
export async function securityHeadersMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  await next();

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"
  );
  c.header("Cross-Origin-Resource-Policy", "same-site");
  c.header("Cross-Origin-Opener-Policy", "same-origin");

  const path = new URL(c.req.url).pathname;
  if (
    path.startsWith("/auth") ||
    path.startsWith("/admin") ||
    path.startsWith("/resident")
  ) {
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
  }
}
