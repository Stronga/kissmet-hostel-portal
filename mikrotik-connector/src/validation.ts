/**
 * Connector-boundary input validation (F1).
 *
 * Everything that ends up inside a RouterOS API word (`=name=…`, `?name=…`, `=password=…`,
 * `=comment=…`) is validated here, at the HTTP route, before HotspotService or any RouterOS
 * client is called. Rejections use fixed error codes/messages and never echo the input.
 */

/**
 * Must stay in sync with the Worker's `routerUsernameFromResidentCode`
 * (cloudflare/src/services/internet-access.service.ts): `^KSM-RES-[A-Z0-9]+$` after
 * trim + toUpperCase. The connector does NOT normalise: it accepts only the exact
 * canonical form the Worker sends (uppercase, no surrounding whitespace).
 */
export const RESIDENT_USERNAME_PATTERN = /^KSM-RES-[A-Z0-9]+$/;
/** RouterOS user names are short in practice; Worker codes are like KSM-RES-0025. */
export const USERNAME_MAX_LENGTH = 32;

/**
 * Names that must never be created/modified through the connector, compared
 * case-insensitively. None of them can match RESIDENT_USERNAME_PATTERN today; this is
 * defence in depth in case the pattern is ever relaxed.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "default",
  "default-trial",
  "portal-api",
  "root",
  "system",
  "guest",
  "kissmet-residents"
]);

/** Passwords: printable ASCII (0x20–0x7E), 8–128 chars. Worker generates 18 chars. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_PATTERN = /^[\x20-\x7E]+$/;

/**
 * Comments: printable ASCII except '=' (0x20–0x3C, 0x3E–0x7E), max 128 chars, no leading
 * '?' or '!' (RouterOS query/reply word prefixes). Empty string allowed (= no comment).
 * Worker sends e.g. "Kissmet KSM-RES-0025" / "Kissmet retry KSM-RES-0025".
 */
export const COMMENT_MAX_LENGTH = 128;
const COMMENT_PATTERN = /^[\x20-\x3C\x3E-\x7E]*$/;

export function isValidResidentUsername(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > USERNAME_MAX_LENGTH) return false;
  if (RESERVED_USERNAMES.has(value.toLowerCase())) return false;
  return RESIDENT_USERNAME_PATTERN.test(value);
}

export function isValidHotspotPassword(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) return false;
  return PASSWORD_PATTERN.test(value);
}

export function isValidComment(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length > COMMENT_MAX_LENGTH) return false;
  if (value.startsWith("?") || value.startsWith("!")) return false;
  return COMMENT_PATTERN.test(value);
}

/** A JSON body must be a plain object (not null, array, string, number, boolean). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
