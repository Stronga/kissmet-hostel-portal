import { hashPassword, randomToken } from "../auth/crypto";
import type { AuthUser } from "../auth/context";
import { AdminRepository } from "../repositories/admin.repository";

type ApplicationStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "cancelled" | "archived";
type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired" | "completed" | "archived";
type AllocationStatus = "active" | "ended" | "cancelled" | "transferred" | "archived";
type PaymentStatus = "pending" | "submitted" | "verified" | "rejected" | "refunded" | "cancelled" | "archived";
type MaintenanceStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed" | "cancelled" | "archived";
type AnnouncementStatus = "draft" | "published" | "expired" | "archived";

export class AdminService {
  constructor(private readonly repo: AdminRepository, private readonly documents?: R2Bucket) {}

  list(table: string, limit: number, offset: number, search?: string) {
    return this.repo.list(table, limit, offset, search);
  }

  get(table: string, id: number) {
    return this.repo.get(table, id);
  }

  async dashboard() {
    const row = await this.repo.first<Record<string, unknown>>(`
      SELECT
        (SELECT COUNT(*) FROM residents) AS total_residents,
        (SELECT COUNT(*) FROM residents WHERE status = 'applicant') AS applicants,
        (SELECT COUNT(*) FROM residents WHERE status = 'resident') AS active_residents,
        (SELECT COUNT(*) FROM rooms) AS total_rooms,
        (SELECT COUNT(*) FROM beds WHERE status = 'available') AS total_active_beds,
        (SELECT COUNT(*) FROM allocations WHERE status = 'active') AS occupied_beds,
        ((SELECT COUNT(*) FROM beds WHERE status = 'available') - (SELECT COUNT(*) FROM allocations WHERE status = 'active')) AS available_beds,
        CASE WHEN (SELECT COUNT(*) FROM beds WHERE status = 'available') = 0 THEN 0 ELSE ROUND(((SELECT COUNT(*) FROM allocations WHERE status = 'active') * 100.0) / (SELECT COUNT(*) FROM beds WHERE status = 'available'), 2) END AS occupancy_percentage,
        (SELECT COUNT(*) FROM applications WHERE status = 'submitted') AS pending_applications,
        (SELECT COUNT(*) FROM applications WHERE status = 'under_review') AS under_review_applications,
        (SELECT COUNT(*) FROM applications WHERE status = 'approved') AS approved_applications,
        (SELECT COUNT(*) FROM bookings WHERE status = 'pending') AS pending_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed') AS confirmed_bookings,
        (SELECT COUNT(*) FROM maintenance_requests WHERE status IN ('open', 'assigned', 'in_progress')) AS open_maintenance_requests,
        (SELECT COUNT(*) FROM maintenance_requests WHERE priority = 'urgent' AND status IN ('open', 'assigned', 'in_progress')) AS urgent_maintenance_requests,
        (SELECT COUNT(*) FROM announcements WHERE status = 'published' AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) AS published_announcements,
        (SELECT name FROM academic_sessions WHERE status = 'active' LIMIT 1) AS active_academic_session,
        (SELECT COUNT(*) FROM staff WHERE status = 'active') AS active_staff_count
    `);
    return row ?? {};
  }

  async createAcademicSession(actor: AuthUser, data: { code: string; name: string; startsOn: string; endsOn: string; status?: string }) {
    const res = await this.repo.run("INSERT INTO academic_sessions (code, name, starts_on, ends_on, status) VALUES (?, ?, ?, ?, ?)", data.code, data.name, data.startsOn, data.endsOn, data.status ?? "draft");
    await this.repo.audit(actor.id, actor.staffId, "admin.academic_session.create", "academic_session", res.meta.last_row_id);
    return this.get("academic_sessions", Number(res.meta.last_row_id));
  }

  async updateStatus(actor: AuthUser, table: string, id: number, status: string) {
    if (table === "academic_sessions" && status === "active") {
      await this.repo.run("UPDATE academic_sessions SET status = 'closed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'active' AND id <> ?", id);
    }
    await this.repo.run(`UPDATE ${table} SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`, status, id);
    await this.repo.audit(actor.id, actor.staffId, `admin.${table}.status`, table, id, { status });
    return this.get(table, id);
  }

  async createInstitution(actor: AuthUser, data: { code: string; name: string; status?: string }) {
    const res = await this.repo.run("INSERT INTO institutions (code, name, status) VALUES (?, ?, ?)", data.code, data.name, data.status ?? "active");
    await this.repo.audit(actor.id, actor.staffId, "admin.institution.create", "institution", res.meta.last_row_id);
    return this.get("institutions", Number(res.meta.last_row_id));
  }

  async createRoom(actor: AuthUser, data: { roomCode: string; roomName?: string | null; floor?: string | null; capacity: number; genderPolicy?: string; status?: string }) {
    const res = await this.repo.run("INSERT INTO rooms (room_code, room_name, floor, capacity, gender_policy, status) VALUES (?, ?, ?, ?, ?, ?)", data.roomCode, data.roomName ?? null, data.floor ?? null, data.capacity, data.genderPolicy ?? "any", data.status ?? "available");
    await this.repo.audit(actor.id, actor.staffId, "admin.room.create", "room", res.meta.last_row_id);
    return this.room(Number(res.meta.last_row_id));
  }

  async room(id: number) {
    return this.repo.first(`
      SELECT r.*,
        (SELECT COUNT(*) FROM beds b WHERE b.room_id = r.id AND b.status = 'available') AS bed_count,
        (SELECT COUNT(*) FROM allocations a JOIN beds b ON b.id = a.bed_id WHERE b.room_id = r.id AND a.status = 'active') AS active_occupancy,
        ((SELECT COUNT(*) FROM beds b WHERE b.room_id = r.id AND b.status = 'available') - (SELECT COUNT(*) FROM allocations a JOIN beds b ON b.id = a.bed_id WHERE b.room_id = r.id AND a.status = 'active')) AS availability
      FROM rooms r WHERE r.id = ?
    `, id);
  }

  async createBed(actor: AuthUser, data: { roomId: number; bedCode: string; label: string; status?: string }) {
    const room = await this.repo.first<{ capacity: number; active_beds: number }>("SELECT capacity, (SELECT COUNT(*) FROM beds WHERE room_id = rooms.id AND status <> 'archived') AS active_beds FROM rooms WHERE id = ?", data.roomId);
    if (!room) throw new Error("Room not found");
    if ((data.status ?? "available") !== "archived" && room.active_beds >= room.capacity) throw new Error("Room capacity exceeded");
    const res = await this.repo.run("INSERT INTO beds (room_id, bed_code, label, status) VALUES (?, ?, ?, ?)", data.roomId, data.bedCode, data.label, data.status ?? "available");
    await this.repo.audit(actor.id, actor.staffId, "admin.bed.create", "bed", res.meta.last_row_id);
    return this.get("beds", Number(res.meta.last_row_id));
  }

  async createRoomRate(actor: AuthUser, data: { roomId: number; academicSessionId: number; rateCode: string; amountMinor: number; currency?: string; status?: string }) {
    const res = await this.repo.run("INSERT INTO room_rates (room_id, academic_session_id, rate_code, amount_minor, currency, status) VALUES (?, ?, ?, ?, ?, ?)", data.roomId, data.academicSessionId, data.rateCode, data.amountMinor, data.currency ?? "GHS", data.status ?? "active");
    await this.repo.audit(actor.id, actor.staffId, "admin.room_rate.create", "room_rate", res.meta.last_row_id);
    return this.get("room_rates", Number(res.meta.last_row_id));
  }

  async createResident(actor: AuthUser, data: { email?: string | null; phone?: string | null; displayName: string; institutionId: number; studentId: string; firstName: string; lastName: string; gender?: string | null; status?: string }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const residentCode = await this.repo.allocateResidentCode();
      const user = await this.repo.run("INSERT INTO users (email, phone, display_name, user_type, status) VALUES (?, ?, ?, 'resident', 'active')", data.email ?? null, data.phone ?? null, data.displayName);
      try {
        const res = await this.repo.run("INSERT INTO residents (user_id, institution_id, resident_code, student_id, first_name, last_name, gender, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", user.meta.last_row_id, data.institutionId, residentCode, data.studentId, data.firstName, data.lastName, data.gender ?? null, data.status ?? "applicant");
        await this.repo.audit(actor.id, actor.staffId, "admin.resident.create", "resident", res.meta.last_row_id, { residentCode });
        return this.get("residents", Number(res.meta.last_row_id));
      } catch (error) {
        if (String((error as Error).message).includes("resident_code") && attempt < 2) continue;
        throw error;
      }
    }

    throw new Error("Unable to create resident with unique resident code");
  }

  async createApplication(actor: AuthUser, data: { residentId: number; academicSessionId: number; applicationNumber: string; notes?: string | null }) {
    const res = await this.repo.run(
      "INSERT INTO applications (resident_id, academic_session_id, application_number, status, decision_notes) VALUES (?, ?, ?, 'draft', ?)",
      data.residentId,
      data.academicSessionId,
      data.applicationNumber,
      data.notes ?? null
    );
    await this.repo.audit(actor.id, actor.staffId, "admin.application.create", "application", res.meta.last_row_id);
    return this.get("applications", Number(res.meta.last_row_id));
  }

  async updateApplicationStatus(actor: AuthUser, id: number, status: ApplicationStatus, notes?: string | null) {
    const app = await this.get("applications", id) as Record<string, unknown> | null;
    if (!app) throw new Error("Application not found");
    const current = app.status as ApplicationStatus;
    const allowed: Record<ApplicationStatus, ApplicationStatus[]> = {
      draft: ["submitted", "cancelled", "archived"],
      submitted: ["under_review", "cancelled"],
      under_review: ["approved", "rejected"],
      approved: ["archived"],
      rejected: ["archived"],
      cancelled: ["archived"],
      archived: []
    };
    if (!allowed[current]?.includes(status)) throw new Error("Invalid workflow transition");
    const reviewed = status === "under_review" || status === "approved" || status === "rejected";
    await this.repo.run(
      `UPDATE applications SET status = ?, submitted_at = CASE WHEN ? = 'submitted' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE submitted_at END, reviewed_by_staff_id = CASE WHEN ? THEN ? ELSE reviewed_by_staff_id END, reviewed_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE reviewed_at END, decision_notes = COALESCE(?, decision_notes), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      status,
      status,
      reviewed ? 1 : 0,
      actor.staffId,
      reviewed ? 1 : 0,
      notes ?? null,
      id
    );
    const action = status === "under_review" ? "admin.application.review_started" : `admin.application.${status}`;
    await this.repo.audit(actor.id, actor.staffId, action, "application", id, { from: current, to: status });
    return this.get("applications", id);
  }

  async createBooking(actor: AuthUser, data: { applicationId: number; roomId: number; expiresAt?: string | null }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const application = await this.repo.first<Record<string, unknown>>("SELECT * FROM applications WHERE id = ?", data.applicationId);
      if (!application) throw new Error("Application not found");
      if (application.status !== "approved") throw new Error("Only approved applications may be booked");
      const duplicate = await this.repo.first("SELECT id FROM bookings WHERE resident_id = ? AND academic_session_id = ? AND status IN ('pending', 'confirmed')", application.resident_id, application.academic_session_id);
      if (duplicate) throw new Error("Duplicate active booking");
      const rate = await this.repo.first<{ id: number; amount_minor: number; currency: string }>("SELECT id, amount_minor, currency FROM room_rates WHERE room_id = ? AND academic_session_id = ? AND status = 'active' LIMIT 1", data.roomId, application.academic_session_id);
      if (!rate) throw new Error("Missing active room rate");
      const bookingNumber = await this.repo.allocateBookingNumber();
      try {
        const res = await this.repo.run(
          "INSERT INTO bookings (resident_id, academic_session_id, application_id, booking_number, status, total_amount_minor, currency, expires_at, priced_room_id, priced_room_rate_id) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
          application.resident_id,
          application.academic_session_id,
          data.applicationId,
          bookingNumber,
          rate.amount_minor,
          rate.currency ?? "GHS",
          data.expiresAt ?? null,
          data.roomId,
          rate.id
        );
        await this.repo.audit(actor.id, actor.staffId, "admin.booking.create", "booking", res.meta.last_row_id, { bookingNumber, applicationId: data.applicationId, roomId: data.roomId });
        return this.get("bookings", Number(res.meta.last_row_id));
      } catch (error) {
        if (String((error as Error).message).includes("booking_number") && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error("Unable to create booking with unique booking number");
  }

  async updateBookingStatus(actor: AuthUser, id: number, status: BookingStatus) {
    const booking = await this.get("bookings", id) as Record<string, unknown> | null;
    if (!booking) throw new Error("Booking not found");
    const current = booking.status as BookingStatus;
    const allowed: Record<BookingStatus, BookingStatus[]> = {
      pending: ["confirmed", "cancelled", "expired", "archived"],
      confirmed: ["completed", "cancelled", "archived"],
      cancelled: ["archived"],
      expired: ["archived"],
      completed: ["archived"],
      archived: []
    };
    if (!allowed[current]?.includes(status)) throw new Error("Invalid workflow transition");
    if (current === "pending" && status === "confirmed") {
      const summary = await this.bookingPaymentSummary(id);
      if (!summary.confirmationRequirementMet) throw new Error("Payment confirmation requirement not satisfied");
    }
    await this.repo.run("UPDATE bookings SET status = ?, cancelled_at = CASE WHEN ? = 'cancelled' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE cancelled_at END, completed_at = CASE WHEN ? = 'completed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE completed_at END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", status, status, status, id);
    await this.repo.audit(actor.id, actor.staffId, `admin.booking.${status}`, "booking", id, { from: current, to: status });
    return this.get("bookings", id);
  }

  async availability(academicSessionId: number, residentId?: number | null) {
    const resident = residentId ? await this.repo.first<{ gender: string | null }>("SELECT gender FROM residents WHERE id = ?", residentId) : null;
    const gender = resident?.gender ?? null;
    const rows = await this.repo.all(`
      SELECT r.id AS room_id, r.room_code, r.room_name, r.capacity, r.gender_policy,
             b.id AS bed_id, b.bed_code, b.label, rr.amount_minor, rr.currency
      FROM beds b
      JOIN rooms r ON r.id = b.room_id
      JOIN room_rates rr ON rr.room_id = r.id AND rr.academic_session_id = ? AND rr.status = 'active'
      WHERE r.status = 'available'
        AND b.status = 'available'
        AND (r.gender_policy = 'any' OR ? IS NULL OR r.gender_policy = ?)
        AND (SELECT COUNT(*) FROM beds bx WHERE bx.room_id = r.id AND bx.status <> 'archived') <= r.capacity
        AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.bed_id = b.id AND a.status = 'active')
      ORDER BY r.room_code, b.label
    `, academicSessionId, gender, gender);
    return rows.results ?? [];
  }

  async createAllocation(actor: AuthUser, data: { bookingId: number; residentId: number; academicSessionId: number; bedId: number; startsOn: string; notes?: string | null }) {
    await this.validateAllocation(data);
    const res = await this.repo.run(
      "INSERT INTO allocations (booking_id, resident_id, academic_session_id, bed_id, status, starts_on, assigned_by_staff_id, notes) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
      data.bookingId,
      data.residentId,
      data.academicSessionId,
      data.bedId,
      data.startsOn,
      actor.staffId,
      data.notes ?? null
    );
    await this.repo.audit(actor.id, actor.staffId, "admin.allocation.create", "allocation", res.meta.last_row_id, { bookingId: data.bookingId, bedId: data.bedId });
    return this.get("allocations", Number(res.meta.last_row_id));
  }

  async transferAllocation(actor: AuthUser, id: number, data: { destinationBedId: number; startsOn: string; notes?: string | null }) {
    const allocation = await this.get("allocations", id) as Record<string, unknown> | null;
    if (!allocation) throw new Error("Allocation not found");
    if (allocation.status !== "active") throw new Error("Invalid workflow transition");
    await this.validateAllocation({
      bookingId: Number(allocation.booking_id),
      residentId: Number(allocation.resident_id),
      academicSessionId: Number(allocation.academic_session_id),
      bedId: data.destinationBedId
    }, id);
    await this.repo.run("UPDATE allocations SET status = 'transferred', ends_on = ?, released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'active'", data.startsOn, id);
    const res = await this.repo.run(
      "INSERT INTO allocations (booking_id, resident_id, academic_session_id, bed_id, status, starts_on, assigned_by_staff_id, notes) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
      allocation.booking_id,
      allocation.resident_id,
      allocation.academic_session_id,
      data.destinationBedId,
      data.startsOn,
      actor.staffId,
      data.notes ?? null
    );
    await this.repo.audit(actor.id, actor.staffId, "admin.allocation.transfer", "allocation", res.meta.last_row_id, { fromAllocationId: id, fromBedId: allocation.bed_id, toBedId: data.destinationBedId });
    return this.get("allocations", Number(res.meta.last_row_id));
  }

  async updateAllocationStatus(actor: AuthUser, id: number, status: AllocationStatus) {
    const allocation = await this.get("allocations", id) as Record<string, unknown> | null;
    if (!allocation) throw new Error("Allocation not found");
    if (allocation.status !== "active" || !["ended", "cancelled", "archived"].includes(status)) throw new Error("Invalid workflow transition");
    await this.repo.run("UPDATE allocations SET status = ?, ends_on = COALESCE(ends_on, date('now')), released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", status, id);
    await this.repo.audit(actor.id, actor.staffId, `admin.allocation.${status}`, "allocation", id, { from: allocation.status, to: status });
    return this.get("allocations", id);
  }

  async bookingPaymentSummary(bookingId: number) {
    const booking = await this.get("bookings", bookingId) as Record<string, unknown> | null;
    if (!booking) throw new Error("Booking not found");
    const paid = await this.repo.first<{ verified_paid_minor: number }>("SELECT COALESCE(SUM(amount_minor), 0) AS verified_paid_minor FROM payments WHERE booking_id = ? AND status = 'verified'", bookingId);
    const setting = await this.repo.first<{ requirement_type: string; fixed_amount_minor: number | null; percentage_basis_points: number | null }>("SELECT requirement_type, fixed_amount_minor, percentage_basis_points FROM payment_confirmation_settings WHERE id = 1 AND status = 'active'");
    const total = Number(booking.total_amount_minor);
    const verifiedPaid = Number(paid?.verified_paid_minor ?? 0);
    const required = this.requiredConfirmationAmount(total, setting ?? { requirement_type: "full", fixed_amount_minor: null, percentage_basis_points: null });
    return {
      bookingId,
      bookingTotalMinor: total,
      verifiedPaidMinor: verifiedPaid,
      balanceMinor: total - verifiedPaid,
      requiredConfirmationAmountMinor: required,
      remainingToConfirmationMinor: Math.max(required - verifiedPaid, 0),
      confirmationRequirementMet: verifiedPaid >= required,
      bookingStatus: booking.status,
      paymentAttentionRequired: Boolean(booking.payment_attention_required)
    };
  }

  async createPayment(actor: AuthUser, data: { bookingId: number; residentId: number; amountMinor: number; currency?: string; method: string; paidAt?: string | null; notes?: string | null }) {
    const booking = await this.get("bookings", data.bookingId) as Record<string, unknown> | null;
    if (!booking) throw new Error("Booking not found");
    if (Number(booking.resident_id) !== data.residentId) throw new Error("Payment resident/booking mismatch");
    if (data.amountMinor <= 0) throw new Error("Payment amount must be positive");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const paymentReference = await this.repo.allocatePaymentReference();
      try {
        const res = await this.repo.run(
          "INSERT INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method, paid_at, notes) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
          data.bookingId,
          data.residentId,
          paymentReference,
          data.amountMinor,
          data.currency ?? "GHS",
          data.method,
          data.paidAt ?? null,
          data.notes ?? null
        );
        await this.repo.audit(actor.id, actor.staffId, "admin.payment.create", "payment", res.meta.last_row_id, { bookingId: data.bookingId, amountMinor: data.amountMinor });
        return this.get("payments", Number(res.meta.last_row_id));
      } catch (error) {
        if (String((error as Error).message).includes("payment_reference") && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error("Unable to create payment with unique payment reference");
  }

  async updatePaymentStatus(actor: AuthUser, id: number, status: PaymentStatus, notes?: string | null) {
    const payment = await this.get("payments", id) as Record<string, unknown> | null;
    if (!payment) throw new Error("Payment not found");
    const current = payment.status as PaymentStatus;
    const allowed: Record<PaymentStatus, PaymentStatus[]> = {
      pending: ["submitted", "cancelled", "archived"],
      submitted: ["rejected", "cancelled"],
      verified: ["refunded", "archived"],
      rejected: ["archived"],
      refunded: ["archived"],
      cancelled: ["archived"],
      archived: []
    };
    if (!allowed[current]?.includes(status)) throw new Error("Invalid workflow transition");
    await this.repo.run("UPDATE payments SET status = ?, notes = COALESCE(?, notes), submitted_at = CASE WHEN ? = 'submitted' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE submitted_at END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", status, notes ?? null, status, id);
    await this.repo.audit(actor.id, actor.staffId, `admin.payment.${status}`, "payment", id, { from: current, to: status });
    return this.get("payments", id);
  }

  async verifyPayment(actor: AuthUser, id: number, notes?: string | null) {
    const payment = await this.get("payments", id) as Record<string, unknown> | null;
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "submitted") throw new Error("Invalid workflow transition");
    const before = await this.bookingPaymentSummary(Number(payment.booking_id));
    if (before.verifiedPaidMinor + Number(payment.amount_minor) > before.bookingTotalMinor) throw new Error("Payment would exceed booking total");
    await this.repo.run("UPDATE payments SET status = 'verified', verified_by_staff_id = ?, verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), notes = COALESCE(?, notes), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", actor.staffId, notes ?? null, id);
    const after = await this.bookingPaymentSummary(Number(payment.booking_id));
    await this.repo.audit(actor.id, actor.staffId, "admin.payment.verified", "payment", id, { bookingId: payment.booking_id, eligibleForConfirmation: after.confirmationRequirementMet });
    if (!before.confirmationRequirementMet && after.confirmationRequirementMet) {
      await this.repo.audit(actor.id, actor.staffId, "admin.booking.payment_threshold_reached", "booking", Number(payment.booking_id), { paymentId: id });
    }
    return { payment: await this.get("payments", id), summary: after };
  }

  async refundPayment(actor: AuthUser, id: number, notes?: string | null) {
    const payment = await this.get("payments", id) as Record<string, unknown> | null;
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "verified") throw new Error("Invalid workflow transition");
    await this.repo.run("UPDATE payments SET status = 'refunded', notes = COALESCE(?, notes), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", notes ?? null, id);
    const summary = await this.bookingPaymentSummary(Number(payment.booking_id));
    const booking = await this.get("bookings", Number(payment.booking_id)) as Record<string, unknown> | null;
    if (booking?.status === "confirmed" && !summary.confirmationRequirementMet) {
      await this.repo.run("UPDATE bookings SET payment_attention_required = 1, payment_attention_reason = 'Refund reduced verified payments below confirmation threshold', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", payment.booking_id);
      await this.repo.audit(actor.id, actor.staffId, "admin.booking.payment_deficiency_after_refund", "booking", Number(payment.booking_id), { paymentId: id });
    }
    await this.repo.audit(actor.id, actor.staffId, "admin.payment.refunded", "payment", id, { bookingId: payment.booking_id });
    return { payment: await this.get("payments", id), summary };
  }

  async uploadPaymentSlip(actor: AuthUser, paymentId: number, file: File) {
    if (!this.documents) throw new Error("Document storage is not configured");
    const payment = await this.get("payments", paymentId) as Record<string, unknown> | null;
    if (!payment) throw new Error("Payment not found");
    const booking = await this.get("bookings", Number(payment.booking_id)) as Record<string, unknown> | null;
    if (!booking || Number(booking.resident_id) !== Number(payment.resident_id)) throw new Error("Payment resident/booking mismatch");
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) throw new Error("Unsupported payment slip file type");
    if (file.size > 5 * 1024 * 1024) throw new Error("Payment slip file too large");
    const key = `payment-slips/${payment.payment_reference}/${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
    await this.documents.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    const res = await this.repo.run(
      "INSERT INTO documents (owner_user_id, resident_id, booking_id, payment_id, document_type, status, r2_bucket, r2_key, original_filename, content_type, size_bytes, uploaded_by_user_id) SELECT u.id, ?, ?, ?, 'payment_slip', 'uploaded', 'DOCUMENTS', ?, ?, ?, ?, ? FROM residents r JOIN users u ON u.id = r.user_id WHERE r.id = ?",
      payment.resident_id,
      payment.booking_id,
      paymentId,
      key,
      file.name,
      file.type,
      file.size,
      actor.id,
      payment.resident_id
    );
    await this.repo.audit(actor.id, actor.staffId, "admin.payment.slip_uploaded", "document", res.meta.last_row_id, { paymentId });
    return this.get("documents", Number(res.meta.last_row_id));
  }

  async issueReceipt(actor: AuthUser, paymentId: number) {
    const payment = await this.get("payments", paymentId) as Record<string, unknown> | null;
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "verified") throw new Error("Receipt requires verified payment");
    if (await this.repo.first("SELECT id FROM receipts WHERE payment_id = ? AND status = 'issued'", paymentId)) throw new Error("Payment already has an active receipt");
    const receiptNumber = await this.repo.allocateReceiptNumber();
    const res = await this.repo.run("INSERT INTO receipts (payment_id, receipt_number, status, issued_by_staff_id) VALUES (?, ?, 'issued', ?)", paymentId, receiptNumber, actor.staffId);
    await this.repo.audit(actor.id, actor.staffId, "admin.receipt.issued", "receipt", res.meta.last_row_id, { paymentId, receiptNumber });
    return this.receipt(Number(res.meta.last_row_id));
  }

  async receipt(id: number) {
    return this.repo.first(`
      SELECT rec.*, p.payment_reference, p.amount_minor, p.method, p.paid_at, p.verified_at,
             b.booking_number, b.total_amount_minor,
             r.resident_code, r.first_name || ' ' || r.last_name AS resident_name, r.student_id,
             i.name AS institution_name,
             su.display_name AS issuing_staff_name
      FROM receipts rec
      JOIN payments p ON p.id = rec.payment_id
      LEFT JOIN bookings b ON b.id = p.booking_id
      JOIN residents r ON r.id = p.resident_id
      LEFT JOIN institutions i ON i.id = r.institution_id
      LEFT JOIN staff st ON st.id = rec.issued_by_staff_id
      LEFT JOIN users su ON su.id = st.user_id
      WHERE rec.id = ?
    `, id);
  }

  async voidReceipt(actor: AuthUser, id: number, reason?: string | null) {
    const receipt = await this.get("receipts", id) as Record<string, unknown> | null;
    if (!receipt) throw new Error("Receipt not found");
    if (receipt.status !== "issued") throw new Error("Invalid workflow transition");
    await this.repo.run("UPDATE receipts SET status = 'voided', voided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), void_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", reason ?? null, id);
    await this.repo.audit(actor.id, actor.staffId, "admin.receipt.voided", "receipt", id);
    return this.receipt(id);
  }

  identityDocuments() {
    return this.repo.all("SELECT id, resident_id, document_type, status, original_filename, content_type, size_bytes, created_at FROM documents WHERE document_type IN ('student_card', 'ghana_card') ORDER BY id DESC");
  }

  async identityDocument(actor: AuthUser, id: number, includeSensitive = false) {
    const doc = await this.repo.first<Record<string, unknown>>("SELECT id, resident_id, document_type, status, original_filename, content_type, size_bytes, r2_key, created_at FROM documents WHERE id = ? AND document_type IN ('student_card', 'ghana_card')", id);
    if (!doc) throw new Error("Document not found");
    if (doc.document_type === "ghana_card" && !includeSensitive) throw new Error("Forbidden");
    await this.repo.audit(actor.id, actor.staffId, "admin.identity_document.accessed", "document", id, { documentType: doc.document_type });
    return doc;
  }

  async identityDocumentContent(actor: AuthUser, id: number, allowGhanaCard: boolean) {
    if (!this.documents) throw new Error("Document storage is not configured");
    const doc = await this.identityDocument(actor, id, allowGhanaCard);
    const object = await this.documents.get(String(doc.r2_key));
    if (!object) throw new Error("Document content not found");
    return { object, document: doc };
  }

  async updateIdentityDocumentStatus(actor: AuthUser, id: number, status: "verified" | "rejected", reason?: string | null) {
    const doc = await this.repo.first<Record<string, unknown>>("SELECT id, document_type FROM documents WHERE id = ? AND document_type IN ('student_card', 'ghana_card')", id);
    if (!doc) throw new Error("Document not found");
    await this.repo.run("UPDATE documents SET status = ?, verified_by_staff_id = ?, verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", status, actor.staffId, id);
    await this.repo.audit(actor.id, actor.staffId, `admin.identity_document.${status}`, "document", id, { documentType: doc.document_type, reason });
    return this.get("documents", id);
  }

  async createMaintenance(actor: AuthUser, data: { residentId?: number | null; roomId?: number | null; bedId?: number | null; category: string; priority?: string; title: string; description?: string | null }) {
    const number = await this.repo.allocateMaintenanceRequestNumber();
    const res = await this.repo.run(
      "INSERT INTO maintenance_requests (request_number, resident_id, room_id, bed_id, category, priority, status, title, description) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)",
      number, data.residentId ?? null, data.roomId ?? null, data.bedId ?? null, data.category, data.priority ?? "normal", data.title, data.description ?? null
    );
    await this.repo.audit(actor.id, actor.staffId, actor.userType === "resident" ? "resident.maintenance.created" : "admin.maintenance.created", "maintenance_request", res.meta.last_row_id, { requestNumber: number });
    return this.get("maintenance_requests", Number(res.meta.last_row_id));
  }

  async assignMaintenance(actor: AuthUser, id: number, staffId: number) {
    const req = await this.get("maintenance_requests", id) as Record<string, unknown> | null;
    if (!req) throw new Error("Maintenance request not found");
    if (!["open", "assigned"].includes(String(req.status))) throw new Error("Invalid workflow transition");
    const staff = await this.repo.first("SELECT st.id FROM staff st JOIN roles r ON r.id = st.role_id WHERE st.id = ? AND st.status = 'active' AND r.code IN ('maintenance', 'manager', 'super_admin')", staffId);
    if (!staff) throw new Error("Staff cannot be assigned to maintenance");
    await this.repo.run("UPDATE maintenance_requests SET assigned_to_staff_id = ?, status = 'assigned', assigned_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", staffId, id);
    await this.repo.audit(actor.id, actor.staffId, "admin.maintenance.assigned", "maintenance_request", id, { staffId });
    return this.get("maintenance_requests", id);
  }

  async updateMaintenanceStatus(actor: AuthUser, id: number, status: MaintenanceStatus) {
    const req = await this.get("maintenance_requests", id) as Record<string, unknown> | null;
    if (!req) throw new Error("Maintenance request not found");
    const allowed: Record<MaintenanceStatus, MaintenanceStatus[]> = {
      open: ["assigned", "cancelled"],
      assigned: ["in_progress", "cancelled"],
      in_progress: ["resolved", "cancelled"],
      resolved: ["closed", "in_progress"],
      closed: ["archived"],
      cancelled: ["archived"],
      archived: []
    };
    if (!allowed[req.status as MaintenanceStatus]?.includes(status)) throw new Error("Invalid workflow transition");
    await this.repo.run(
      "UPDATE maintenance_requests SET status = ?, started_at = CASE WHEN ? = 'in_progress' THEN COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE started_at END, resolved_at = CASE WHEN ? = 'resolved' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE resolved_at END, closed_at = CASE WHEN ? = 'closed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE closed_at END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      status, status, status, status, id
    );
    const action = status === "in_progress" ? "admin.maintenance.started" : `admin.maintenance.${status}`;
    await this.repo.audit(actor.id, actor.staffId, action, "maintenance_request", id);
    return this.get("maintenance_requests", id);
  }

  async createAnnouncement(actor: AuthUser, data: { title: string; body: string; audience?: string; publishedAt?: string | null; expiresAt?: string | null }) {
    const res = await this.repo.run("INSERT INTO announcements (title, body, audience, status, published_at, expires_at) VALUES (?, ?, ?, 'draft', ?, ?)", data.title, data.body, data.audience ?? "all", data.publishedAt ?? null, data.expiresAt ?? null);
    await this.repo.audit(actor.id, actor.staffId, "admin.announcement.created", "announcement", res.meta.last_row_id);
    return this.get("announcements", Number(res.meta.last_row_id));
  }

  async updateAnnouncement(actor: AuthUser, id: number, data: { title?: string | null; body?: string | null; audience?: string | null; expiresAt?: string | null }) {
    await this.repo.run("UPDATE announcements SET title = COALESCE(?, title), body = COALESCE(?, body), audience = COALESCE(?, audience), expires_at = COALESCE(?, expires_at), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", data.title ?? null, data.body ?? null, data.audience ?? null, data.expiresAt ?? null, id);
    await this.repo.audit(actor.id, actor.staffId, "admin.announcement.updated", "announcement", id);
    return this.get("announcements", id);
  }

  async updateAnnouncementStatus(actor: AuthUser, id: number, status: AnnouncementStatus) {
    const ann = await this.get("announcements", id) as Record<string, unknown> | null;
    if (!ann) throw new Error("Announcement not found");
    const allowed: Record<AnnouncementStatus, AnnouncementStatus[]> = { draft: ["published", "archived"], published: ["expired", "archived"], expired: ["archived"], archived: [] };
    if (!allowed[ann.status as AnnouncementStatus]?.includes(status)) throw new Error("Invalid workflow transition");
    await this.repo.run("UPDATE announcements SET status = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE published_at END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", status, status, id);
    await this.repo.audit(actor.id, actor.staffId, `admin.announcement.${status}`, "announcement", id);
    return this.get("announcements", id);
  }

  operationalOverview() {
    return this.dashboard();
  }

  async occupancyReport(academicSessionId?: number | null) {
    const summary = await this.repo.first<Record<string, unknown>>(`
      SELECT
        (SELECT COUNT(*) FROM beds WHERE status = 'available') AS total_usable_beds,
        (SELECT COUNT(*) FROM allocations WHERE status = 'active' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS occupied_beds,
        ((SELECT COUNT(*) FROM beds WHERE status = 'available') - (SELECT COUNT(*) FROM allocations WHERE status = 'active' ${academicSessionId ? "AND academic_session_id = ?" : ""})) AS available_beds
    `, ...(academicSessionId ? [academicSessionId, academicSessionId] : []));
    const rooms = await this.repo.all(`
      SELECT r.room_code, r.capacity AS configured_capacity, r.gender_policy, r.status AS room_status,
        (SELECT COUNT(*) FROM beds b WHERE b.room_id = r.id AND b.status = 'available') AS active_bed_count,
        (SELECT COUNT(*) FROM allocations a JOIN beds b ON b.id = a.bed_id WHERE b.room_id = r.id AND a.status = 'active' ${academicSessionId ? "AND a.academic_session_id = ?" : ""}) AS occupied_bed_count,
        (SELECT amount_minor FROM room_rates rr WHERE rr.room_id = r.id ${academicSessionId ? "AND rr.academic_session_id = ?" : ""} AND rr.status = 'active' LIMIT 1) AS active_rate_minor
      FROM rooms r ORDER BY r.room_code
    `, ...(academicSessionId ? [academicSessionId, academicSessionId] : []));
    const usable = Number(summary?.total_usable_beds ?? 0);
    const occupied = Number(summary?.occupied_beds ?? 0);
    return { ...summary, occupancy_percentage: usable ? Math.round((occupied * 10000) / usable) / 100 : 0, rooms: rooms.results ?? [] };
  }

  financialReport() {
    return this.repo.first<Record<string, unknown>>(`
      SELECT
        (SELECT COALESCE(SUM(total_amount_minor), 0) FROM bookings WHERE status IN ('pending', 'confirmed', 'completed')) AS expected_booking_revenue,
        (SELECT COALESCE(SUM(amount_minor), 0) FROM payments WHERE status = 'verified') AS verified_payments,
        ((SELECT COALESCE(SUM(total_amount_minor), 0) FROM bookings WHERE status IN ('pending', 'confirmed', 'completed')) - (SELECT COALESCE(SUM(amount_minor), 0) FROM payments WHERE status = 'verified')) AS outstanding_booking_balances,
        (SELECT COALESCE(SUM(amount_minor), 0) FROM payments WHERE status IN ('pending', 'submitted')) AS pending_submitted_payment_totals,
        (SELECT COALESCE(SUM(amount_minor), 0) FROM payments WHERE status = 'refunded') AS refunded_totals,
        (SELECT COUNT(*) FROM bookings b WHERE b.total_amount_minor <= (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p WHERE p.booking_id = b.id AND p.status = 'verified')) AS fully_paid_bookings,
        (SELECT COUNT(*) FROM bookings b WHERE (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p WHERE p.booking_id = b.id AND p.status = 'verified') > 0 AND b.total_amount_minor > (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p WHERE p.booking_id = b.id AND p.status = 'verified')) AS partially_paid_bookings,
        (SELECT COUNT(*) FROM bookings b WHERE (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p WHERE p.booking_id = b.id AND p.status = 'verified') = 0) AS unpaid_bookings,
        (SELECT COUNT(*) FROM bookings WHERE payment_attention_required = 1) AS bookings_requiring_payment_attention
    `);
  }

  applicationBookingReport(academicSessionId?: number | null) {
    return this.repo.first<Record<string, unknown>>(`
      SELECT
        (SELECT COUNT(*) FROM applications WHERE status = 'draft' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS draft_applications,
        (SELECT COUNT(*) FROM applications WHERE status = 'submitted' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS submitted_applications,
        (SELECT COUNT(*) FROM applications WHERE status = 'under_review' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS under_review_applications,
        (SELECT COUNT(*) FROM applications WHERE status = 'approved' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS approved_applications,
        (SELECT COUNT(*) FROM applications WHERE status = 'rejected' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS rejected_applications,
        (SELECT COUNT(*) FROM applications WHERE status = 'cancelled' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS cancelled_applications,
        (SELECT COUNT(*) FROM bookings WHERE status = 'pending' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS pending_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS confirmed_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'cancelled' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS cancelled_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'expired' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS expired_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'completed' ${academicSessionId ? "AND academic_session_id = ?" : ""}) AS completed_bookings
    `, ...(academicSessionId ? Array(11).fill(academicSessionId) : []));
  }

  maintenanceReport() {
    return this.repo.first<Record<string, unknown>>(`
      SELECT
        (SELECT COUNT(*) FROM maintenance_requests WHERE status = 'open') AS open,
        (SELECT COUNT(*) FROM maintenance_requests WHERE status = 'assigned') AS assigned,
        (SELECT COUNT(*) FROM maintenance_requests WHERE status = 'in_progress') AS in_progress,
        (SELECT COUNT(*) FROM maintenance_requests WHERE status = 'resolved') AS resolved,
        (SELECT COUNT(*) FROM maintenance_requests WHERE status = 'closed') AS closed,
        (SELECT COUNT(*) FROM maintenance_requests WHERE priority = 'urgent' AND status NOT IN ('closed', 'archived', 'cancelled')) AS urgent
    `);
  }

  async auditLogs(actor: AuthUser, filters: { action?: string | null; entityType?: string | null; actorUserId?: number | null; dateFrom?: string | null; dateTo?: string | null }, limit = 25, offset = 0) {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (filters.action) { where.push("action = ?"); binds.push(filters.action); }
    if (filters.entityType) { where.push("entity_type = ?"); binds.push(filters.entityType); }
    if (filters.actorUserId) { where.push("actor_user_id = ?"); binds.push(filters.actorUserId); }
    if (filters.dateFrom) { where.push("created_at >= ?"); binds.push(filters.dateFrom); }
    if (filters.dateTo) { where.push("created_at <= ?"); binds.push(filters.dateTo); }
    await this.repo.audit(actor.id, actor.staffId, "admin.audit_logs.accessed", "audit_log", null);
    return this.repo.all(`SELECT id, actor_user_id, actor_staff_id, action, entity_type, entity_id, metadata_json, created_at FROM audit_logs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ? OFFSET ?`, ...binds, limit, offset);
  }

  private requiredConfirmationAmount(total: number, setting: { requirement_type: string; fixed_amount_minor: number | null; percentage_basis_points: number | null }) {
    if (setting.requirement_type === "fixed") return Math.min(Number(setting.fixed_amount_minor ?? total), total);
    if (setting.requirement_type === "percentage") return Math.ceil((total * Number(setting.percentage_basis_points ?? 10000)) / 10000);
    return total;
  }

  private async validateAllocation(data: { bookingId: number; residentId: number; academicSessionId: number; bedId: number }, ignoreAllocationId?: number) {
    const booking = await this.get("bookings", data.bookingId) as Record<string, unknown> | null;
    if (!booking) throw new Error("Booking not found");
    if (Number(booking.resident_id) !== data.residentId) throw new Error("Booking/resident mismatch");
    if (Number(booking.academic_session_id) !== data.academicSessionId) throw new Error("Session mismatch");
    if (booking.status !== "confirmed") throw new Error("Booking is not eligible for allocation");
    const bed = await this.repo.first<{ id: number; status: string; room_id: number; room_status: string; gender_policy: string; gender: string | null }>(`
      SELECT b.id, b.status, b.room_id, r.status AS room_status, r.gender_policy, res.gender
      FROM beds b
      JOIN rooms r ON r.id = b.room_id
      JOIN residents res ON res.id = ?
      WHERE b.id = ?
    `, data.residentId, data.bedId);
    if (!bed) throw new Error("Bed not found");
    if (bed.room_status !== "available") throw new Error("Inactive room");
    if (bed.status !== "available") throw new Error("Inactive bed");
    if (bed.gender_policy !== "any" && bed.gender && bed.gender_policy !== bed.gender) throw new Error("Gender-policy mismatch");
    if (booking.priced_room_id && Number(booking.priced_room_id) !== Number(bed.room_id)) {
      const destinationRate = await this.repo.first<{ amount_minor: number; currency: string }>(
        "SELECT amount_minor, currency FROM room_rates WHERE room_id = ? AND academic_session_id = ? AND status = 'active' LIMIT 1",
        bed.room_id,
        data.academicSessionId
      );
      if (!destinationRate || Number(destinationRate.amount_minor) !== Number(booking.total_amount_minor) || destinationRate.currency !== booking.currency) {
        throw new Error("Destination room rate differs from booking financial basis");
      }
    } else if (!booking.priced_room_id) {
      const destinationRate = await this.repo.first<{ amount_minor: number; currency: string }>(
        "SELECT amount_minor, currency FROM room_rates WHERE room_id = ? AND academic_session_id = ? AND status = 'active' LIMIT 1",
        bed.room_id,
        data.academicSessionId
      );
      if (!destinationRate || Number(destinationRate.amount_minor) !== Number(booking.total_amount_minor) || destinationRate.currency !== booking.currency) {
        throw new Error("Destination room rate differs from booking financial basis");
      }
    }
    const occupied = await this.repo.first("SELECT id FROM allocations WHERE bed_id = ? AND status = 'active' AND id <> ?", data.bedId, ignoreAllocationId ?? 0);
    if (occupied) throw new Error("Unavailable bed");
    const allocated = await this.repo.first("SELECT id FROM allocations WHERE resident_id = ? AND academic_session_id = ? AND status = 'active' AND id <> ?", data.residentId, data.academicSessionId, ignoreAllocationId ?? 0);
    if (allocated) throw new Error("Resident already allocated");
  }

  async createStaff(actor: AuthUser, data: { email: string; username: string; phone?: string | null; displayName: string; roleId: number; staffCode: string; jobTitle?: string | null; password?: string }) {
    const password = data.password ?? randomToken(12);
    const user = await this.repo.run("INSERT INTO users (email, username, phone, display_name, user_type, status, password_hash) VALUES (?, ?, ?, ?, 'staff', 'active', ?)", data.email, data.username, data.phone ?? null, data.displayName, await hashPassword(password));
    const res = await this.repo.run("INSERT INTO staff (user_id, role_id, staff_code, job_title, status) VALUES (?, ?, ?, ?, 'active')", user.meta.last_row_id, data.roleId, data.staffCode, data.jobTitle ?? null);
    await this.repo.audit(actor.id, actor.staffId, "admin.staff.create", "staff", res.meta.last_row_id);
    return { staff: await this.get("staff", Number(res.meta.last_row_id)), initialPassword: password };
  }
}
