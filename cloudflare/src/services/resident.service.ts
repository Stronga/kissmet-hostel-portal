import type { AuthUser } from "../auth/context";
import { hashPassword, randomOtp, randomToken, sha256Hex, verifyPassword } from "../auth/crypto";
import { checkRateLimit } from "../auth/rate-limit";
import type { Env } from "../types/bindings";
import { AdminRepository } from "../repositories/admin.repository";
import type { SmsProvider } from "./sms.service";

const OTP_MINUTES = 10;
const SESSION_HOURS = 8;
const paymentMethods = new Set(["cash", "bank_transfer", "mobile_money", "card", "other"]);
const maintenanceCategories = new Set(["plumbing", "electrical", "furniture", "cleaning", "security", "other"]);
const maintenancePriorities = new Set(["low", "normal", "high", "urgent"]);

function futureIso(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function pastIso(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export class ResidentService {
  private readonly repo: AdminRepository;

  constructor(env: Env, private readonly sms: SmsProvider, private readonly documents?: R2Bucket, repo?: AdminRepository) {
    this.repo = repo ?? new AdminRepository(env.DB);
  }

  activeInstitutions() {
    return this.repo.all("SELECT code, name FROM institutions WHERE status = 'active' ORDER BY name");
  }

  activeAcademicSession() {
    return this.repo.first("SELECT id, code, name, starts_on, ends_on, status FROM academic_sessions WHERE status = 'active' ORDER BY id DESC LIMIT 1");
  }

  async requestRegistrationOtp(data: { firstName: string; middleName?: string | null; lastName: string; phone: string; email?: string | null; institutionCode: string; studentId: string }) {
    const institution = await this.repo.first<{ id: number; code: string }>("SELECT id, code FROM institutions WHERE lower(code) = lower(?) AND status = 'active'", data.institutionCode);
    const generic = { ok: true, message: "If registration can proceed, an OTP has been sent." };
    if (!institution) return generic;
    const duplicate = await this.repo.first("SELECT id FROM residents WHERE institution_id = ? AND student_id = ?", institution.id, data.studentId);
    if (duplicate) {
      await this.repo.audit(null, null, "resident.registration.existing_identity", "resident", null);
      return generic;
    }
    const key = `otp:phone_verification:${institution.code}:${data.studentId}`;
    const recent = await this.repo.first<{ count: number }>("SELECT COUNT(*) AS count FROM otp_codes WHERE rate_limit_key = ? AND purpose = 'phone_verification' AND requested_at >= ?", key, pastIso(15));
    if ((recent?.count ?? 0) >= 3 || !checkRateLimit(key, 3, 15 * 60_000)) return generic;
    const otp = randomOtp();
    await this.repo.run(
      "INSERT INTO otp_codes (destination, purpose, code_hash, rate_limit_key, expires_at, registration_payload_json) VALUES (?, 'phone_verification', ?, ?, ?, ?)",
      data.phone,
      await hashPassword(otp),
      key,
      futureIso(OTP_MINUTES),
      JSON.stringify({ ...data, institutionId: institution.id })
    );
    await this.sms.sendOtp(data.phone, otp);
    await this.repo.audit(null, null, "resident.registration.initiated", "registration", null);
    return generic;
  }

  async verifyRegistrationOtp(institutionCode: string, studentId: string, otp: string, userAgent?: string) {
    const keySuffix = `${institutionCode}:${studentId}`;
    const record = await this.repo.first<{ id: number; code_hash: string; attempt_count: number; max_attempts: number; expires_at: string; registration_payload_json: string }>(
      "SELECT id, code_hash, attempt_count, max_attempts, expires_at, registration_payload_json FROM otp_codes WHERE purpose = 'phone_verification' AND status = 'pending' AND rate_limit_key = ? ORDER BY requested_at DESC LIMIT 1",
      `otp:phone_verification:${keySuffix}`
    );
    if (!record || new Date(record.expires_at).getTime() <= Date.now()) throw new Error("Invalid or expired OTP");
    if (record.attempt_count >= record.max_attempts) throw new Error("OTP attempt limit reached");
    if (!await verifyPassword(otp, record.code_hash)) {
      await this.repo.run("UPDATE otp_codes SET attempt_count = attempt_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", record.id);
      throw new Error("Invalid or expired OTP");
    }
    const payload = JSON.parse(record.registration_payload_json) as { firstName: string; middleName?: string | null; lastName: string; phone: string; email?: string | null; institutionId: number; studentId: string };
    if (await this.repo.first("SELECT id FROM residents WHERE institution_id = ? AND student_id = ?", payload.institutionId, payload.studentId)) throw new Error("Registration already exists");
    const displayName = [payload.firstName, payload.middleName, payload.lastName].filter(Boolean).join(" ");
    const user = await this.repo.run("INSERT INTO users (email, phone, display_name, user_type, status) VALUES (?, ?, ?, 'resident', 'active')", payload.email ?? null, payload.phone, displayName);
    const residentCode = await this.repo.allocateResidentCode();
    const resident = await this.repo.run(
      "INSERT INTO residents (user_id, institution_id, resident_code, student_id, first_name, middle_name, last_name, status, phone_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'applicant', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
      user.meta.last_row_id,
      payload.institutionId,
      residentCode,
      payload.studentId,
      payload.firstName,
      payload.middleName ?? null,
      payload.lastName
    );
    await this.repo.run("UPDATE otp_codes SET user_id = ?, resident_id = ?, status = 'used', used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", user.meta.last_row_id, resident.meta.last_row_id, record.id);
    const token = randomToken(32);
    await this.repo.run("INSERT INTO sessions (user_id, session_token_hash, status, user_agent, expires_at) VALUES (?, ?, 'active', ?, ?)", user.meta.last_row_id, await sha256Hex(token), userAgent ?? null, futureIso(SESSION_HOURS * 60));
    await this.repo.audit(Number(user.meta.last_row_id), null, "resident.registration.phone_verified", "resident", Number(resident.meta.last_row_id));
    await this.repo.audit(Number(user.meta.last_row_id), null, "resident.registration.resident_created", "resident", Number(resident.meta.last_row_id), { residentCode });
    return { token, resident: await this.me({ residentId: Number(resident.meta.last_row_id) } as AuthUser) };
  }

  async me(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    return this.repo.first(`
      SELECT r.id, r.resident_code, r.first_name, r.middle_name, r.last_name, r.status, r.phone_verified_at,
             u.phone, u.email, i.code AS institution_code, i.name AS institution_name, r.student_id
      FROM residents r JOIN users u ON u.id = r.user_id LEFT JOIN institutions i ON i.id = r.institution_id
      WHERE r.id = ?
    `, actor.residentId);
  }

  async updateMe(actor: AuthUser, data: { firstName?: string | null; middleName?: string | null; lastName?: string | null; email?: string | null }) {
    if (!actor.residentId) throw new Error("Resident session required");
    await this.repo.run("UPDATE residents SET first_name = COALESCE(?, first_name), middle_name = COALESCE(?, middle_name), last_name = COALESCE(?, last_name), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", data.firstName ?? null, data.middleName ?? null, data.lastName ?? null, actor.residentId);
    if (data.email) await this.repo.run("UPDATE users SET email = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", data.email, actor.id);
    await this.repo.audit(actor.id, null, "resident.profile.updated", "resident", actor.residentId);
    return this.me(actor);
  }

  async uploadIdentityDocument(actor: AuthUser, type: "student_card" | "ghana_card", file: File) {
    if (!actor.residentId) throw new Error("Resident session required");
    if (!this.documents) throw new Error("Document storage is not configured");
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) throw new Error("Unsupported document type");
    if (file.size > 5 * 1024 * 1024) throw new Error("Document file too large");
    const key = `identity/${actor.residentId}/${type}/${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
    await this.documents.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    const res = await this.repo.run("INSERT INTO documents (owner_user_id, resident_id, document_type, status, r2_bucket, r2_key, original_filename, content_type, size_bytes, uploaded_by_user_id) VALUES (?, ?, ?, 'uploaded', 'DOCUMENTS', ?, ?, ?, ?, ?)", actor.id, actor.residentId, type, key, file.name, file.type, file.size, actor.id);
    await this.repo.audit(actor.id, null, `resident.document.${type}_uploaded`, "document", res.meta.last_row_id);
    return this.repo.get("documents", Number(res.meta.last_row_id));
  }

  documentsFor(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    return this.repo.all("SELECT id, document_type, status, original_filename, content_type, size_bytes, created_at FROM documents WHERE resident_id = ? ORDER BY id DESC", actor.residentId);
  }

  async ownDocument(actor: AuthUser, id: number) {
    if (!actor.residentId) throw new Error("Resident session required");
    const doc = await this.repo.first<Record<string, unknown>>("SELECT id, document_type, status, original_filename, content_type, size_bytes, created_at FROM documents WHERE id = ? AND resident_id = ?", id, actor.residentId);
    if (!doc) throw new Error("Document not found");
    return doc;
  }

  async createApplication(actor: AuthUser, academicSessionId: number) {
    if (!actor.residentId) throw new Error("Resident session required");
    const session = await this.repo.first("SELECT id FROM academic_sessions WHERE id = ? AND status = 'active'", academicSessionId);
    if (!session) throw new Error("Active academic session not found");
    const number = await this.repo.allocateApplicationNumber();
    const res = await this.repo.run("INSERT INTO applications (resident_id, academic_session_id, application_number, status) VALUES (?, ?, ?, 'draft')", actor.residentId, academicSessionId, number);
    await this.repo.audit(actor.id, null, "resident.application.created", "application", res.meta.last_row_id);
    return this.repo.get("applications", Number(res.meta.last_row_id));
  }

  applications(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    return this.repo.all("SELECT id, application_number, academic_session_id, status, created_at, submitted_at, reviewed_at, decision_notes FROM applications WHERE resident_id = ? ORDER BY id DESC", actor.residentId);
  }

  async ownApplication(actor: AuthUser, id: number) {
    if (!actor.residentId) throw new Error("Resident session required");
    const app = await this.repo.first<Record<string, unknown>>("SELECT id, application_number, academic_session_id, status, created_at, submitted_at, reviewed_at, decision_notes FROM applications WHERE id = ? AND resident_id = ?", id, actor.residentId);
    if (!app) throw new Error("Application not found");
    return app;
  }

  async updateApplication(actor: AuthUser, id: number, data: { notes?: string | null }) {
    const app = await this.ownApplication(actor, id);
    if (app.status !== "draft") throw new Error("Invalid workflow transition");
    await this.repo.run("UPDATE applications SET decision_notes = COALESCE(?, decision_notes), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", data.notes ?? null, id);
    await this.repo.audit(actor.id, null, "resident.application.updated", "application", id);
    return this.ownApplication(actor, id);
  }

  async submitApplication(actor: AuthUser, id: number) {
    const app = await this.ownApplication(actor, id);
    if (app.status !== "draft") throw new Error("Invalid workflow transition");
    const profile = await this.me(actor) as Record<string, unknown> | null;
    const docs = await this.repo.first<{ count: number }>("SELECT COUNT(*) AS count FROM documents WHERE resident_id = ? AND document_type IN ('student_card', 'ghana_card') AND status IN ('uploaded', 'verified')", actor.residentId);
    if (!profile?.phone_verified_at || !profile?.student_id || !profile?.first_name || !profile?.last_name || (docs?.count ?? 0) < 2) throw new Error("Incomplete application");
    await this.repo.run("UPDATE applications SET status = 'submitted', submitted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", id);
    await this.repo.audit(actor.id, null, "resident.application.submitted", "application", id);
    return this.ownApplication(actor, id);
  }

  bookings(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    return this.repo.all(`
      SELECT b.id, b.booking_number, b.academic_session_id, b.application_id, b.status,
             b.total_amount_minor, b.currency, b.booked_at, b.expires_at, b.cancelled_at,
             b.completed_at, b.created_at, b.payment_attention_required, b.payment_attention_reason,
             s.code AS academic_session_code, s.name AS academic_session_name,
             a.application_number,
             room.room_code AS priced_room_code, room.room_name AS priced_room_name
      FROM bookings b
      LEFT JOIN academic_sessions s ON s.id = b.academic_session_id
      LEFT JOIN applications a ON a.id = b.application_id
      LEFT JOIN rooms room ON room.id = b.priced_room_id
      WHERE b.resident_id = ?
      ORDER BY b.id DESC
    `, actor.residentId);
  }

  payments(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    return this.repo.all(`
      SELECT p.id, p.booking_id, p.payment_reference, p.status, p.amount_minor, p.currency,
             p.method, p.paid_at, p.submitted_at, p.verified_at, p.created_at,
             b.booking_number,
             d.id AS slip_document_id, d.original_filename AS slip_filename,
             d.content_type AS slip_content_type, d.size_bytes AS slip_size_bytes
      FROM payments p
      LEFT JOIN bookings b ON b.id = p.booking_id
      LEFT JOIN documents d ON d.payment_id = p.id AND d.document_type = 'payment_slip' AND d.status <> 'archived'
      WHERE p.resident_id = ?
      ORDER BY p.id DESC
    `, actor.residentId);
  }

  async paymentSummary(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    const booking = await this.repo.first<Record<string, unknown>>("SELECT * FROM bookings WHERE resident_id = ? AND status IN ('pending', 'confirmed') ORDER BY id DESC LIMIT 1", actor.residentId);
    if (!booking) return null;
    const totals = await this.repo.first<{ verified_minor: number; submitted_minor: number; pending_minor: number; refunded_minor: number }>(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'verified' THEN amount_minor ELSE 0 END), 0) AS verified_minor,
        COALESCE(SUM(CASE WHEN status = 'submitted' THEN amount_minor ELSE 0 END), 0) AS submitted_minor,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_minor ELSE 0 END), 0) AS pending_minor,
        COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_minor ELSE 0 END), 0) AS refunded_minor
      FROM payments
      WHERE booking_id = ? AND resident_id = ?
    `, booking.id, actor.residentId);
    const setting = await this.repo.first<{ requirement_type: string; fixed_amount_minor: number | null; percentage_basis_points: number | null }>("SELECT requirement_type, fixed_amount_minor, percentage_basis_points FROM payment_confirmation_settings WHERE id = 1 AND status = 'active'");
    const total = Number(booking.total_amount_minor);
    const verified = Number(totals?.verified_minor ?? 0);
    const required = this.requiredConfirmationAmount(total, setting ?? { requirement_type: "full", fixed_amount_minor: null, percentage_basis_points: null });
    return {
      bookingId: booking.id,
      bookingNumber: booking.booking_number,
      bookingStatus: booking.status,
      bookingTotalMinor: total,
      verifiedTotalMinor: verified,
      outstandingMinor: Math.max(total - verified, 0),
      submittedTotalMinor: Number(totals?.submitted_minor ?? 0),
      pendingTotalMinor: Number(totals?.pending_minor ?? 0),
      refundedTotalMinor: Number(totals?.refunded_minor ?? 0),
      requiredConfirmationAmountMinor: required,
      remainingToConfirmationMinor: Math.max(required - verified, 0),
      confirmationRequirementMet: verified >= required,
      currency: booking.currency ?? "GHS",
      paymentAttentionRequired: Boolean(booking.payment_attention_required),
      paymentAttentionReason: booking.payment_attention_reason ?? null
    };
  }

  private requiredConfirmationAmount(total: number, setting: { requirement_type: string; fixed_amount_minor: number | null; percentage_basis_points: number | null }) {
    if (setting.requirement_type === "fixed") return Math.min(Number(setting.fixed_amount_minor ?? total), total);
    if (setting.requirement_type === "percentage") return Math.ceil(total * Number(setting.percentage_basis_points ?? 10000) / 10000);
    return total;
  }

  async createPayment(actor: AuthUser, data: { bookingId: number; amountMinor: number; currency: string; method: string; paidAt?: string | null; notes?: string | null }) {
    if (!actor.residentId) throw new Error("Resident session required");
    if (!paymentMethods.has(data.method)) throw new Error("Invalid payment method");
    if (data.amountMinor <= 0) throw new Error("Payment amount must be positive");
    const booking = await this.repo.first<Record<string, unknown>>("SELECT * FROM bookings WHERE id = ? AND resident_id = ? AND status IN ('pending', 'confirmed')", data.bookingId, actor.residentId);
    if (!booking) throw new Error("Booking not found");
    if (String(data.currency).toUpperCase() !== String(booking.currency).toUpperCase()) throw new Error("Payment currency must match booking currency");
    const totals = await this.repo.first<{ verified_minor: number }>("SELECT COALESCE(SUM(amount_minor), 0) AS verified_minor FROM payments WHERE booking_id = ? AND resident_id = ? AND status = 'verified'", data.bookingId, actor.residentId);
    const outstandingMinor = Math.max(Number(booking.total_amount_minor) - Number(totals?.verified_minor ?? 0), 0);
    if (data.amountMinor > outstandingMinor) throw new Error("Payment would exceed booking total");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const paymentReference = await this.repo.allocatePaymentReference();
      try {
        const res = await this.repo.run(
          "INSERT INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method, paid_at, notes) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
          data.bookingId,
          actor.residentId,
          paymentReference,
          data.amountMinor,
          data.currency,
          data.method,
          data.paidAt ?? null,
          data.notes ?? null
        );
        await this.repo.audit(actor.id, null, "resident.payment.created", "payment", res.meta.last_row_id, { bookingId: data.bookingId, amountMinor: data.amountMinor });
        return this.repo.get("payments", Number(res.meta.last_row_id));
      } catch (error) {
        if (String((error as Error).message).includes("payment_reference") && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error("Unable to create payment with unique payment reference");
  }

  async submitPayment(actor: AuthUser, paymentId: number) {
    if (!actor.residentId) throw new Error("Resident session required");
    const payment = await this.repo.first<Record<string, unknown>>("SELECT * FROM payments WHERE id = ? AND resident_id = ?", paymentId, actor.residentId);
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "pending") throw new Error("Invalid workflow transition");
    await this.repo.run("UPDATE payments SET status = 'submitted', submitted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", paymentId);
    await this.repo.audit(actor.id, null, "resident.payment.submitted", "payment", paymentId);
    return this.repo.get("payments", paymentId);
  }

  async uploadPaymentSlip(actor: AuthUser, paymentId: number, file: File) {
    if (!actor.residentId) throw new Error("Resident session required");
    if (!this.documents) throw new Error("Document storage is not configured");
    const payment = await this.repo.first<Record<string, unknown>>("SELECT * FROM payments WHERE id = ? AND resident_id = ?", paymentId, actor.residentId);
    if (!payment) throw new Error("Payment not found");
    if (!["pending", "submitted"].includes(String(payment.status))) throw new Error("Invalid workflow transition");
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) throw new Error("Unsupported payment slip file type");
    if (file.size > 5 * 1024 * 1024) throw new Error("Payment slip file too large");
    const key = `payment-slips/${payment.payment_reference}/${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
    await this.documents.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    const res = await this.repo.run(
      "INSERT INTO documents (owner_user_id, resident_id, booking_id, payment_id, document_type, status, r2_bucket, r2_key, original_filename, content_type, size_bytes, uploaded_by_user_id) VALUES (?, ?, ?, ?, 'payment_slip', 'uploaded', 'DOCUMENTS', ?, ?, ?, ?, ?)",
      actor.id,
      actor.residentId,
      payment.booking_id,
      paymentId,
      key,
      file.name,
      file.type,
      file.size,
      actor.id
    );
    await this.repo.audit(actor.id, null, "resident.payment.slip_uploaded", "document", res.meta.last_row_id, { paymentId });
    return this.repo.get("documents", Number(res.meta.last_row_id));
  }

  receipts(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    return this.repo.all(`
      SELECT rec.id, rec.receipt_number, rec.status, rec.issued_at, rec.voided_at,
             p.payment_reference, p.amount_minor, p.currency, p.method, p.verified_at
      FROM receipts rec
      JOIN payments p ON p.id = rec.payment_id
      WHERE p.resident_id = ?
      ORDER BY rec.id DESC
    `, actor.residentId);
  }

  async receipt(actor: AuthUser, id: number) {
    if (!actor.residentId) throw new Error("Resident session required");
    const receipt = await this.repo.first(`
      SELECT rec.id, rec.receipt_number, rec.status, rec.issued_at, rec.voided_at,
             p.payment_reference, p.amount_minor, p.currency, p.method, p.verified_at
      FROM receipts rec
      JOIN payments p ON p.id = rec.payment_id
      WHERE rec.id = ? AND p.resident_id = ?
    `, id, actor.residentId);
    if (!receipt) throw new Error("Receipt not found");
    return receipt;
  }

  allocation(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    return this.repo.first(`
      SELECT a.id, a.status, a.starts_on, a.ends_on, a.assigned_at, a.released_at,
             room.room_code, room.room_name, room.gender_policy AS room_gender_policy, room.status AS room_status,
             b.bed_code, b.label,
             s.code AS academic_session_code, s.name AS academic_session_name,
             bk.booking_number
      FROM allocations a
      JOIN beds b ON b.id = a.bed_id
      JOIN rooms room ON room.id = b.room_id
      JOIN academic_sessions s ON s.id = a.academic_session_id
      JOIN bookings bk ON bk.id = a.booking_id
      WHERE a.resident_id = ? AND a.status = 'active'
      ORDER BY a.id DESC
      LIMIT 1
    `, actor.residentId);
  }

  allocations(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    return this.repo.all(`
      SELECT a.id, a.status, a.starts_on, a.ends_on, a.assigned_at, a.released_at,
             room.room_code, room.room_name, room.gender_policy AS room_gender_policy, room.status AS room_status,
             b.bed_code, b.label,
             s.code AS academic_session_code, s.name AS academic_session_name,
             bk.booking_number
      FROM allocations a
      JOIN beds b ON b.id = a.bed_id
      JOIN rooms room ON room.id = b.room_id
      JOIN academic_sessions s ON s.id = a.academic_session_id
      JOIN bookings bk ON bk.id = a.booking_id
      WHERE a.resident_id = ?
      ORDER BY CASE WHEN a.status = 'active' THEN 0 ELSE 1 END, COALESCE(a.starts_on, a.assigned_at) DESC, a.id DESC
    `, actor.residentId);
  }

  private maintenanceSelect(where: string) {
    return `
      SELECT m.id, m.request_number, m.category, m.priority, m.status, m.title, m.description,
             m.opened_at, m.assigned_at, m.started_at, m.resolved_at, m.closed_at,
             room.room_code, room.room_name,
             b.bed_code, b.label AS bed_label
      FROM maintenance_requests m
      LEFT JOIN rooms room ON room.id = m.room_id
      LEFT JOIN beds b ON b.id = m.bed_id
      WHERE ${where}
    `;
  }

  async createMaintenance(actor: AuthUser, data: { category: string; priority?: string; title: string; description?: string | null }) {
    if (!actor.residentId) throw new Error("Resident session required");
    if (!maintenanceCategories.has(data.category)) throw new Error("Invalid maintenance category");
    const priority = data.priority ?? "normal";
    if (!maintenancePriorities.has(priority)) throw new Error("Invalid maintenance priority");
    if (!data.title.trim()) throw new Error("title is required");
    const allocation = await this.repo.first<{ bed_id: number }>("SELECT bed_id FROM allocations WHERE resident_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", actor.residentId);
    const number = await this.repo.allocateMaintenanceRequestNumber();
    const res = await this.repo.run(
      "INSERT INTO maintenance_requests (request_number, resident_id, room_id, bed_id, category, priority, status, title, description) VALUES (?, ?, (SELECT room_id FROM beds WHERE id = ?), ?, ?, ?, 'open', ?, ?)",
      number,
      actor.residentId,
      allocation?.bed_id ?? null,
      allocation?.bed_id ?? null,
      data.category,
      priority,
      data.title,
      data.description ?? null
    );
    await this.repo.audit(actor.id, null, "resident.maintenance.created", "maintenance_request", res.meta.last_row_id, { requestNumber: number });
    return this.ownMaintenance(actor, Number(res.meta.last_row_id));
  }

  maintenance(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    return this.repo.all(`${this.maintenanceSelect("m.resident_id = ?")} ORDER BY m.id DESC`, actor.residentId);
  }

  async ownMaintenance(actor: AuthUser, id: number) {
    if (!actor.residentId) throw new Error("Resident session required");
    const row = await this.repo.first(`${this.maintenanceSelect("m.id = ? AND m.resident_id = ?")} LIMIT 1`, id, actor.residentId);
    if (!row) throw new Error("Maintenance request not found");
    return row;
  }

  announcements(actor: AuthUser) {
    if (!actor.residentId) throw new Error("Resident session required");
    return this.repo.all("SELECT a.id, a.title, a.body, a.audience, a.severity, a.published_at, a.starts_at, a.expires_at FROM announcements a JOIN announcement_channels c ON c.announcement_id = a.id AND c.channel = 'resident_portal' AND c.status = 'enabled' WHERE a.status = 'published' AND a.audience IN ('all', 'residents') AND (a.starts_at IS NULL OR a.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AND (a.expires_at IS NULL OR a.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ORDER BY COALESCE(a.starts_at, a.published_at, a.created_at) DESC, a.id DESC");
  }

  async announcement(actor: AuthUser, id: number) {
    if (!actor.residentId) throw new Error("Resident session required");
    const row = await this.repo.first("SELECT a.id, a.title, a.body, a.audience, a.severity, a.published_at, a.starts_at, a.expires_at FROM announcements a JOIN announcement_channels c ON c.announcement_id = a.id AND c.channel = 'resident_portal' AND c.status = 'enabled' WHERE a.id = ? AND a.status = 'published' AND a.audience IN ('all', 'residents') AND (a.starts_at IS NULL OR a.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AND (a.expires_at IS NULL OR a.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))", id);
    if (!row) throw new Error("Announcement not found");
    return row;
  }
}
