import type { Context, Next } from "hono";
import type { Env } from "../types/bindings";
import { productionAuthBlocked, validateProductionConfig } from "../config/production-secrets";
import { newCorrelationId } from "../http/safe-log";

/**
 * Fail-closed guard for production auth/OTP surfaces when required secrets/config are missing.
 * Does not expose which secret is missing to clients.
 */
export async function productionAuthConfigGuard(c: Context<{ Bindings: Env }>, next: Next) {
  const blocked = productionAuthBlocked(c.env);
  if (blocked) {
    const correlationId = newCorrelationId();
    return c.json(
      {
        ok: false,
        error: {
          message: "Service temporarily unavailable",
          correlationId
        }
      },
      503
    );
  }
  return next();
}

/** Health-only diagnostic: returns issue codes (not secret values) for operators in non-public checks. */
export function productionConfigIssueCodes(env: Env): string[] {
  return validateProductionConfig(env).map((i) => i.code);
}
