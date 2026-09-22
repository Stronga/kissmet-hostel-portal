import type { Env } from "../types/bindings";

/**
 * Production / staging configuration guards.
 *
 * Sensitive values must live in Cloudflare Worker secrets (wrangler secret put),
 * never in Git, wrangler.toml [vars], frontend bundles, source maps, or docs.
 *
 * Placeholder dashboard commands (do not run from CI without approval):
 *   npx wrangler secret put ARKESEL_API_KEY --env production
 *   npx wrangler secret put MIKROTIK_CONNECTOR_SECRET --env production
 *   npx wrangler secret put MIKROTIK_CONNECTOR_URL --env production
 *   # Or set MIKROTIK_CONNECTOR_URL as a non-secret var once the Tunnel hostname is known.
 *
 * Status: CONFIGURATION PREPARED — secrets are not present in this repo.
 */

export type ProductionConfigIssue = {
  code: string;
  severity: "critical" | "high" | "medium";
  message: string;
};

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i;

/** Origins that must never appear in production CORS allowlists. */
export function isInsecureProductionOrigin(origin: string): boolean {
  const trimmed = origin.trim();
  if (!trimmed) return true;
  if (LOCALHOST_ORIGIN.test(trimmed)) return true;
  if (trimmed.startsWith("http://") && !LOCALHOST_ORIGIN.test(trimmed)) {
    // Non-HTTPS non-localhost in production is insecure.
    return true;
  }
  // Explicitly block common placeholder / wildcard patterns.
  if (trimmed === "*" || trimmed.includes("*")) return true;
  return false;
}

export function parseOriginList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Resolve production-safe CORS origins.
 * - Always drops localhost / wildcard / http origins when APP_ENV=production|staging
 * - Falls back to built-in defaults when empty after filtering
 */
export function sanitizeCorsOriginsForEnv(
  appEnv: Env["APP_ENV"],
  configured: string[] | undefined,
  defaults: string[]
): string[] {
  const source = configured?.length ? configured : defaults;
  if (appEnv === "local") return source;

  const filtered = source.filter((origin) => !isInsecureProductionOrigin(origin));
  // Staging/production must not silently keep empty or localhost-only lists.
  return filtered.length ? filtered : defaults.filter((o) => !isInsecureProductionOrigin(o));
}


/**
 * Fail-closed production configuration checks.
 * Missing required production secrets / mis-set SMS provider → issues that callers must treat as blocking.
 */
export function validateProductionConfig(env: Env): ProductionConfigIssue[] {
  const issues: ProductionConfigIssue[] = [];
  if (env.APP_ENV !== "production") return issues;

  const sms = (env.SMS_PROVIDER ?? "").trim().toLowerCase();
  if (sms !== "arkesel") {
    issues.push({
      code: "sms_provider",
      severity: "critical",
      message: "Production requires SMS_PROVIDER=arkesel (Worker var) with ARKESEL secrets"
    });
  }
  if (!(env.ARKESEL_API_KEY ?? "").trim()) {
    issues.push({
      code: "arkesel_api_key",
      severity: "critical",
      message: "Production missing ARKESEL_API_KEY Worker secret"
    });
  }
  if (!(env.ARKESEL_SENDER_ID ?? "").trim()) {
    issues.push({
      code: "arkesel_sender",
      severity: "critical",
      message: "Production missing ARKESEL_SENDER_ID"
    });
  }

  const origins = parseOriginList(env.ADMIN_ALLOWED_ORIGINS);
  const insecure = origins.filter(isInsecureProductionOrigin);
  if (insecure.length) {
    issues.push({
      code: "cors_insecure_origins",
      severity: "high",
      message: "Production ADMIN_ALLOWED_ORIGINS contains localhost, http, or wildcard origins"
    });
  }

  // Connector is optional until Pi commissioning; if URL set, secret required and HTTPS enforced elsewhere.
  const connectorUrl = (env.MIKROTIK_CONNECTOR_URL ?? "").trim();
  const connectorSecret = (env.MIKROTIK_CONNECTOR_SECRET ?? "").trim();
  if (connectorUrl && !connectorSecret) {
    issues.push({
      code: "connector_secret",
      severity: "high",
      message: "MIKROTIK_CONNECTOR_URL set without MIKROTIK_CONNECTOR_SECRET"
    });
  }
  if (connectorSecret && !connectorUrl) {
    issues.push({
      code: "connector_url",
      severity: "medium",
      message: "MIKROTIK_CONNECTOR_SECRET set without MIKROTIK_CONNECTOR_URL"
    });
  }

  if ((env.DEV_OTP_LOG ?? "").toLowerCase() === "true") {
    issues.push({
      code: "dev_otp_log",
      severity: "critical",
      message: "DEV_OTP_LOG must not be enabled in production"
    });
  }

  if ((env.PUBLIC_BASE_URL ?? "").startsWith("http://")) {
    issues.push({
      code: "public_base_url",
      severity: "high",
      message: "Production PUBLIC_BASE_URL must be HTTPS"
    });
  }

  return issues;
}

/** True when production config has no critical/high issues (medium connector-not-yet-commissioned is allowed). */
export function isProductionConfigSafe(env: Env): boolean {
  return validateProductionConfig(env).every((i) => i.severity === "medium");
}

/** Auth/OTP routes must fail closed when production SMS/CORS secrets are critically misconfigured. */
export function productionAuthBlocked(env: Env): ProductionConfigIssue | null {
  if (env.APP_ENV !== "production") return null;
  const critical = validateProductionConfig(env).find((i) => i.severity === "critical");
  return critical ?? null;
}

export function clientIpFromRequest(request: Request): string {
  // Cloudflare sets CF-Connecting-IP on edge requests. Fall back carefully for local tests.
  const cf = request.headers.get("CF-Connecting-IP")?.trim();
  if (cf) return cf.slice(0, 64);
  const xff = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  if (xff) return xff.slice(0, 64);
  return "unknown";
}

