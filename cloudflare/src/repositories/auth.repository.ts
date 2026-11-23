import type { Env } from "../types/bindings";

export interface StaffLoginRecord {
  user_id: number;
  email: string | null;
  username: string | null;
  display_name: string;
  user_status: string;
  password_hash: string | null;
  staff_id: number;
  staff_status: string;
  role_code: string;
  must_change_password?: number | null;
}

export interface ResidentLoginRecord {
  resident_id: number;
  resident_code: string;
  institution_id: number | null;
  institution_code: string | null;
  student_id: string | null;
  ghana_card_number: string | null;
  user_id: number;
  display_name: string;
  user_status: string;
  resident_status: string;
  phone: string | null;
  resident_kind: string | null;
}

export interface PendingOtpRecord {
  id: number;
  code_hash: string;
  attempt_count: number;
  max_attempts: number;
  expires_at: string;
  status: string;
  resident_id: number;
  user_id: number;
  destination: string;
  rate_limit_key: string;
}

export interface SessionRecord {
  session_id: number;
  user_id: number;
  display_name: string;
  email: string | null;
  user_type: "resident" | "staff" | "system";
  user_status: string;
  session_status: string;
  expires_at: string;
  staff_id: number | null;
  staff_status: string | null;
  resident_id: number | null;
  role_code: string | null;
  must_change_password?: number | null;
}

export interface StaffPasswordRecord {
  user_id: number;
  username: string | null;
  email: string | null;
  password_hash: string | null;
  must_change_password?: number | null;
}

const RESIDENT_LOGIN_SELECT = `
  SELECT r.id AS resident_id, r.resident_code, r.institution_id,
    i.code AS institution_code, r.student_id, r.ghana_card_number,
    u.id AS user_id, u.display_name,
    u.status AS user_status, r.status AS resident_status, u.phone,
    r.resident_kind
  FROM residents r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN institutions i ON i.id = r.institution_id
`;

export class AuthRepository {
  constructor(private readonly db: Env["DB"]) {}

  findStaffByIdentifier(identifier: string) {
    return this.db.prepare(`
      SELECT u.id AS user_id, u.email, u.username, u.display_name, u.status AS user_status,
        u.password_hash, st.id AS staff_id, st.status AS staff_status, r.code AS role_code,
        u.must_change_password
      FROM users u
      JOIN staff st ON st.user_id = u.id
      JOIN roles r ON r.id = st.role_id
      WHERE lower(u.email) = lower(?) OR lower(u.username) = lower(?)
      LIMIT 1
    `).bind(identifier, identifier).first<StaffLoginRecord>();
  }

  async findResidentByStudentId(institutionCode: string, studentId: string): Promise<ResidentLoginRecord[]> {
    const result = await this.db.prepare(`
      ${RESIDENT_LOGIN_SELECT}
      WHERE lower(i.code) = lower(?)
        AND i.status = 'active'
        AND r.student_id = ?
        AND r.institution_id IS NOT NULL
      LIMIT 2
    `).bind(institutionCode, studentId).all<ResidentLoginRecord>();
    return result.results ?? [];
  }

  async findResidentByGhanaCardNumber(ghanaCardNumber: string): Promise<ResidentLoginRecord[]> {
    const result = await this.db.prepare(`
      ${RESIDENT_LOGIN_SELECT}
      WHERE r.ghana_card_number = ?
        AND r.institution_id IS NULL
        AND r.student_id IS NULL
      LIMIT 2
    `).bind(ghanaCardNumber).all<ResidentLoginRecord>();
    return result.results ?? [];
  }

  async createSession(userId: number, tokenHash: string, expiresAt: string, userAgent?: string, ipHash?: string) {
    const result = await this.db.prepare(`
      INSERT INTO sessions (user_id, session_token_hash, status, user_agent, ip_hash, expires_at)
      VALUES (?, ?, 'active', ?, ?, ?)
    `).bind(userId, tokenHash, userAgent ?? null, ipHash ?? null, expiresAt).run();
    return result.meta.last_row_id;
  }

  findSessionByTokenHash(tokenHash: string) {
    return this.db.prepare(`
      SELECT s.id AS session_id, u.id AS user_id, u.display_name, u.email, u.user_type,
        u.status AS user_status, s.status AS session_status, s.expires_at,
        st.id AS staff_id, st.status AS staff_status, res.id AS resident_id, roles.code AS role_code,
        u.must_change_password
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN staff st ON st.user_id = u.id
      LEFT JOIN roles ON roles.id = st.role_id
      LEFT JOIN residents res ON res.user_id = u.id
      WHERE s.session_token_hash = ?
      LIMIT 1
    `).bind(tokenHash).first<SessionRecord>();
  }

  findStaffPasswordRecord(userId: number) {
    return this.db.prepare(`
      SELECT u.id AS user_id, u.username, u.email, u.password_hash, u.must_change_password
      FROM users u
      JOIN staff st ON st.user_id = u.id
      WHERE u.id = ? AND u.user_type = 'staff'
      LIMIT 1
    `).bind(userId).first<StaffPasswordRecord>();
  }

  /**
   * Persistent, shared fixed-window counter (migration 0021 `auth_rate_limits`).
   * One atomic UPSERT ... RETURNING: increments the attempt count for `bucketKey`, or restarts the
   * window at 1 when the stored window began at or before `windowStartCutoffIso`. Because it is a
   * single statement on D1 (one primary), concurrent isolates cannot both see a stale count.
   * Returns the attempt number within the current window (1 = first attempt).
   */
  async hitRateLimit(bucketKey: string, nowIso: string, windowStartCutoffIso: string): Promise<number> {
    const row = await this.db.prepare(`
      INSERT INTO auth_rate_limits (bucket_key, window_started_at, attempt_count, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(bucket_key) DO UPDATE SET
        attempt_count = CASE WHEN auth_rate_limits.window_started_at <= ? THEN 1 ELSE auth_rate_limits.attempt_count + 1 END,
        window_started_at = CASE WHEN auth_rate_limits.window_started_at <= ? THEN excluded.window_started_at ELSE auth_rate_limits.window_started_at END,
        updated_at = excluded.updated_at
      RETURNING attempt_count
    `).bind(bucketKey, nowIso, nowIso, windowStartCutoffIso, windowStartCutoffIso).first<{ attempt_count: number }>();
    // Fail closed: if the counter could not be read back, treat the request as over the limit.
    return row ? Number(row.attempt_count) : Number.POSITIVE_INFINITY;
  }

  /** Sets a new self-chosen password and clears the forced-rotation flag. */
  async updateStaffPassword(userId: number, passwordHash: string) {
    await this.db.prepare(`
      UPDATE users
      SET password_hash = ?, must_change_password = 0,
        password_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).bind(passwordHash, userId).run();
  }

  /** Revokes every active session of the user except `keepSessionId`. Returns the count revoked. */
  async revokeOtherSessions(userId: number, keepSessionId: number, reason: string): Promise<number> {
    const result = await this.db.prepare(`
      UPDATE sessions
      SET status = 'revoked', revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revocation_reason = ?
      WHERE user_id = ? AND status = 'active' AND id <> ?
    `).bind(reason, userId, keepSessionId).run();
    return Number(result.meta?.changes ?? 0);
  }

  async revokeSession(tokenHash: string, reason: string) {
    await this.db.prepare(`
      UPDATE sessions
      SET status = 'revoked', revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revocation_reason = ?
      WHERE session_token_hash = ? AND status = 'active'
    `).bind(reason, tokenHash).run();
  }

  async createOtp(data: {
    userId: number;
    residentId: number;
    destination: string;
    codeHash: string;
    rateLimitKey: string;
    expiresAt: string;
    challengeTokenHash?: string | null;
  }) {
    const payload = data.challengeTokenHash
      ? JSON.stringify({ challengeTokenHash: data.challengeTokenHash })
      : null;
    await this.db.prepare(`
      INSERT INTO otp_codes (user_id, resident_id, destination, purpose, code_hash, rate_limit_key, expires_at, registration_payload_json)
      VALUES (?, ?, ?, 'resident_login', ?, ?, ?, ?)
    `).bind(data.userId, data.residentId, data.destination, data.codeHash, data.rateLimitKey, data.expiresAt, payload).run();
  }

  countRecentOtps(rateLimitKey: string, since: string) {
    return this.db.prepare(`
      SELECT COUNT(*) AS count FROM otp_codes
      WHERE rate_limit_key = ? AND purpose = 'resident_login' AND requested_at >= ?
    `).bind(rateLimitKey, since).first<{ count: number }>();
  }

  countRecentOtpsForResident(residentId: number, since: string) {
    return this.db.prepare(`
      SELECT COUNT(*) AS count FROM otp_codes
      WHERE resident_id = ? AND purpose = 'resident_login' AND requested_at >= ?
    `).bind(residentId, since).first<{ count: number }>();
  }

  /**
   * Durable (D1) staff-login failure counter keyed by hashed identifier.
   * Complements isolate-local Map limiting; still not a global edge distributed limiter.
   */
  countRecentStaffLoginFailures(identifierHash: string, since: string) {
    return this.db.prepare(`
      SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'auth.staff.login_failed'
        AND created_at >= ?
        AND json_extract(metadata_json, '$.identifierHash') = ?
    `).bind(since, identifierHash).first<{ count: number }>();
  }

  /** Legacy listed-institution pending OTP lookup (institution code + student id). */
  findPendingOtp(institutionCode: string, studentId: string) {
    return this.db.prepare(`
      SELECT o.id, o.code_hash, o.attempt_count, o.max_attempts, o.expires_at, o.status,
        o.destination, o.rate_limit_key,
        r.id AS resident_id, u.id AS user_id
      FROM otp_codes o
      JOIN residents r ON r.id = o.resident_id
      JOIN users u ON u.id = o.user_id
      JOIN institutions i ON i.id = r.institution_id
      WHERE lower(i.code) = lower(?) AND r.student_id = ? AND o.purpose = 'resident_login' AND o.status = 'pending'
      ORDER BY o.requested_at DESC
      LIMIT 1
    `).bind(institutionCode, studentId).first<PendingOtpRecord>();
  }

  findPendingOtpByChallengeTokenHash(challengeTokenHash: string) {
    return this.db.prepare(`
      SELECT o.id, o.code_hash, o.attempt_count, o.max_attempts, o.expires_at, o.status,
        o.destination, o.rate_limit_key,
        r.id AS resident_id, u.id AS user_id
      FROM otp_codes o
      JOIN residents r ON r.id = o.resident_id
      JOIN users u ON u.id = o.user_id
      WHERE o.purpose = 'resident_login' AND o.status = 'pending'
        AND json_extract(o.registration_payload_json, '$.challengeTokenHash') = ?
      ORDER BY o.requested_at DESC
      LIMIT 1
    `).bind(challengeTokenHash).first<PendingOtpRecord>();
  }

  findPendingOtpByResidentId(residentId: number) {
    return this.db.prepare(`
      SELECT o.id, o.code_hash, o.attempt_count, o.max_attempts, o.expires_at, o.status,
        o.destination, o.rate_limit_key,
        r.id AS resident_id, u.id AS user_id
      FROM otp_codes o
      JOIN residents r ON r.id = o.resident_id
      JOIN users u ON u.id = o.user_id
      WHERE r.id = ? AND o.purpose = 'resident_login' AND o.status = 'pending'
      ORDER BY o.requested_at DESC
      LIMIT 1
    `).bind(residentId).first<PendingOtpRecord>();
  }

  async incrementOtpAttempt(id: number) {
    await this.db.prepare("UPDATE otp_codes SET attempt_count = attempt_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(id).run();
  }

  async markOtpUsed(id: number) {
    await this.db.prepare("UPDATE otp_codes SET status = 'used', used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(id).run();
  }

  async markOtpExpired(id: number) {
    await this.db.prepare("UPDATE otp_codes SET status = 'expired', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(id).run();
  }

  async writeAudit(actorUserId: number | null, actorStaffId: number | null, action: string, entityType: string, entityId: number | null, metadata?: Record<string, unknown>) {
    await this.db.prepare(`
      INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity_type, entity_id, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(actorUserId, actorStaffId, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null).run();
  }
}
