import type { ContentfulStatusCode } from "hono/utils/http-status";
import { error } from "./responses";

const SAFE_PREFIXES = [
  "Invalid",
  "Unauthorized",
  "Forbidden",
  "not found",
  "Not found",
  "too large",
  "Unsupported",
  "Incomplete",
  "already",
  "Active ",
  "Resident ",
  "Document ",
  "Payment ",
  "Booking ",
  "Application ",
  "Allocation ",
  "Room ",
  "Bed ",
  "Gender",
  "OTP",
  "Registration",
  "Request failed",
  "Document storage",
  "Too many",
  "Invalid workflow",
  "Payment would exceed",
  "Confirmation threshold",
  "required"
];

function looksUnsafe(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("unique constraint") ||
    lower.includes("unique") && lower.includes("constraint") ||
    message.includes("UNIQUE") ||
    lower.includes("sqlite") ||
    lower.includes("d1_error") ||
    lower.includes("sql ") ||
    lower.includes(" at ") ||
    lower.includes(".ts:") ||
    lower.includes(".js:") ||
    lower.includes("r2") ||
    lower.includes("stack") ||
    lower.includes("password") ||
    lower.includes("token") ||
    lower.includes("otp") && lower.includes("hash") ||
    lower.includes("/workspace") ||
    lower.includes("node_modules")
  );
}

function isAllowlisted(message: string): boolean {
  return SAFE_PREFIXES.some((prefix) => message.includes(prefix));
}

export function publicErrorMessage(e: unknown, fallback = "Request failed"): string {
  const message = e instanceof Error ? e.message : fallback;
  if (!message || looksUnsafe(message)) {
    if (typeof message === "string" && (message.includes("UNIQUE") || message.toLowerCase().includes("unique"))) {
      return "Conflict with an existing record";
    }
    return fallback;
  }
  if (!isAllowlisted(message) && message.length > 180) return fallback;
  return message;
}

export function routeError(e: unknown, options?: { fallback?: string; conflictOnUnique?: boolean }) {
  const raw = e instanceof Error ? e.message : "";
  const fallback = options?.fallback ?? "Request failed";
  const message = publicErrorMessage(e, fallback);
  const status: ContentfulStatusCode =
    /not found/i.test(raw) ? 404
    : /unauthorized/i.test(raw) ? 401
    : /forbidden/i.test(raw) ? 403
    : /UNIQUE|already exists|Conflict|exceed/i.test(raw) ? 409
    : /too many|attempt limit|rate/i.test(raw) ? 429
    : 400;
  return { body: error(message), status };
}
