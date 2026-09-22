/**
 * Safe logging helpers — never write OTP, passwords, keys, tokens,
 * Authorization headers, Ghana Card numbers, upload bodies, MikroTik passwords,
 * or connector secrets to logs.
 */

const REDACT = "[redacted]";

const SENSITIVE_KEY = /^(authorization|password|passwd|secret|token|otp|code|api[_-]?key|arkesel|connector|ghana|bearer|cookie|set-cookie)$/i;
const SENSITIVE_VALUE = /(Bearer\s+\S+|otp[=:]\s*\d{4,}|password[=:]\S+|api[_-]?key[=:]\S+)/i;

export function redactLogValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACT;
  if (typeof value === "string" && SENSITIVE_VALUE.test(value)) return REDACT;
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 120)}…[truncated]`;
  return value;
}

export function safeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = safeLogFields(value as Record<string, unknown>);
    } else {
      out[key] = redactLogValue(key, value);
    }
  }
  return out;
}

/** Correlation id for safe error/log linkage (no PII). */
export function newCorrelationId(): string {
  return crypto.randomUUID();
}
