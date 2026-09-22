/**
 * Ghana phone normalization for OTP SMS delivery.
 * Canonical storage/wire format for Arkesel SMS V2: 233XXXXXXXXX (no "+").
 */

export type PhoneNormalizeResult =
  | { ok: true; e164Digits: string; masked: string }
  | { ok: false; reason: "empty" | "malformed" };

const GHANA_LOCAL = /^0([2-5]\d{8})$/;
const GHANA_CC = /^233([2-5]\d{8})$/;
const GHANA_PLUS = /^\+233([2-5]\d{8})$/;

/** Strip spaces, dashes, parentheses; keep leading + if present. */
function compactPhone(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }
  return trimmed.replace(/\D/g, "");
}

/**
 * Normalize Ghana numbers such as 0241234567, 233241234567, +233241234567
 * to Arkesel-required 233XXXXXXXXX. Rejects malformed input.
 */
export function normalizeGhanaPhoneForSms(input: string | null | undefined): PhoneNormalizeResult {
  if (input == null || !String(input).trim()) {
    return { ok: false, reason: "empty" };
  }

  const compact = compactPhone(String(input));

  let national: string | null = null;
  let match = compact.match(GHANA_PLUS);
  if (match) national = match[1];
  if (!national) {
    match = compact.match(GHANA_CC);
    if (match) national = match[1];
  }
  if (!national) {
    match = compact.match(GHANA_LOCAL);
    if (match) national = match[1];
  }

  if (!national) {
    return { ok: false, reason: "malformed" };
  }

  const e164Digits = `233${national}`;
  return { ok: true, e164Digits, masked: maskPhone(e164Digits) };
}

/** Safe log form: show country + last 3 digits. */
export function maskPhone(e164Digits: string): string {
  const digits = e164Digits.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}
