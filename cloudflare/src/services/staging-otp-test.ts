import type { Env } from "../types/bindings";
import { sha256Hex, timingSafeEqualHex } from "../auth/crypto";
import { maskPhone, normalizeGhanaPhoneForSms } from "./phone";

/**
 * Staging-only OTP test path.
 *
 * The plaintext OTP cannot be recovered from otp_codes.code_hash, so staging
 * (mock SMS) also writes a short-lived inbox row. This module is a no-op unless
 * APP_ENV === "staging". It is never a production migration (0022 is reserved
 * for refunds); the inbox table is created at first staging write or by the
 * synthetic staging seed.
 */

export const STAGING_OTP_INBOX_TABLE = "staging_otp_inbox";

export const STAGING_OTP_INBOX_DDL = `CREATE TABLE IF NOT EXISTS staging_otp_inbox (
  id INTEGER PRIMARY KEY,
  destination TEXT NOT NULL,
  otp TEXT NOT NULL,
  purpose TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;

export const STAGING_OTP_INBOX_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS idx_staging_otp_inbox_destination_created ON staging_otp_inbox(destination, created_at DESC)";

export function isStagingOtpTestPathEnabled(env?: { APP_ENV?: string }): boolean {
  return env?.APP_ENV === "staging";
}

/** True only in staging AND when the lookup secret is configured. */
export function isStagingOtpTestLookupReady(env?: Pick<Env, "APP_ENV" | "STAGING_OTP_TEST_KEY">): boolean {
  return isStagingOtpTestPathEnabled(env) && Boolean((env?.STAGING_OTP_TEST_KEY ?? "").trim());
}

export async function stagingOtpTestKeyMatches(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const [left, right] = await Promise.all([sha256Hex(provided), sha256Hex(expected)]);
  return timingSafeEqualHex(left, right);
}

export async function persistStagingOtp(
  env: { APP_ENV?: string; DB?: D1Database } | undefined,
  request: { phone: string; code: string; expiresInMinutes: number }
): Promise<void> {
  if (!isStagingOtpTestPathEnabled(env) || !env?.DB) return;
  const expiresAt = new Date(Date.now() + Math.max(1, request.expiresInMinutes) * 60_000).toISOString();
  try {
    await env.DB.prepare(STAGING_OTP_INBOX_DDL).run();
    await env.DB.prepare(STAGING_OTP_INBOX_INDEX_DDL).run();
    await env.DB
      .prepare(
        "INSERT INTO staging_otp_inbox (destination, otp, purpose, expires_at) VALUES (?, ?, ?, ?)"
      )
      .bind(request.phone, request.code, "resident_login", expiresAt)
      .run();
  } catch {
    // Never fail OTP delivery because the staging inbox is unavailable.
  }
}

export type StagingOtpLookup =
  | { ok: true; otp: string; expiresAt: string; destinationMasked: string }
  | { ok: false; reason: "malformed" | "not_found" };

export async function lookupStagingOtp(env: Env, phone: string): Promise<StagingOtpLookup> {
  const normalized = normalizeGhanaPhoneForSms(phone);
  if (!normalized.ok) return { ok: false, reason: "malformed" };
  if (!env.DB) return { ok: false, reason: "not_found" };

  const candidates = [normalized.e164Digits, `+${normalized.e164Digits}`];
  try {
    const row = await env.DB
      .prepare(
        `SELECT otp, expires_at AS expiresAt
         FROM staging_otp_inbox
         WHERE destination IN (?, ?)
           AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(candidates[0], candidates[1])
      .first<{ otp: string; expiresAt: string }>();
    if (!row?.otp) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      otp: row.otp,
      expiresAt: row.expiresAt,
      destinationMasked: maskPhone(normalized.e164Digits)
    };
  } catch {
    return { ok: false, reason: "not_found" };
  }
}

/** Production (or any non-staging env) must never have created the inbox table. */
export async function stagingOtpInboxTableExists(db: D1Database): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .bind(STAGING_OTP_INBOX_TABLE)
      .first<{ ok: number }>();
    return Boolean(row);
  } catch {
    return false;
  }
}
