import type { Env } from "../types/bindings";
import { AuthRepository } from "../repositories/auth.repository";
import { hashPassword, randomOtp, randomToken, sha256Hex, verifyPassword } from "../auth/crypto";
import { checkRateLimit, rateLimitKey } from "../auth/rate-limit";
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
    await this.repo.writeAudit(staff.user_id, staff.staff_id, "auth.staff.login_succeeded", "user", staff.user_id);

    return { ok: true as const, status: 200, body: { token, expiresAt, user: { id: staff.user_id, name: staff.display_name, role: staff.role_code } } };
  }

  async requestResidentOtp(institutionCode: string, studentId: string, ctx: AuthClientContext = {}) {
    const resident = await this.repo.findResidentByStudentId(institutionCode, studentId);
    const generic = { ok: true as const, message: "If the resident can receive OTP messages, an OTP has been sent." };
    const ip = ctx.ip ?? "unknown";

    // Isolate-local IP abuse ceiling for OTP request (does not weaken D1 OTP controls).
    if (!checkRateLimit(rateLimitKey({ surface: "otp-request-ip", ip }), 20, OTP_RATE_LIMIT_WINDOW_MINUTES * 60_000)) {
      return generic;
    }

    if (!resident || resident.user_status !== "active" || !resident.phone) {
      await this.repo.writeAudit(resident?.user_id ?? null, null, "auth.resident.otp_request_hidden", "resident", resident?.resident_id ?? null);
      return generic;
    }

    const rateLimitKeyD1 = `otp:resident_login:${resident.institution_code}:${resident.student_id}`;
    const recent = await this.repo.countRecentOtps(rateLimitKeyD1, pastIso(OTP_RATE_LIMIT_WINDOW_MINUTES));
    if ((recent?.count ?? 0) >= OTP_RATE_LIMIT_MAX) {
      await this.repo.writeAudit(resident.user_id, null, "auth.resident.otp_rate_limited", "resident", resident.resident_id);
      return generic;
    }

    // Isolate-local identity+IP complement (NOT a substitute for D1 OTP rate keys).
    if (!checkRateLimit(rateLimitKey({ surface: "otp-request", identity: rateLimitKeyD1, ip }), OTP_RATE_LIMIT_MAX, OTP_RATE_LIMIT_WINDOW_MINUTES * 60_000)) {
      await this.repo.writeAudit(resident.user_id, null, "auth.resident.otp_rate_limited", "resident", resident.resident_id);
      return generic;
    }

    // Generate exactly one code for this user action; hash before any provider call.
    const otp = randomOtp();
    await this.repo.createOtp({
      userId: resident.user_id,
      residentId: resident.resident_id,
      destination: resident.phone,
      codeHash: await hashPassword(otp),
      rateLimitKey: rateLimitKeyD1,
      expiresAt: futureIso(OTP_MINUTES)
    });

    const delivery = await this.smsProvider.sendOtp({
      phone: resident.phone,
      code: otp,
      expiresInMinutes: OTP_MINUTES
    });

    if (!delivery.ok) {
      // Provider failure must never look like successful delivery and cannot authenticate.
      await this.repo.writeAudit(resident.user_id, null, "auth.resident.otp_delivery_failed", "resident", resident.resident_id);
      return {
        ok: false as const,
        status: 503,
        body: { error: OTP_DELIVERY_FAILURE_MESSAGE }
      };
    }

    await this.repo.writeAudit(resident.user_id, null, "auth.resident.otp_requested", "resident", resident.resident_id);
    return generic;
  }

  async verifyResidentOtp(institutionCode: string, studentId: string, otp: string, ctx: AuthClientContext = {}) {
    const ip = ctx.ip ?? "unknown";

    // Isolate-local IP ceiling for verify flooding (does not replace D1 attempt_count).
    if (!checkRateLimit(rateLimitKey({ surface: "otp-verify-ip", ip }), OTP_VERIFY_IP_LIMIT, OTP_VERIFY_IP_WINDOW_MS)) {
      return { ok: false as const, status: 429, body: { error: "Too many verification attempts" } };
    }

    const identityKey = `otp-verify:${institutionCode.toLowerCase()}:${studentId.toLowerCase()}`;
    if (!checkRateLimit(rateLimitKey({ surface: "otp-verify", identity: identityKey, ip }), 10, OTP_VERIFY_IP_WINDOW_MS)) {
      return { ok: false as const, status: 429, body: { error: "Too many verification attempts" } };
    }

    const record = await this.repo.findPendingOtp(institutionCode, studentId);
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
    await this.repo.writeAudit(record.user_id, null, "auth.resident.login_succeeded", "resident", record.resident_id);

    return { ok: true as const, status: 200, body: { token, expiresAt } };
  }

  async logout(token: string) {
    await this.repo.revokeSession(await sha256Hex(token), "user_logout");
    return { ok: true };
  }
}
