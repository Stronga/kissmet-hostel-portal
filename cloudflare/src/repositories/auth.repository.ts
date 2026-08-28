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
}

export interface ResidentLoginRecord {
  resident_id: number;
  resident_code: string;
  institution_code: string;
  student_id: string;
  user_id: number;
  display_name: string;
  user_status: string;
  resident_status: string;
  phone: string | null;
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
  resident_id: number | null;
  role_code: string | null;
}

export class AuthRepository {
  constructor(private readonly db: Env["DB"]) {}

  findStaffByIdentifier(identifier: string) {
    return this.db.prepare(`
      SELECT u.id AS user_id, u.email, u.username, u.display_name, u.status AS user_status,
        u.password_hash, st.id AS staff_id, st.status AS staff_status, r.code AS role_code
      FROM users u
      JOIN staff st ON st.user_id = u.id
      JOIN roles r ON r.id = st.role_id
      WHERE lower(u.email) = lower(?) OR lower(u.username) = lower(?)
      LIMIT 1
    `).bind(identifier, identifier).first<StaffLoginRecord>();
  }

  findResidentByStudentId(institutionCode: string, studentId: string) {
    return this.db.prepare(`
      SELECT r.id AS resident_id, r.resident_code, i.code AS institution_code, r.student_id,
        u.id AS user_id, u.display_name,
        u.status AS user_status, r.status AS resident_status, u.phone
      FROM residents r
      JOIN users u ON u.id = r.user_id
      JOIN institutions i ON i.id = r.institution_id
      WHERE lower(i.code) = lower(?) AND r.student_id = ?
      LIMIT 1
    `).bind(institutionCode, studentId).first<ResidentLoginRecord>();
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
        st.id AS staff_id, res.id AS resident_id, roles.code AS role_code
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN staff st ON st.user_id = u.id
      LEFT JOIN roles ON roles.id = st.role_id
      LEFT JOIN residents res ON res.user_id = u.id
      WHERE s.session_token_hash = ?
      LIMIT 1
    `).bind(tokenHash).first<SessionRecord>();
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
  }) {
    await this.db.prepare(`
      INSERT INTO otp_codes (user_id, resident_id, destination, purpose, code_hash, rate_limit_key, expires_at)
      VALUES (?, ?, ?, 'resident_login', ?, ?, ?)
    `).bind(data.userId, data.residentId, data.destination, data.codeHash, data.rateLimitKey, data.expiresAt).run();
  }

  countRecentOtps(rateLimitKey: string, since: string) {
    return this.db.prepare(`
      SELECT COUNT(*) AS count FROM otp_codes
      WHERE rate_limit_key = ? AND purpose = 'resident_login' AND requested_at >= ?
    `).bind(rateLimitKey, since).first<{ count: number }>();
  }

  findPendingOtp(institutionCode: string, studentId: string) {
    return this.db.prepare(`
      SELECT o.id, o.code_hash, o.attempt_count, o.max_attempts, o.expires_at, o.status,
        r.id AS resident_id, u.id AS user_id
      FROM otp_codes o
      JOIN residents r ON r.id = o.resident_id
      JOIN users u ON u.id = o.user_id
      JOIN institutions i ON i.id = r.institution_id
      WHERE lower(i.code) = lower(?) AND r.student_id = ? AND o.purpose = 'resident_login' AND o.status = 'pending'
      ORDER BY o.requested_at DESC
      LIMIT 1
    `).bind(institutionCode, studentId).first<{ id: number; code_hash: string; attempt_count: number; max_attempts: number; expires_at: string; status: string; resident_id: number; user_id: number }>();
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
