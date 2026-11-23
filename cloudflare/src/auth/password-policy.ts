/**
 * Staff password policy (self-service change). Hashing stays PBKDF2-SHA256 at 100k iterations
 * (see crypto.ts); the length cap matches the login route's 256-character input limit.
 *
 * Errors carry stable PASSWORD_* codes and never echo the password.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export const PASSWORD_ERROR_CODES = {
  changeRequired: "PASSWORD_CHANGE_REQUIRED",
  currentInvalid: "PASSWORD_CURRENT_INVALID",
  tooWeak: "PASSWORD_TOO_WEAK",
  reused: "PASSWORD_REUSED",
  rateLimited: "PASSWORD_CHANGE_RATE_LIMITED"
} as const;

export type PasswordErrorCode = (typeof PASSWORD_ERROR_CODES)[keyof typeof PASSWORD_ERROR_CODES];

export class PasswordPolicyError extends Error {
  readonly code: PasswordErrorCode;
  constructor(code: PasswordErrorCode, message: string) {
    super(message);
    this.name = "PasswordPolicyError";
    this.code = code;
  }
}

/** Very common / trivially guessable passwords (lower-cased, compared after normalisation). */
const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "qwerty", "qwerty123", "letmein", "welcome",
  "welcome1", "admin", "admin123", "administrator", "iloveyou", "changeme", "abc123", "123456789",
  "1234567890", "111111111111", "kissmet", "kissmethostel", "hostel", "ghana"
]);

function characterClasses(password: string) {
  let n = 0;
  if (/[a-z]/.test(password)) n += 1;
  if (/[A-Z]/.test(password)) n += 1;
  if (/[0-9]/.test(password)) n += 1;
  if (/[^A-Za-z0-9]/.test(password)) n += 1;
  return n;
}

/**
 * Returns a list of human-readable problems (empty = acceptable).
 * Rules: 12-256 chars; at least 3 of 4 character classes (lower/upper/digit/symbol) unless the
 * password is a long passphrase (>= 20 chars); not a common password; must not contain the
 * username or email local part (>= 3 chars); not a single repeated character.
 */
export function passwordProblems(password: string, context: { username?: string | null; email?: string | null } = {}): string[] {
  const problems: string[] = [];
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) problems.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (typeof password === "string" && password.length > PASSWORD_MAX_LENGTH) problems.push(`at most ${PASSWORD_MAX_LENGTH} characters`);
  if (typeof password !== "string") return problems;
  if (password.length < 20 && characterClasses(password) < 3) problems.push("at least three of: lowercase, uppercase, digit, symbol (or a passphrase of 20+ characters)");
  const lower = password.toLowerCase();
  const stripped = lower.replace(/[^a-z0-9]/g, "");
  if (COMMON.has(lower) || COMMON.has(stripped) || COMMON.has(stripped.replace(/\d+$/, ""))) problems.push("not a common password");
  if (/^(.)\1+$/.test(password)) problems.push("not a single repeated character");
  const ids = [context.username, context.email?.split("@")[0]].filter((v): v is string => typeof v === "string" && v.trim().length >= 3).map((v) => v.trim().toLowerCase());
  if (ids.some((id) => lower.includes(id))) problems.push("must not contain your username or email");
  return problems;
}

export function assertPasswordStrong(password: string, context: { username?: string | null; email?: string | null } = {}) {
  const problems = passwordProblems(password, context);
  if (problems.length) {
    throw new PasswordPolicyError(PASSWORD_ERROR_CODES.tooWeak, `Password does not meet the policy: ${problems.join("; ")}`);
  }
}
