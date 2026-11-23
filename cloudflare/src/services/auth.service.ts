import type { Env } from "../types/bindings";
import { AuthRepository, type PendingOtpRecord, type ResidentLoginRecord } from "../repositories/auth.repository";
import { hashPassword, randomOtp, randomToken, sha256Hex, verifyPassword } from "../auth/crypto";
import { checkRateLimit, rateLimitKey } from "../auth/rate-limit";
import { PASSWORD_ERROR_CODES, PASSWORD_MAX_LENGTH, passwordProblems } from "../auth/password-policy";
import type { AuthUser } from "../auth/context";
import {
  authMethodAuditCategory,
  parseResidentAuthIdentity,
  type ResidentAuthIdentity
} from "../auth/resident-identity";
import type { SmsProvider } from "./sms.service";
import { OTP_DELIVERY_FAILURE_MESSAGE } from "./sms.service";

export const RESIDENT_OTP_MINUTES = 10;

const SESSION_HOURS = 8;
const OTP_MINUTES = RESIDENT_OTP_MINUTES;
const OTP_RATE_LIMIT_WINDOW_MINUTES = 15;
const OTP_RATE_LIMIT_MAX = 3;
const STAFF_LOGIN_RATE_LIMIT_MAX = 5;
const STAFF_LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60_000;
/** Isolate-local IP ceiling for OTP verify (complements D1 attempt_count; not distributed). */
const OTP_VERIFY_IP_LIMIT = 30;
const OTP_VERIFY_IP_WINDOW_MS = 15 * 60_000;
/** Isolate-local IP ceiling for staff login across identifiers. */
const STAFF_LOGIN_IP_LIMIT = 30;
const STAFF_LOGIN_IP_WINDOW_MS = 15 * 60_000;
/**
 * Self-service password change attempts per staff user, counted in D1 (`auth_rate_limits`,
 * migration 0021) so the limit is shared by every isolate/POP rather than per instance.
 */
export const PASSWORD_CHANGE_LIMIT = 5;
export const PASSWORD_CHANGE_WINDOW_MS = 15 * 60_000;

/** PII-free D1 bucket key: numeric user id only. */
export function passwordChangeRateLimitKey(userId: number): string {
  return `staff-password-change:user:${userId}`;
}

function passwordError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return { ok: false as const, status, body: { ok: false as const, error: { code, message, ...extra } } };
}

const GENERIC_OTP_REQUEST = {
  ok: true as const,
  message: "If the resident can receive OTP messages, an OTP has been sent."
};

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function pastIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export type AuthClientContext = {
  /** Client IP from CF-Connecting-IP when available. */
  ip?: string;
  userAgent?: string;
};

export type ResidentOtpRequestInput = {
  institutionCode?: string | null;
  studentId?: string | null;
  ghanaCardNumber?: string | null;
  residentKind?: unknown;
  identifierType?: unknown;
};

export type ResidentOtpVerifyInput = {
  otp: string;
  challengeId?: string | null;
  institutionCode?: string | null;
  studentId?: string | null;
  ghanaCardNumber?: string | null;
  residentKind?: unknown;
  identifierType?: unknown;
};

function decoyChallengeId(): string {
  return randomToken(32);
}

export class AuthService {
  private readonly repo: AuthRepository;

  constructor(env: Env, private readonly smsProvider: SmsProvider, repo?: AuthRepository) {
    this.repo = repo ?? new AuthRepository(env.DB);
  }

  async loginStaff(identifier: string, password: string, ctx: AuthClientContext = {}) {
    const identifierHash = await sha256Hex(identifier.toLowerCase());
    const ip = ctx.ip ?? "unknown";

    // Isolate-local IP ceiling (not distributed).
    if (!checkRateLimit(rateLimitKey({ surface: "staff-login-ip", ip }), STAFF_LOGIN_IP_LIMIT, STAFF_LOGIN_IP_WINDOW_MS)) {
      await this.repo.writeAudit(null, null, "auth.staff.login_rate_limited", "user", null, { identifierHash, by: "ip" });
      return { ok: false as const, status: 429, body: { error: "Too many login attempts" } };
    }

    // Isolate-local identity+IP fast path (not distributed across Worker isolates).
    const loginKey = rateLimitKey({ surface: "staff-login", identity: identifierHash, ip });
    if (!checkRateLimit(loginKey, STAFF_LOGIN_RATE_LIMIT_MAX, STAFF_LOGIN_RATE_LIMIT_WINDOW_MS)) {
      await this.repo.writeAudit(null, null, "auth.staff.login_rate_limited", "user", null, { identifierHash });
      return { ok: false as const, status: 429, body: { error: "Too many login attempts" } };
    }

    // Durable D1-backed counter — improves multi-isolate behavior but is still not edge-global.
    const recentFailures = await this.repo.countRecentStaffLoginFailures(identifierHash, pastIso(15));
    if ((recentFailures?.count ?? 0) >= STAFF_LOGIN_RATE_LIMIT_MAX) {
      await this.repo.writeAudit(null, null, "auth.staff.login_rate_limited", "user", null, { identifierHash });
      return { ok: false as const, status: 429, body: { error: "Too many login attempts" } };
    }

    const staff = await this.repo.findStaffByIdentifier(identifier);
    const valid = staff && staff.user_status === "active" && staff.staff_status === "active" && await verifyPassword(password, staff.password_hash);

    if (!valid) {
      await this.repo.writeAudit(staff?.user_id ?? null, staff?.staff_id ?? null, "auth.staff.login_failed", "user", staff?.user_id ?? null, { identifierHash });
      return { ok: false as const, status: 401, body: { error: "Invalid credentials" } };
    }

    const token = randomToken(32);
    const tokenHash = await sha256Hex(token);
    const expiresAt = futureIso(SESSION_HOURS * 60);
    await this.repo.createSession(staff.user_id, tokenHash, expiresAt, ctx.userAgent);
    const mustChangePassword = Number(staff.must_change_password ?? 0) === 1;
    await this.repo.writeAudit(staff.user_id, staff.staff_id, "auth.staff.login_succeeded", "user", staff.user_id, mustChangePassword ? { mustChangePassword: true } : undefined);

    return {
      ok: true as const,
      status: 200,
      body: { token, expiresAt, mustChangePassword, user: { id: staff.user_id, name: staff.display_name, role: staff.role_code, mustChangePassword } }
    };
  }

  /**
   * Self-service staff password change.
   * - current password required (verified against the stored PBKDF2 hash)
   * - new password must satisfy the policy in password-policy.ts and differ from the current one
   * - on success: new hash, must_change_password cleared, password_changed_at set, and every OTHER
   *   active session of the user revoked (the calling session stays valid)
   * - audited without any password material
   */
  async changeStaffPassword(user: AuthUser, currentPassword: string, newPassword: string) {
    if (user.userType !== "staff" || !user.staffId) return passwordError(403, "forbidden", "Forbidden");

    const nowMs = Date.now();
    const attempt = await this.repo.hitRateLimit(
      passwordChangeRateLimitKey(user.id),
      new Date(nowMs).toISOString(),
      new Date(nowMs - PASSWORD_CHANGE_WINDOW_MS).toISOString()
    );
    if (attempt > PASSWORD_CHANGE_LIMIT) {
      await this.repo.writeAudit(user.id, user.staffId, "auth.staff.password_change_rate_limited", "user", user.id);
      return passwordError(429, PASSWORD_ERROR_CODES.rateLimited, "Too many password change attempts. Try again later.");
    }

    const record = await this.repo.findStaffPasswordRecord(user.id);
    if (!record) return passwordError(403, "forbidden", "Forbidden");

    if (typeof currentPassword !== "string" || currentPassword.length > PASSWORD_MAX_LENGTH || !(await verifyPassword(currentPassword, record.password_hash))) {
      await this.repo.writeAudit(user.id, user.staffId, "auth.staff.password_change_failed", "user", user.id, { reason: "current_invalid" });
      return passwordError(400, PASSWORD_ERROR_CODES.currentInvalid, "Current password is incorrect");
    }

    const problems = passwordProblems(newPassword, { username: record.username, email: record.email });
    if (problems.length) {
      await this.repo.writeAudit(user.id, user.staffId, "auth.staff.password_change_failed", "user", user.id, { reason: "policy" });
      return passwordError(400, PASSWORD_ERROR_CODES.tooWeak, "New password does not meet the password policy", { requirements: problems });
    }

    if (newPassword === currentPassword || await verifyPassword(newPassword, record.password_hash)) {
      await this.repo.writeAudit(user.id, user.staffId, "auth.staff.password_change_failed", "user", user.id, { reason: "reused" });
      return passwordError(400, PASSWORD_ERROR_CODES.reused, "New password must be different from the current password");
    }

    const wasForced = Number(record.must_change_password ?? 0) === 1;
    await this.repo.updateStaffPassword(user.id, await hashPassword(newPassword));
    const revokedOtherSessions = await this.repo.revokeOtherSessions(user.id, user.sessionId, "password_changed");
    await this.repo.writeAudit(user.id, user.staffId, "auth.staff.password_changed", "user", user.id, { wasForced, revokedOtherSessions });

    return { ok: true as const, status: 200, body: { ok: true as const, data: { mustChangePassword: false, revokedOtherSessions } } };
  }

  /**
   * Resolve at most one resident for the identity. Ambiguous matches fail closed (null).
   */
  private async resolveResident(identity: ResidentAuthIdentity): Promise<{
    resident: ResidentLoginRecord | null;
    ambiguous: boolean;
  }> {
    if (identity.method === "listed_institution") {
      const rows = await this.repo.findResidentByStudentId(identity.institutionCode, identity.studentId);
      if (rows.length > 1) return { resident: null, ambiguous: true };
      return { resident: rows[0] ?? null, ambiguous: false };
    }
    const rows = await this.repo.findResidentByGhanaCardNumber(identity.ghanaCardNumber);
    if (rows.length > 1) return { resident: null, ambiguous: true };
    return { resident: rows[0] ?? null, ambiguous: false };
  }

  /**
   * Universal resident OTP request (listed institution OR Other + Ghana Card).
   * Always returns a generic success shape for enumeration protection, plus a challengeId
   * (real when an OTP was issued; decoy otherwise). Never discloses full phone or raw identifiers.
   */
  async requestResidentOtp(input: ResidentOtpRequestInput | string, studentIdOrCtx?: string | AuthClientContext, maybeCtx?: AuthClientContext) {
    // Back-compat: requestResidentOtp(institutionCode, studentId, ctx?)
    let body: ResidentOtpRequestInput;
    let ctx: AuthClientContext = {};
    if (typeof input === "string") {
      body = { institutionCode: input, studentId: typeof studentIdOrCtx === "string" ? studentIdOrCtx : null };
      ctx = (typeof studentIdOrCtx === "object" && studentIdOrCtx) ? studentIdOrCtx : (maybeCtx ?? {});
    } else {
      body = input;
      ctx = (typeof studentIdOrCtx === "object" && studentIdOrCtx) ? studentIdOrCtx : {};
    }

    const parsed = parseResidentAuthIdentity(body);
    const ip = ctx.ip ?? "unknown";
    const challengeId = decoyChallengeId();
    const generic = { ...GENERIC_OTP_REQUEST, challengeId };

    if (!checkRateLimit(rateLimitKey({ surface: "otp-request-ip", ip }), 20, OTP_RATE_LIMIT_WINDOW_MINUTES * 60_000)) {
      return generic;
    }

    if (!parsed.ok) {
      await this.repo.writeAudit(null, null, "auth.resident.otp_request_hidden", "resident", null, {
        authMethod: parsed.reason === "inconsistent" ? "inconsistent" : "invalid",
        outcome: "rejected_input"
      });
      return generic;
    }

    const identity = parsed.identity;
    const method = authMethodAuditCategory(identity.method);
    const { resident, ambiguous } = await this.resolveResident(identity);

    if (ambiguous) {
      await this.repo.writeAudit(null, null, "auth.resident.otp_request_ambiguous", "resident", null, {
        authMethod: method,
        outcome: "ambiguous"
      });
      return generic;
    }

    if (!resident || resident.user_status !== "active" || !resident.phone) {
      await this.repo.writeAudit(resident?.user_id ?? null, null, "auth.resident.otp_request_hidden", "resident", resident?.resident_id ?? null, {
        authMethod: method,
        outcome: "not_found_or_inactive"
      });
      return generic;
    }

    const rateLimitKeyD1 = `otp:resident_login:resident:${resident.resident_id}`;
    const recent = await this.repo.countRecentOtpsForResident(resident.resident_id, pastIso(OTP_RATE_LIMIT_WINDOW_MINUTES));
    if ((recent?.count ?? 0) >= OTP_RATE_LIMIT_MAX) {
      await this.repo.writeAudit(resident.user_id, null, "auth.resident.otp_rate_limited", "resident", resident.resident_id, {
        authMethod: method,
        outcome: "rate_limited"
      });
      return generic;
    }

    if (!checkRateLimit(rateLimitKey({ surface: "otp-request", identity: rateLimitKeyD1, ip }), OTP_RATE_LIMIT_MAX, OTP_RATE_LIMIT_WINDOW_MINUTES * 60_000)) {
      await this.repo.writeAudit(resident.user_id, null, "auth.resident.otp_rate_limited", "resident", resident.resident_id, {
        authMethod: method,
        outcome: "rate_limited"
      });
      return generic;
    }

    const otp = randomOtp();
    const realChallengeId = randomToken(32);
    const challengeTokenHash = await sha256Hex(realChallengeId);
    await this.repo.createOtp({
      userId: resident.user_id,
      residentId: resident.resident_id,
      destination: resident.phone,
      codeHash: await hashPassword(otp),
      rateLimitKey: rateLimitKeyD1,
      expiresAt: futureIso(OTP_MINUTES),
      challengeTokenHash
    });

    const delivery = await this.smsProvider.sendOtp({
      phone: resident.phone,
      code: otp,
      expiresInMinutes: OTP_MINUTES
    });

    if (!delivery.ok) {
      await this.repo.writeAudit(resident.user_id, null, "auth.resident.otp_delivery_failed", "resident", resident.resident_id, {
        authMethod: method
      });
      return {
        ok: false as const,
        status: 503,
        body: { error: OTP_DELIVERY_FAILURE_MESSAGE }
      };
    }

    await this.repo.writeAudit(resident.user_id, null, "auth.resident.otp_requested", "resident", resident.resident_id, {
      authMethod: method,
      outcome: "sent"
    });

    // Same shape for success and decoy paths (challengeId always present). No phone disclosure.
    return {
      ok: true as const,
      message: GENERIC_OTP_REQUEST.message,
      challengeId: realChallengeId
    };
  }

  private async loadPendingOtp(input: ResidentOtpVerifyInput): Promise<PendingOtpRecord | null> {
    if (input.challengeId && input.challengeId.trim()) {
      const hash = await sha256Hex(input.challengeId.trim());
      const byChallenge = await this.repo.findPendingOtpByChallengeTokenHash(hash);
      if (byChallenge) return byChallenge;
    }

    const parsed = parseResidentAuthIdentity(input);
    if (!parsed.ok) return null;
    const { resident, ambiguous } = await this.resolveResident(parsed.identity);
    if (ambiguous) return null;
    if (resident) {
      const byResident = await this.repo.findPendingOtpByResidentId(resident.resident_id);
      if (byResident) return byResident;
    }
    // Legacy listed-institution lookup (institution code + student id) for older clients/tests.
    if (parsed.identity.method === "listed_institution") {
      return this.repo.findPendingOtp(parsed.identity.institutionCode, parsed.identity.studentId);
    }
    return null;
  }

  async verifyResidentOtp(
    inputOrInstitution: ResidentOtpVerifyInput | string,
    studentIdOrOtp?: string | AuthClientContext,
    otpOrCtx?: string | AuthClientContext,
    maybeCtx?: AuthClientContext
  ) {
    let input: ResidentOtpVerifyInput;
    let ctx: AuthClientContext = {};

    if (typeof inputOrInstitution === "string") {
      // Back-compat: verifyResidentOtp(institutionCode, studentId, otp, ctx?)
      input = {
        institutionCode: inputOrInstitution,
        studentId: typeof studentIdOrOtp === "string" ? studentIdOrOtp : null,
        otp: typeof otpOrCtx === "string" ? otpOrCtx : ""
      };
      ctx = (typeof otpOrCtx === "object" && otpOrCtx)
        ? otpOrCtx
        : (maybeCtx ?? {});
    } else {
      input = inputOrInstitution;
      ctx = (studentIdOrOtp && typeof studentIdOrOtp === "object")
        ? studentIdOrOtp
        : (maybeCtx ?? {});
    }

    const ip = ctx.ip ?? "unknown";

    if (!checkRateLimit(rateLimitKey({ surface: "otp-verify-ip", ip }), OTP_VERIFY_IP_LIMIT, OTP_VERIFY_IP_WINDOW_MS)) {
      return { ok: false as const, status: 429, body: { error: "Too many verification attempts" } };
    }

    const identityHint = input.challengeId?.trim()
      ? `challenge:${input.challengeId.trim().slice(0, 12)}`
      : `id:${String(input.institutionCode ?? "x").toLowerCase()}`;
    if (!checkRateLimit(rateLimitKey({ surface: "otp-verify", identity: identityHint, ip }), 10, OTP_VERIFY_IP_WINDOW_MS)) {
      return { ok: false as const, status: 429, body: { error: "Too many verification attempts" } };
    }

    const otp = typeof input.otp === "string" ? input.otp.trim() : "";
    if (!otp) {
      return { ok: false as const, status: 401, body: { error: "Invalid or expired OTP" } };
    }

    const record = await this.loadPendingOtp(input);
    if (!record) return { ok: false as const, status: 401, body: { error: "Invalid or expired OTP" } };

    if (new Date(record.expires_at).getTime() <= Date.now()) {
      await this.repo.markOtpExpired(record.id);
      await this.repo.writeAudit(record.user_id, null, "auth.resident.otp_expired", "otp_code", record.id);
      return { ok: false as const, status: 401, body: { error: "Invalid or expired OTP" } };
    }

    if (record.attempt_count >= record.max_attempts) {
      await this.repo.writeAudit(record.user_id, null, "auth.resident.otp_attempt_limited", "otp_code", record.id);
      return { ok: false as const, status: 429, body: { error: "OTP attempt limit reached" } };
    }

    const valid = await verifyPassword(otp, record.code_hash);
    if (!valid) {
      await this.repo.incrementOtpAttempt(record.id);
      await this.repo.writeAudit(record.user_id, null, "auth.resident.otp_failed", "otp_code", record.id);
      return { ok: false as const, status: 401, body: { error: "Invalid or expired OTP" } };
    }

    await this.repo.markOtpUsed(record.id);
    const token = randomToken(32);
    const tokenHash = await sha256Hex(token);
    const expiresAt = futureIso(SESSION_HOURS * 60);
    await this.repo.createSession(record.user_id, tokenHash, expiresAt, ctx.userAgent);
    const verifiedIdentity = parseResidentAuthIdentity(input);
    await this.repo.writeAudit(record.user_id, null, "auth.resident.login_succeeded", "resident", record.resident_id, {
      authMethod: verifiedIdentity.ok
        ? authMethodAuditCategory(verifiedIdentity.identity.method)
        : (input.challengeId ? "challenge" : "unknown")
    });

    return { ok: true as const, status: 200, body: { token, expiresAt } };
  }

  async logout(token: string) {
    await this.repo.revokeSession(await sha256Hex(token), "user_logout");
    return { ok: true };
  }
}
