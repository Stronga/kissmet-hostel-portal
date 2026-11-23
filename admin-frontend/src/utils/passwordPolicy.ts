/**
 * Client-side mirror of cloudflare/src/auth/password-policy.ts for live feedback.
 * The backend remains authoritative.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "qwerty", "qwerty123", "letmein", "welcome",
  "welcome1", "admin", "admin123", "administrator", "iloveyou", "changeme", "abc123", "123456789",
  "1234567890", "111111111111", "kissmet", "kissmethostel", "hostel", "ghana"
]);

export function passwordProblems(password: string, context: { username?: string | null; email?: string | null } = {}): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`At least ${PASSWORD_MIN_LENGTH} characters`);
  if (password.length > PASSWORD_MAX_LENGTH) problems.push(`At most ${PASSWORD_MAX_LENGTH} characters`);
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  if (password.length < 20 && classes < 3) problems.push("Three of: lowercase, uppercase, digit, symbol (or a passphrase of 20+ characters)");
  const lower = password.toLowerCase();
  const stripped = lower.replace(/[^a-z0-9]/g, "");
  if (password && (COMMON.has(lower) || COMMON.has(stripped) || COMMON.has(stripped.replace(/\d+$/, "")))) problems.push("Not a common password");
  if (/^(.)\1+$/.test(password)) problems.push("Not a single repeated character");
  const ids = [context.username, context.email?.split("@")[0]].filter((v): v is string => typeof v === "string" && v.trim().length >= 3).map((v) => v.trim().toLowerCase());
  if (ids.some((id) => lower.includes(id))) problems.push("Must not contain your username or email");
  return problems;
}
