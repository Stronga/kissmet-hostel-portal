import { hashPassword, randomToken } from "../auth/crypto";
import type { AuthUser } from "../auth/context";
import { AdminRepository } from "../repositories/admin.repository";
import { MockAnnouncementDeliveryProvider, type AnnouncementDeliveryProvider, type ExternalAnnouncementChannel } from "./announcement-delivery.service";
import { MockMessageDeliveryProvider, type MessageDeliveryProvider, type MessageExternalChannel } from "./message-delivery.service";

type ApplicationStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "cancelled" | "archived";
type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired" | "completed" | "archived";
type AllocationStatus = "active" | "ended" | "cancelled" | "transferred" | "archived";
type PaymentStatus = "pending" | "submitted" | "verified" | "rejected" | "refunded" | "cancelled" | "archived";
type MaintenanceStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed" | "cancelled" | "archived";
type AnnouncementStatus = "draft" | "published" | "expired" | "archived";
type AnnouncementAudience = "all" | "residents" | "staff";
type AnnouncementSeverity = "normal" | "important" | "high_alert";
type AnnouncementChannel = "resident_portal" | "staff_portal" | "public_website" | "sms" | "email";
type MessageStatus = "draft" | "queued" | "sent" | "partially_failed" | "failed" | "archived";
type MessageTargetType = "individual_resident" | "selected_residents" | "room" | "selected_rooms" | "group" | "all_residents" | "staff";
type MessageChannel = "portal" | "sms" | "email";
const unavailableInventoryStatuses = new Set(["maintenance", "inactive", "archived"]);
const occupiedBedStatusMessage = "This bed is currently occupied. Transfer or end the active allocation before taking the bed out of service.";
const occupiedRoomStatusMessage = "This room currently has active allocations. Transfer or end the active allocations before taking the room out of service.";
const announcementAudiences = new Set(["all", "residents", "staff"]);
const announcementSeverities = new Set(["normal", "important", "high_alert"]);
const announcementChannels = new Set(["resident_portal", "staff_portal", "public_website", "sms", "email"]);
const externalAnnouncementChannels = new Set(["sms", "email"]);
const messageTargetTypes = new Set(["individual_resident", "selected_residents", "room", "selected_rooms", "group", "all_residents", "staff"]);
const messageChannels = new Set(["portal", "sms", "email"]);
const messageGroups = new Set(["current_residents", "applicants", "active_allocations", "outstanding_balance", "academic_session"]);
const staffStatuses = new Set(["active", "inactive", "archived"]);
const userStatuses = new Set(["active", "inactive", "suspended", "archived"]);
const staffRoleCodes = new Set(["super_admin", "manager", "reception", "accounts", "maintenance"]);

export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly documents?: R2Bucket,
    private readonly announcementDelivery: AnnouncementDeliveryProvider = new MockAnnouncementDeliveryProvider(),
    private readonly messageDelivery: MessageDeliveryProvider = new MockMessageDeliveryProvider()
  ) {}

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
    await this.validateOperationalStatusChange(table, id, status);
    if (table === "academic_sessions" && status === "active") {
      await this.repo.run("UPDATE academic_sessions SET status = 'closed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'active' AND id <> ?", id);
    }
    await this.repo.run(`UPDATE ${table} SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`, status, id);
    await this.repo.audit(actor.id, actor.staffId, `admin.${table}.status`, table, id, { status });
    return this.get(table, id);
  }

  private async validateOperationalStatusChange(table: string, id: number, status: string) {
    if (!unavailableInventoryStatuses.has(status)) return;

    if (table === "beds") {
      const activeAllocation = await this.repo.first(
        "SELECT id FROM allocations WHERE bed_id = ? AND status = 'active' LIMIT 1",
        id
      );
      if (activeAllocation) throw new Error(occupiedBedStatusMessage);
    }

    if (table === "rooms") {
      const activeAllocation = await this.repo.first(`
        SELECT a.id
        FROM allocations a
        JOIN beds b ON b.id = a.bed_id
        WHERE b.room_id = ? AND a.status = 'active'
        LIMIT 1
      `, id);
      if (activeAllocation) throw new Error(occupiedRoomStatusMessage);
    }
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

  async createApplication(actor: AuthUser, data: { residentId: number; academicSessionId: number; notes?: string | null }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const applicationNumber = await this.repo.allocateApplicationNumber();
      try {
        const res = await this.repo.run(
          "INSERT INTO applications (resident_id, academic_session_id, application_number, status, decision_notes) VALUES (?, ?, ?, 'draft', ?)",
          data.residentId,
          data.academicSessionId,
          applicationNumber,
          data.notes ?? null
        );
        await this.repo.audit(actor.id, actor.staffId, "admin.application.create", "application", res.meta.last_row_id, { applicationNumber });
        return this.get("applications", Number(res.meta.last_row_id));
      } catch (error) {
        if (String((error as Error).message).includes("application_number") && attempt < 2) continue;
        throw error;
      }
    }

    throw new Error("Unable to create application with unique application number");
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

  async listAnnouncements(limit: number, offset: number, search?: string) {
    const rows = await this.repo.all<Record<string, unknown>>(
      `SELECT * FROM announcements
       ${search ? "WHERE title LIKE ? OR audience LIKE ? OR status LIKE ? OR severity LIKE ?" : ""}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      ...(search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : []),
      limit,
      offset
    );
    return { results: await Promise.all((rows.results ?? []).map((row) => this.decorateAnnouncement(row))) };
  }

  async announcement(id: number) {
    const row = await this.get("announcements", id) as Record<string, unknown> | null;
    if (!row) throw new Error("Announcement not found");
    return this.decorateAnnouncement(row);
  }

  async createAnnouncement(actor: AuthUser, data: { title: string; body: string; audience?: string; severity?: string; channels?: string[]; startsAt?: string | null; expiresAt?: string | null }) {
    const audience = this.assertAnnouncementValue(data.audience ?? "all", announcementAudiences, "Invalid announcement audience") as AnnouncementAudience;
    const severity = this.assertAnnouncementValue(data.severity ?? "normal", announcementSeverities, "Invalid announcement severity") as AnnouncementSeverity;
    const channels = this.normalizeAnnouncementChannels(data.channels, audience);
    const res = await this.repo.run(
      "INSERT INTO announcements (title, body, audience, severity, status, starts_at, expires_at, created_by_staff_id) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)",
      data.title,
      data.body,
      audience,
      severity,
      data.startsAt ?? null,
      data.expiresAt ?? null,
      actor.staffId
    );
    const id = Number(res.meta.last_row_id);
    await this.replaceAnnouncementChannels(id, channels);
    await this.repo.audit(actor.id, actor.staffId, "admin.announcement.created", "announcement", id, { severity, audience, channels });
    return this.announcement(id);
  }

  async updateAnnouncement(actor: AuthUser, id: number, data: { title?: string | null; body?: string | null; audience?: string | null; severity?: string | null; channels?: string[] | null; startsAt?: string | null; expiresAt?: string | null }) {
    const ann = await this.get("announcements", id) as Record<string, unknown> | null;
    if (!ann) throw new Error("Announcement not found");
    const audience = data.audience ? this.assertAnnouncementValue(data.audience, announcementAudiences, "Invalid announcement audience") as AnnouncementAudience : ann.audience as AnnouncementAudience;
    const severity = data.severity ? this.assertAnnouncementValue(data.severity, announcementSeverities, "Invalid announcement severity") as AnnouncementSeverity : ann.severity as AnnouncementSeverity;
    await this.repo.run(
      "UPDATE announcements SET title = COALESCE(?, title), body = COALESCE(?, body), audience = ?, severity = ?, starts_at = COALESCE(?, starts_at), expires_at = COALESCE(?, expires_at), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      data.title ?? null,
      data.body ?? null,
      audience,
      severity,
      data.startsAt ?? null,
      data.expiresAt ?? null,
      id
    );
    if (data.channels) await this.replaceAnnouncementChannels(id, this.normalizeAnnouncementChannels(data.channels, audience));
    await this.repo.audit(actor.id, actor.staffId, "admin.announcement.updated", "announcement", id);
    return this.announcement(id);
  }

  async publishAnnouncement(actor: AuthUser, id: number, options: { confirmHighAlert?: boolean; idempotencyKey?: string } = {}) {
    const ann = await this.announcement(id) as Record<string, unknown> & { channels: AnnouncementChannel[] };
    if (ann.status !== "draft") throw new Error("Invalid workflow transition");
    if (ann.severity === "high_alert" && !options.confirmHighAlert) throw new Error("High alert publication requires confirmation");
    await this.repo.run("UPDATE announcements SET status = 'published', published_by_staff_id = ?, published_at = COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", actor.staffId, id);
    await this.deliverAnnouncement(ann, options.idempotencyKey ?? `publish-${id}`);
    await this.repo.audit(actor.id, actor.staffId, "admin.announcement.published", "announcement", id, { channels: ann.channels, severity: ann.severity });
    return this.announcement(id);
  }

  async updateAnnouncementStatus(actor: AuthUser, id: number, status: AnnouncementStatus) {
    const ann = await this.get("announcements", id) as Record<string, unknown> | null;
    if (!ann) throw new Error("Announcement not found");
    const allowed: Record<AnnouncementStatus, AnnouncementStatus[]> = { draft: ["published", "archived"], published: ["expired", "archived"], expired: ["archived"], archived: [] };
    if (!allowed[ann.status as AnnouncementStatus]?.includes(status)) throw new Error("Invalid workflow transition");
    if (status === "published") return this.publishAnnouncement(actor, id, { confirmHighAlert: ann.severity !== "high_alert" });
    await this.repo.run("UPDATE announcements SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", status, id);
    await this.repo.audit(actor.id, actor.staffId, `admin.announcement.${status}`, "announcement", id);
    return this.announcement(id);
  }

  announcementReport() {
    return this.repo.first<Record<string, unknown>>(`
      SELECT
        (SELECT COUNT(*) FROM announcements WHERE status = 'published' AND (starts_at IS NULL OR starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) AS published,
        (SELECT COUNT(*) FROM announcements WHERE status = 'draft') AS drafts,
        (SELECT COUNT(*) FROM announcements WHERE severity = 'high_alert' AND status IN ('draft', 'published')) AS high_alerts,
        (SELECT COUNT(*) FROM announcements WHERE status = 'published' AND expires_at IS NOT NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')) AS expiring_soon
    `);
  }

  publicAnnouncements() {
    return this.repo.all(`
      SELECT a.id, a.title, a.body, a.severity, a.audience, a.published_at, a.starts_at, a.expires_at
      FROM announcements a
      JOIN announcement_channels c ON c.announcement_id = a.id AND c.channel = 'public_website' AND c.status = 'enabled'
      WHERE a.status = 'published'
        AND (a.starts_at IS NULL OR a.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        AND (a.expires_at IS NULL OR a.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ORDER BY CASE a.severity WHEN 'high_alert' THEN 3 WHEN 'important' THEN 2 ELSE 1 END DESC, COALESCE(a.starts_at, a.published_at, a.created_at) DESC
      LIMIT 25
    `);
  }

  async listMessages(limit: number, offset: number, filters: { search?: string; status?: string | null; targetType?: string | null; channel?: string | null } = {}) {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (filters.search) {
      where.push("(m.subject LIKE ? OR m.target_label LIKE ? OR m.status LIKE ? OR m.target_type LIKE ?)");
      binds.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.status) { where.push("m.status = ?"); binds.push(filters.status); }
    if (filters.targetType) { where.push("m.target_type = ?"); binds.push(filters.targetType); }
    if (filters.channel) { where.push("EXISTS (SELECT 1 FROM message_channels mc WHERE mc.message_id = m.id AND mc.channel = ? AND mc.status = 'enabled')"); binds.push(filters.channel); }
    const rows = await this.repo.all<Record<string, unknown>>(
      `SELECT m.*, u.display_name AS sent_by_name,
        (SELECT COUNT(*) FROM message_recipient_snapshots rs WHERE rs.message_id = m.id) AS recipient_count
       FROM messages m
       LEFT JOIN staff st ON st.id = m.sent_by_staff_id
       LEFT JOIN users u ON u.id = st.user_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      ...binds,
      limit,
      offset
    );
    return { results: await Promise.all((rows.results ?? []).map((row) => this.decorateMessage(row, false))) };
  }

  async message(id: number, includeRecipients = false) {
    const row = await this.repo.first<Record<string, unknown>>(
      `SELECT m.*, u.display_name AS sent_by_name,
        (SELECT COUNT(*) FROM message_recipient_snapshots rs WHERE rs.message_id = m.id) AS recipient_count
       FROM messages m
       LEFT JOIN staff st ON st.id = m.sent_by_staff_id
       LEFT JOIN users u ON u.id = st.user_id
       WHERE m.id = ?`,
      id
    );
    if (!row) throw new Error("Message not found");
    return this.decorateMessage(row, includeRecipients);
  }

  async previewMessageTarget(data: { targetType: string; targetIds?: number[]; group?: string | null; academicSessionId?: number | null; staffRoleCodes?: string[]; staffIds?: number[] }) {
    const targetType = this.assertMessageValue(data.targetType, messageTargetTypes, "Invalid message target type") as MessageTargetType;
    const recipients = await this.resolveMessageRecipients({ ...data, targetType });
    return this.messagePreview(targetType, recipients, data);
  }

  async createMessage(actor: AuthUser, data: { subject: string; body: string; targetType: string; targetIds?: number[]; group?: string | null; academicSessionId?: number | null; staffRoleCodes?: string[]; staffIds?: number[]; channels: string[] }) {
    const targetType = this.assertMessageValue(data.targetType, messageTargetTypes, "Invalid message target type") as MessageTargetType;
    const channels = this.normalizeMessageChannels(data.channels);
    const target = await this.messagePreview(targetType, await this.resolveMessageRecipients({ ...data, targetType }), data);
    if (!target.totalRecipients) throw new Error("No target recipients matched");
    const config = JSON.stringify({ targetIds: data.targetIds ?? [], group: data.group ?? null, academicSessionId: data.academicSessionId ?? null, staffRoleCodes: data.staffRoleCodes ?? [], staffIds: data.staffIds ?? [] });
    const res = await this.repo.run(
      "INSERT INTO messages (subject, body, target_type, target_label, target_config_json, status, created_by_staff_id) VALUES (?, ?, ?, ?, ?, 'draft', ?)",
      data.subject,
      data.body,
      targetType,
      target.targetLabel,
      config,
      actor.staffId
    );
    const id = Number(res.meta.last_row_id);
    await this.replaceMessageChannels(id, channels);
    await this.repo.audit(actor.id, actor.staffId, "admin.message.created", "message", id, { targetType, resolvedRecipientCount: target.totalRecipients, channels });
    return this.message(id);
  }

  async sendMessage(actor: AuthUser, id: number, options: { idempotencyKey: string }) {
    const msg = await this.message(id) as Record<string, unknown> & { channels: MessageChannel[] };
    if (msg.status !== "draft" && msg.status !== "queued") throw new Error("Invalid workflow transition");
    if (!options.idempotencyKey) throw new Error("idempotencyKey is required");
    const existing = await this.repo.first("SELECT id FROM messages WHERE id = ? AND idempotency_key = ?", id, options.idempotencyKey);
    if (existing && msg.status !== "draft" && msg.status !== "queued") return this.message(id, true);
    await this.repo.run("UPDATE messages SET status = 'queued', idempotency_key = COALESCE(idempotency_key, ?), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", options.idempotencyKey, id);
    const recipients = await this.resolveMessageRecipients({ targetType: msg.target_type as MessageTargetType, ...(this.parseJson(String(msg.target_config_json ?? "{}"))) });
    await this.snapshotMessageRecipients(id, recipients);
    const snapshots = await this.repo.all<Record<string, unknown>>("SELECT * FROM message_recipient_snapshots WHERE message_id = ? ORDER BY id", id);
    const channels = msg.channels;
    let sent = 0;
    let failed = 0;
    for (const snapshot of snapshots.results ?? []) {
      if (channels.includes("portal") && Number(snapshot.portal_eligible) === 1) {
        await this.repo.run("INSERT OR IGNORE INTO portal_message_deliveries (message_id, recipient_snapshot_id, user_id, status) VALUES (?, ?, ?, 'unread')", id, snapshot.id, snapshot.user_id);
        sent += 1;
      }
      for (const channel of channels.filter((c) => c === "sms" || c === "email") as MessageExternalChannel[]) {
        const eligible = channel === "sms" ? Number(snapshot.sms_eligible) === 1 : Number(snapshot.email_eligible) === 1;
        if (!eligible) continue;
        const result = await this.messageDelivery.send({ messageId: id, recipientSnapshotId: Number(snapshot.id), channel, subject: String(msg.subject), body: String(msg.body) });
        if (result.status === "failed") failed += 1;
        else sent += 1;
        try {
          await this.repo.run(
            "INSERT INTO message_delivery_attempts (message_id, recipient_snapshot_id, channel, status, provider_message_id, provider_status, failure_reason, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            id,
            snapshot.id,
            channel,
            result.status,
            result.providerMessageId ?? null,
            result.providerStatus ?? null,
            result.failureReason ?? null,
            options.idempotencyKey
          );
        } catch (error) {
          if (!String((error as Error).message).includes("UNIQUE")) throw error;
        }
      }
    }
    const status: MessageStatus = failed > 0 && sent > 0 ? "partially_failed" : failed > 0 ? "failed" : "sent";
    await this.repo.run("UPDATE messages SET status = ?, sent_by_staff_id = ?, sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", status, actor.staffId, id);
    await this.repo.audit(actor.id, actor.staffId, "admin.message.sent", "message", id, { targetType: msg.target_type, resolvedRecipientCount: snapshots.results?.length ?? 0, channels, status });
    return this.message(id, true);
  }

  async archiveMessage(actor: AuthUser, id: number) {
    const msg = await this.message(id) as Record<string, unknown>;
    if (msg.status === "archived") return msg;
    await this.repo.run("UPDATE messages SET status = 'archived', archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", id);
    await this.repo.audit(actor.id, actor.staffId, "admin.message.archived", "message", id);
    return this.message(id, true);
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

  async reportOverview(filters: { academicSessionId?: number | null } = {}) {
    const [overview, occupancy, applicationsBookings, maintenance] = await Promise.all([
      this.operationalOverview(),
      this.occupancyReport(filters.academicSessionId),
      this.applicationBookingReport(filters.academicSessionId),
      this.maintenanceReport()
    ]);
    return { scope: { academicSession: filters.academicSessionId ? "selected_session" : "all_sessions" }, overview, occupancy, applicationsBookings, maintenance };
  }

  async reportOccupancy(filters: { academicSessionId?: number | null } = {}) {
    return this.occupancyReport(filters.academicSessionId);
  }

  async reportResidents(filters: { status?: string | null; academicSessionId?: number | null } = {}) {
    const where: string[] = ["u.status = 'active'"];
    const binds: unknown[] = [];
    if (filters.status) { where.push("r.status = ?"); binds.push(filters.status); }
    const counts = await this.repo.all<Record<string, unknown>>("SELECT r.status, COUNT(*) AS count FROM residents r JOIN users u ON u.id = r.user_id WHERE u.status = 'active' GROUP BY r.status ORDER BY r.status");
    const rows = await this.repo.all<Record<string, unknown>>(
      `SELECT r.id, r.resident_code, r.first_name, r.last_name, r.student_id, r.status,
        i.name AS institution_name,
        room.room_code, b.label AS bed_label, a.starts_on AS assigned_date
       FROM residents r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN institutions i ON i.id = r.institution_id
       LEFT JOIN allocations a ON a.resident_id = r.id AND a.status = 'active' ${filters.academicSessionId ? "AND a.academic_session_id = ?" : ""}
       LEFT JOIN beds b ON b.id = a.bed_id
       LEFT JOIN rooms room ON room.id = b.room_id
       WHERE ${where.join(" AND ")}
       ORDER BY r.resident_code`,
      ...(filters.academicSessionId ? [filters.academicSessionId] : []),
      ...binds
    );
    return { statusCounts: counts.results ?? [], residents: rows.results ?? [] };
  }

  async reportApplicationsBookings(filters: { academicSessionId?: number | null; bookingStatus?: string | null } = {}) {
    const summary = await this.applicationBookingReport(filters.academicSessionId);
    const where: string[] = [];
    const binds: unknown[] = [];
    if (filters.academicSessionId) { where.push("b.academic_session_id = ?"); binds.push(filters.academicSessionId); }
    if (filters.bookingStatus) { where.push("b.status = ?"); binds.push(filters.bookingStatus); }
    const rows = await this.repo.all<Record<string, unknown>>(
      `SELECT b.id, b.booking_number, b.status, b.total_amount_minor, b.currency, b.payment_attention_required,
        s.name AS academic_session_name,
        r.resident_code, r.first_name, r.last_name,
        room.room_code AS priced_room_code,
        COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.booking_id = b.id AND p.status = 'verified'), 0) AS verified_amount_minor,
        b.total_amount_minor - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.booking_id = b.id AND p.status = 'verified'), 0) AS outstanding_amount_minor
       FROM bookings b
       JOIN residents r ON r.id = b.resident_id
       LEFT JOIN academic_sessions s ON s.id = b.academic_session_id
       LEFT JOIN rooms room ON room.id = b.priced_room_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY b.id DESC LIMIT 100`,
      ...binds
    );
    return { summary, bookings: rows.results ?? [] };
  }

  async reportFinance(filters: { academicSessionId?: number | null; dateFrom?: string | null; dateTo?: string | null } = {}) {
    const bookingWhere: string[] = ["b.status IN ('pending', 'confirmed', 'completed')"];
    const bookingBinds: unknown[] = [];
    if (filters.academicSessionId) { bookingWhere.push("b.academic_session_id = ?"); bookingBinds.push(filters.academicSessionId); }
    const paymentWhere: string[] = [];
    const paymentBinds: unknown[] = [];
    if (filters.dateFrom) { paymentWhere.push("p.created_at >= ?"); paymentBinds.push(filters.dateFrom); }
    if (filters.dateTo) { paymentWhere.push("p.created_at <= ?"); paymentBinds.push(filters.dateTo); }
    if (filters.academicSessionId) { paymentWhere.push("b.academic_session_id = ?"); paymentBinds.push(filters.academicSessionId); }
    const paymentScope = paymentWhere.length ? `AND ${paymentWhere.join(" AND ")}` : "";
    const summary = await this.repo.first<Record<string, unknown>>(
      `SELECT
        (SELECT COALESCE(SUM(b.total_amount_minor), 0) FROM bookings b WHERE ${bookingWhere.join(" AND ")}) AS expected_booking_revenue,
        (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE p.status = 'verified' ${paymentScope}) AS verified_payments,
        (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE p.status IN ('pending', 'submitted') ${paymentScope}) AS pending_submitted_payment_totals,
        (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE p.status = 'refunded' ${paymentScope}) AS refunded_totals,
        (SELECT COUNT(*) FROM bookings b WHERE ${bookingWhere.join(" AND ")} AND b.total_amount_minor <= (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p WHERE p.booking_id = b.id AND p.status = 'verified')) AS fully_paid_bookings,
        (SELECT COUNT(*) FROM bookings b WHERE ${bookingWhere.join(" AND ")} AND b.payment_attention_required = 1) AS bookings_requiring_payment_attention`,
      ...bookingBinds,
      ...paymentBinds,
      ...paymentBinds,
      ...paymentBinds,
      ...bookingBinds,
      ...bookingBinds
    );
    const outstanding = await this.reportOutstanding(filters);
    const methods = await this.repo.all<Record<string, unknown>>(
      `SELECT p.method, COUNT(*) AS count, COALESCE(SUM(p.amount_minor), 0) AS verified_amount_minor
       FROM payments p
       LEFT JOIN bookings b ON b.id = p.booking_id
       WHERE p.status = 'verified' ${paymentScope}
       GROUP BY p.method ORDER BY p.method`,
      ...paymentBinds
    );
    return { summary: { ...summary, outstanding_booking_balances: outstanding.totalOutstandingMinor }, paymentMethods: methods.results ?? [], outstanding };
  }

  async reportOutstanding(filters: { academicSessionId?: number | null } = {}) {
    const where: string[] = ["b.status IN ('pending', 'confirmed', 'completed')"];
    const binds: unknown[] = [];
    if (filters.academicSessionId) { where.push("b.academic_session_id = ?"); binds.push(filters.academicSessionId); }
    const rows = await this.repo.all<Record<string, unknown>>(
      `SELECT b.id, b.booking_number, b.status, b.total_amount_minor, b.currency, b.payment_attention_required,
        r.resident_code, r.first_name, r.last_name,
        COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.booking_id = b.id AND p.status = 'verified'), 0) AS verified_amount_minor,
        b.total_amount_minor - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.booking_id = b.id AND p.status = 'verified'), 0) AS outstanding_amount_minor
       FROM bookings b
       JOIN residents r ON r.id = b.resident_id
       WHERE ${where.join(" AND ")}
       ORDER BY outstanding_amount_minor DESC, b.id DESC`,
      ...binds
    );
    const balances = (rows.results ?? []).filter((row) => Number(row.outstanding_amount_minor ?? 0) > 0);
    return { totalOutstandingMinor: balances.reduce((sum, row) => sum + Number(row.outstanding_amount_minor ?? 0), 0), balances };
  }

  async reportMaintenance(filters: { dateFrom?: string | null; dateTo?: string | null } = {}) {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (filters.dateFrom) { where.push("created_at >= ?"); binds.push(filters.dateFrom); }
    if (filters.dateTo) { where.push("created_at <= ?"); binds.push(filters.dateTo); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [summary, byCategory, byPriority] = await Promise.all([
      this.repo.first<Record<string, unknown>>(`SELECT
        COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open,
        COALESCE(SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END), 0) AS assigned,
        COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress,
        COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved,
        COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) AS closed,
        COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled
       FROM maintenance_requests ${clause}`, ...binds),
      this.repo.all<Record<string, unknown>>(`SELECT category, COUNT(*) AS count FROM maintenance_requests ${clause} GROUP BY category ORDER BY category`, ...binds),
      this.repo.all<Record<string, unknown>>(`SELECT priority, COUNT(*) AS count FROM maintenance_requests ${clause} GROUP BY priority ORDER BY priority`, ...binds)
    ]);
    return { summary, byCategory: byCategory.results ?? [], byPriority: byPriority.results ?? [] };
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

  async listStaff(limit: number, offset: number, search?: string) {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (search) {
      where.push("(s.staff_code LIKE ? OR u.display_name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR role.code LIKE ? OR s.status LIKE ? OR u.status LIKE ?)");
      binds.push(...Array(7).fill(`%${search}%`));
    }
    const rows = await this.repo.all<Record<string, unknown>>(
      `SELECT s.id, s.user_id, s.role_id, s.staff_code, s.job_title, s.status AS staff_status, s.created_at, s.updated_at,
        u.display_name, u.username, u.email, u.phone, u.status AS user_status, u.created_at AS user_created_at,
        role.code AS role_code, role.name AS role_name
       FROM staff s
       JOIN users u ON u.id = s.user_id
       JOIN roles role ON role.id = s.role_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      ...binds,
      limit,
      offset
    );
    return { results: rows.results ?? [] };
  }

  async staffMember(id: number) {
    const row = await this.repo.first<Record<string, unknown>>(
      `SELECT s.id, s.user_id, s.role_id, s.staff_code, s.job_title, s.status AS staff_status, s.created_at, s.updated_at,
        u.display_name, u.username, u.email, u.phone, u.status AS user_status, u.created_at AS user_created_at,
        role.code AS role_code, role.name AS role_name
       FROM staff s
       JOIN users u ON u.id = s.user_id
       JOIN roles role ON role.id = s.role_id
       WHERE s.id = ?`,
      id
    );
    if (!row) throw new Error("Staff not found");
    return row;
  }

  async createStaff(actor: AuthUser, data: { email: string; username: string; phone?: string | null; displayName: string; roleId: number; staffCode: string; jobTitle?: string | null; password?: string }) {
    const role = await this.repo.first<{ id: number; code: string }>("SELECT id, code FROM roles WHERE id = ?", data.roleId);
    if (!role || !staffRoleCodes.has(role.code)) throw new Error("Invalid staff role");
    this.assertStaffRoleManageAllowed(actor, role.code);
    const password = data.password ?? randomToken(12);
    const user = await this.repo.run("INSERT INTO users (email, username, phone, display_name, user_type, status, password_hash) VALUES (?, ?, ?, ?, 'staff', 'active', ?)", data.email, data.username, data.phone ?? null, data.displayName, await hashPassword(password));
    let res: { meta: { last_row_id?: number | string | null } };
    try {
      res = await this.repo.run("INSERT INTO staff (user_id, role_id, staff_code, job_title, status) VALUES (?, ?, ?, ?, 'active')", user.meta.last_row_id, data.roleId, data.staffCode, data.jobTitle ?? null);
    } catch (error) {
      await this.repo.run("DELETE FROM users WHERE id = ?", user.meta.last_row_id);
      throw error;
    }
    await this.repo.audit(actor.id, actor.staffId, "admin.staff.create", "staff", Number(res.meta.last_row_id));
    return { staff: await this.staffMember(Number(res.meta.last_row_id)), initialPassword: password };
  }

  async changeStaffRole(actor: AuthUser, id: number, roleId: number) {
    const staff = await this.staffMember(id);
    const next = await this.repo.first<{ id: number; code: string }>("SELECT id, code FROM roles WHERE id = ?", roleId);
    if (!next || !staffRoleCodes.has(next.code)) throw new Error("Invalid staff role");
    this.assertStaffRoleManageAllowed(actor, String(staff.role_code));
    this.assertStaffRoleManageAllowed(actor, next.code);
    if (String(staff.role_code) === "super_admin" && next.code !== "super_admin") await this.ensureAnotherActiveSuperAdmin(Number(staff.id));
    await this.repo.run("UPDATE staff SET role_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", roleId, id);
    await this.revokeStaffSessions(Number(staff.user_id), "role_changed");
    await this.repo.audit(actor.id, actor.staffId, "admin.staff.role_changed", "staff", id, { from: staff.role_code, to: next.code });
    return this.staffMember(id);
  }

  async changeStaffStatus(actor: AuthUser, id: number, status: string) {
    this.assertAnnouncementValue(status, staffStatuses, "Invalid staff status");
    const staff = await this.staffMember(id);
    this.assertStaffRoleManageAllowed(actor, String(staff.role_code));
    if (String(staff.role_code) === "super_admin" && status !== "active") await this.ensureAnotherActiveSuperAdmin(Number(staff.id));
    if (actor.staffId === id && status !== "active") throw new Error("Cannot deactivate your own staff record");
    await this.repo.run("UPDATE staff SET status = ?, archived_at = CASE WHEN ? = 'archived' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE archived_at END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", status, status, id);
    if (status !== "active") await this.revokeStaffSessions(Number(staff.user_id), `staff_${status}`);
    await this.repo.audit(actor.id, actor.staffId, "admin.staff.status_changed", "staff", id, { status });
    return this.staffMember(id);
  }

  async changeStaffAccountStatus(actor: AuthUser, id: number, status: string) {
    this.assertAnnouncementValue(status, userStatuses, "Invalid account status");
    const staff = await this.staffMember(id);
    this.assertStaffRoleManageAllowed(actor, String(staff.role_code));
    if (String(staff.role_code) === "super_admin" && status !== "active") await this.ensureAnotherActiveSuperAdmin(Number(staff.id));
    if (actor.staffId === id && status !== "active") throw new Error("Cannot deactivate your own account");
    await this.repo.run("UPDATE users SET status = ?, archived_at = CASE WHEN ? = 'archived' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE archived_at END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", status, status, staff.user_id);
    if (status !== "active") await this.revokeStaffSessions(Number(staff.user_id), `account_${status}`);
    await this.repo.audit(actor.id, actor.staffId, "admin.staff.account_status_changed", "staff", id, { userId: staff.user_id, status });
    return this.staffMember(id);
  }

  async resetStaffPassword(actor: AuthUser, id: number) {
    const staff = await this.staffMember(id);
    this.assertStaffRoleManageAllowed(actor, String(staff.role_code));
    const password = randomToken(12);
    await this.repo.run("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", await hashPassword(password), staff.user_id);
    await this.revokeStaffSessions(Number(staff.user_id), "password_reset");
    await this.repo.audit(actor.id, actor.staffId, "admin.staff.password_reset", "staff", id);
    return { staff: await this.staffMember(id), temporaryPassword: password };
  }

  private assertStaffRoleManageAllowed(actor: AuthUser, roleCode: string) {
    if (actor.role !== "super_admin") throw new Error(roleCode === "super_admin" ? "Only super admins can manage super admin accounts" : "Only super admins can manage staff accounts");
  }

  private async ensureAnotherActiveSuperAdmin(staffId: number) {
    const row = await this.repo.first<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM staff s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = s.role_id
       WHERE s.id <> ? AND s.status = 'active' AND u.status = 'active' AND r.code = 'super_admin'`,
      staffId
    );
    if (Number(row?.count ?? 0) < 1) throw new Error("At least one other active Super Admin is required");
  }

  private async revokeStaffSessions(userId: number, reason: string) {
    await this.repo.run("UPDATE sessions SET status = 'revoked', revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revocation_reason = ? WHERE user_id = ? AND status = 'active'", reason, userId);
  }

  private assertAnnouncementValue(value: string, allowed: Set<string>, message: string) {
    if (!allowed.has(value)) throw new Error(message);
    return value;
  }

  private normalizeAnnouncementChannels(channels: string[] | undefined | null, audience: AnnouncementAudience) {
    const fallback = audience === "staff" ? ["staff_portal"] : audience === "residents" ? ["resident_portal"] : ["resident_portal", "staff_portal"];
    const unique = Array.from(new Set((channels?.length ? channels : fallback).map((channel) => String(channel))));
    for (const channel of unique) this.assertAnnouncementValue(channel, announcementChannels, "Invalid announcement channel");
    return unique as AnnouncementChannel[];
  }

  private async replaceAnnouncementChannels(id: number, channels: AnnouncementChannel[]) {
    await this.repo.run("DELETE FROM announcement_channels WHERE announcement_id = ?", id);
    for (const channel of channels) {
      await this.repo.run("INSERT INTO announcement_channels (announcement_id, channel, status) VALUES (?, ?, 'enabled')", id, channel);
    }
  }

  private async decorateAnnouncement(row: Record<string, unknown>) {
    const channels = await this.repo.all<{ channel: AnnouncementChannel }>("SELECT channel FROM announcement_channels WHERE announcement_id = ? AND status = 'enabled' ORDER BY channel", row.id);
    const delivery = await this.repo.all<Record<string, unknown>>("SELECT channel, status, COUNT(*) AS count FROM announcement_delivery_attempts WHERE announcement_id = ? GROUP BY channel, status", row.id);
    return {
      ...row,
      severity: row.severity ?? "normal",
      channels: (channels.results ?? []).map((item) => item.channel),
      recipient_counts: await this.announcementRecipientCounts(row.audience as AnnouncementAudience),
      delivery_summary: delivery.results ?? []
    };
  }

  private async announcementRecipientCounts(audience: AnnouncementAudience) {
    const includeResidents = audience === "all" || audience === "residents";
    const includeStaff = audience === "all" || audience === "staff";
    const residentSms = includeResidents ? await this.repo.first<{ count: number }>("SELECT COUNT(*) AS count FROM users u JOIN residents r ON r.user_id = u.id WHERE u.status = 'active' AND u.phone IS NOT NULL AND r.status <> 'archived'") : { count: 0 };
    const staffSms = includeStaff ? await this.repo.first<{ count: number }>("SELECT COUNT(*) AS count FROM users u JOIN staff s ON s.user_id = u.id WHERE u.status = 'active' AND u.phone IS NOT NULL AND s.status = 'active'") : { count: 0 };
    const residentEmail = includeResidents ? await this.repo.first<{ count: number }>("SELECT COUNT(*) AS count FROM users u JOIN residents r ON r.user_id = u.id WHERE u.status = 'active' AND u.email IS NOT NULL AND r.status <> 'archived'") : { count: 0 };
    const staffEmail = includeStaff ? await this.repo.first<{ count: number }>("SELECT COUNT(*) AS count FROM users u JOIN staff s ON s.user_id = u.id WHERE u.status = 'active' AND u.email IS NOT NULL AND s.status = 'active'") : { count: 0 };
    return {
      sms: Number(residentSms?.count ?? 0) + Number(staffSms?.count ?? 0),
      email: Number(residentEmail?.count ?? 0) + Number(staffEmail?.count ?? 0)
    };
  }

  private async announcementRecipients(audience: AnnouncementAudience, channel: ExternalAnnouncementChannel) {
    const contactColumn = channel === "sms" ? "phone" : "email";
    const residents = audience === "staff" ? { results: [] } : await this.repo.all<{ id: number; kind: "resident" }>(
      `SELECT u.id, 'resident' AS kind FROM users u JOIN residents r ON r.user_id = u.id WHERE u.status = 'active' AND u.${contactColumn} IS NOT NULL AND r.status <> 'archived'`
    );
    const staff = audience === "residents" ? { results: [] } : await this.repo.all<{ id: number; kind: "staff" }>(
      `SELECT u.id, 'staff' AS kind FROM users u JOIN staff s ON s.user_id = u.id WHERE u.status = 'active' AND u.${contactColumn} IS NOT NULL AND s.status = 'active'`
    );
    return [...(residents.results ?? []), ...(staff.results ?? [])];
  }

  private async deliverAnnouncement(announcement: Record<string, unknown> & { channels: AnnouncementChannel[] }, idempotencyKey: string) {
    const external = announcement.channels.filter((channel) => externalAnnouncementChannels.has(channel)) as ExternalAnnouncementChannel[];
    for (const channel of external) {
      const recipients = await this.announcementRecipients(announcement.audience as AnnouncementAudience, channel);
      for (const recipient of recipients) {
        const result = await this.announcementDelivery.send({
          announcementId: Number(announcement.id),
          channel,
          recipientUserId: recipient.id,
          recipientKind: recipient.kind,
          title: String(announcement.title),
          body: String(announcement.body)
        });
        try {
          await this.repo.run(
            "INSERT INTO announcement_delivery_attempts (announcement_id, channel, recipient_kind, recipient_user_id, status, provider_message_id, provider_status, failure_reason, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            announcement.id,
            channel,
            recipient.kind,
            recipient.id,
            result.status,
            result.providerMessageId ?? null,
            result.providerStatus ?? null,
            result.failureReason ?? null,
            idempotencyKey
          );
        } catch (error) {
          if (!String((error as Error).message).includes("UNIQUE")) throw error;
        }
      }
    }
  }

  private assertMessageValue(value: string, allowed: Set<string>, message: string) {
    if (!allowed.has(value)) throw new Error(message);
    return value;
  }

  private normalizeMessageChannels(channels: string[] | undefined | null) {
    const unique = Array.from(new Set((channels?.length ? channels : ["portal"]).map(String)));
    for (const channel of unique) this.assertMessageValue(channel, messageChannels, "Invalid message channel");
    return unique as MessageChannel[];
  }

  private parseJson(value: string) {
    try { return JSON.parse(value) as Record<string, unknown>; }
    catch { return {}; }
  }

  private async replaceMessageChannels(id: number, channels: MessageChannel[]) {
    await this.repo.run("DELETE FROM message_channels WHERE message_id = ?", id);
    for (const channel of channels) await this.repo.run("INSERT INTO message_channels (message_id, channel, status) VALUES (?, ?, 'enabled')", id, channel);
  }

  private async decorateMessage(row: Record<string, unknown>, includeRecipients: boolean) {
    const channels = await this.repo.all<{ channel: MessageChannel }>("SELECT channel FROM message_channels WHERE message_id = ? AND status = 'enabled' ORDER BY channel", row.id);
    const summary = await this.repo.all<Record<string, unknown>>(
      `SELECT channel, status, COUNT(*) AS count FROM (
        SELECT 'portal' AS channel, status FROM portal_message_deliveries WHERE message_id = ?
        UNION ALL
        SELECT channel, status FROM message_delivery_attempts WHERE message_id = ?
      ) GROUP BY channel, status`,
      row.id,
      row.id
    );
    const recipients = includeRecipients ? await this.repo.all<Record<string, unknown>>(
      "SELECT id, recipient_kind, display_name, resident_code, student_id, institution_name, staff_code, room_code, sms_eligible, email_eligible, portal_eligible FROM message_recipient_snapshots WHERE message_id = ? ORDER BY display_name",
      row.id
    ) : { results: [] };
    return {
      ...row,
      channels: (channels.results ?? []).map((item) => item.channel),
      delivery_summary: summary.results ?? [],
      recipients: recipients.results ?? []
    };
  }

  private messagePreview(targetType: MessageTargetType, recipients: Array<Record<string, unknown>>, data: Record<string, unknown>) {
    const deduped = Array.from(new Map(recipients.map((r) => [Number(r.user_id), r])).values());
    return {
      targetType,
      targetLabel: this.messageTargetLabel(targetType, deduped, data),
      totalRecipients: deduped.length,
      smsEligible: deduped.filter((r) => r.sms_eligible).length,
      emailEligible: deduped.filter((r) => r.email_eligible).length,
      portalEligible: deduped.filter((r) => r.portal_eligible).length
    };
  }

  private messageTargetLabel(targetType: MessageTargetType, recipients: Array<Record<string, unknown>>, data: Record<string, unknown>) {
    if (targetType === "room" && recipients[0]?.room_code) return `Room ${recipients[0].room_code}`;
    if (targetType === "selected_rooms") return `Selected rooms: ${this.uniqueMessageTargetIdCount(data.targetIds as number[] | undefined)}`;
    if (targetType === "group") return String(data.group ?? "Group");
    if (targetType === "staff") return "Staff";
    if (targetType === "all_residents") return "All residents";
    if (targetType === "individual_resident" && recipients[0]) return String(recipients[0].display_name);
    return `Selected residents: ${recipients.length}`;
  }

  private async resolveMessageRecipients(data: { targetType: MessageTargetType; targetIds?: number[]; group?: string | null; academicSessionId?: number | null; staffRoleCodes?: string[]; staffIds?: number[] }) {
    if (data.targetType === "individual_resident") {
      const ids = this.requiredMessageTargetIds(data.targetIds, "A resident must be selected");
      if (ids.length !== 1) throw new Error("Exactly one resident must be selected");
      return this.residentRecipients("r.id", ids);
    }
    if (data.targetType === "selected_residents") {
      return this.residentRecipients("r.id", this.requiredMessageTargetIds(data.targetIds, "At least one resident must be selected"));
    }
    if (data.targetType === "room") {
      const ids = this.requiredMessageTargetIds(data.targetIds, "A room must be selected");
      if (ids.length !== 1) throw new Error("Exactly one room must be selected");
      return this.roomRecipients(ids);
    }
    if (data.targetType === "selected_rooms") {
      return this.roomRecipients(this.requiredMessageTargetIds(data.targetIds, "At least one room must be selected"));
    }
    if (data.targetType === "all_residents") {
      return this.residentRecipients("r.status <> 'archived'");
    }
    if (data.targetType === "staff") {
      return this.staffRecipients(data.staffIds ?? [], data.staffRoleCodes ?? []);
    }
    if (data.targetType === "group") {
      const group = String(data.group ?? "");
      this.assertMessageValue(group, messageGroups, "Invalid message group");
      if (group === "current_residents") return this.residentRecipients("r.status = 'resident'");
      if (group === "applicants") return this.residentRecipients("r.status = 'applicant'");
      if (group === "active_allocations") return this.activeAllocationRecipients();
      if (group === "academic_session") return this.academicSessionRecipients(Number(data.academicSessionId));
      if (group === "outstanding_balance") return this.outstandingBalanceRecipients();
    }
    return [];
  }

  private requiredMessageTargetIds(ids: number[] | undefined, message: string) {
    const unique = Array.from(new Set((ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0)));
    if (!unique.length) throw new Error(message);
    return unique;
  }

  private uniqueMessageTargetIdCount(ids: number[] | undefined) {
    return new Set((ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0)).size;
  }

  private async residentRecipients(where: string, ids?: number[]) {
    const binds = ids?.length ? ids : [];
    const condition = ids?.length ? `${where} IN (${ids.map(() => "?").join(",")})` : where;
    const rows = await this.repo.all<Record<string, unknown>>(
      `SELECT u.id AS user_id, r.id AS resident_id, NULL AS staff_id, 'resident' AS recipient_kind,
        u.display_name, r.resident_code, r.student_id, i.name AS institution_name, NULL AS staff_code,
        NULL AS room_id, NULL AS room_code,
        CASE WHEN u.phone IS NOT NULL THEN 1 ELSE 0 END AS sms_eligible,
        CASE WHEN u.email IS NOT NULL THEN 1 ELSE 0 END AS email_eligible,
        1 AS portal_eligible
       FROM residents r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN institutions i ON i.id = r.institution_id
       WHERE u.status = 'active' AND ${condition}`,
      ...binds
    );
    return rows.results ?? [];
  }

  private async roomRecipients(roomIds: number[]) {
    if (!roomIds.length) return [];
    const rows = await this.repo.all<Record<string, unknown>>(
      `SELECT u.id AS user_id, r.id AS resident_id, NULL AS staff_id, 'resident' AS recipient_kind,
        u.display_name, r.resident_code, r.student_id, i.name AS institution_name, NULL AS staff_code,
        room.id AS room_id, room.room_code,
        CASE WHEN u.phone IS NOT NULL THEN 1 ELSE 0 END AS sms_eligible,
        CASE WHEN u.email IS NOT NULL THEN 1 ELSE 0 END AS email_eligible,
        1 AS portal_eligible
       FROM allocations a
       JOIN beds b ON b.id = a.bed_id
       JOIN rooms room ON room.id = b.room_id
       JOIN residents r ON r.id = a.resident_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN institutions i ON i.id = r.institution_id
       WHERE a.status = 'active' AND u.status = 'active' AND room.id IN (${roomIds.map(() => "?").join(",")})`,
      ...roomIds
    );
    return rows.results ?? [];
  }

  private activeAllocationRecipients() {
    return this.repo.all<Record<string, unknown>>(
      `SELECT u.id AS user_id, r.id AS resident_id, NULL AS staff_id, 'resident' AS recipient_kind,
        u.display_name, r.resident_code, r.student_id, i.name AS institution_name, NULL AS staff_code,
        room.id AS room_id, room.room_code,
        CASE WHEN u.phone IS NOT NULL THEN 1 ELSE 0 END AS sms_eligible,
        CASE WHEN u.email IS NOT NULL THEN 1 ELSE 0 END AS email_eligible,
        1 AS portal_eligible
       FROM allocations a
       JOIN beds b ON b.id = a.bed_id
       JOIN rooms room ON room.id = b.room_id
       JOIN residents r ON r.id = a.resident_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN institutions i ON i.id = r.institution_id
       WHERE a.status = 'active' AND u.status = 'active'`
    ).then((r) => r.results ?? []);
  }

  private academicSessionRecipients(sessionId: number) {
    if (!sessionId) throw new Error("academicSessionId is required");
    return this.repo.all<Record<string, unknown>>(
      `SELECT u.id AS user_id, r.id AS resident_id, NULL AS staff_id, 'resident' AS recipient_kind,
        u.display_name, r.resident_code, r.student_id, i.name AS institution_name, NULL AS staff_code,
        NULL AS room_id, NULL AS room_code,
        CASE WHEN u.phone IS NOT NULL THEN 1 ELSE 0 END AS sms_eligible,
        CASE WHEN u.email IS NOT NULL THEN 1 ELSE 0 END AS email_eligible,
        1 AS portal_eligible
       FROM applications app
       JOIN residents r ON r.id = app.resident_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN institutions i ON i.id = r.institution_id
       WHERE app.academic_session_id = ? AND app.status IN ('submitted', 'under_review', 'approved') AND u.status = 'active'`,
      sessionId
    ).then((r) => r.results ?? []);
  }

  private outstandingBalanceRecipients() {
    return this.repo.all<Record<string, unknown>>(
      `SELECT u.id AS user_id, r.id AS resident_id, NULL AS staff_id, 'resident' AS recipient_kind,
        u.display_name, r.resident_code, r.student_id, i.name AS institution_name, NULL AS staff_code,
        NULL AS room_id, NULL AS room_code,
        CASE WHEN u.phone IS NOT NULL THEN 1 ELSE 0 END AS sms_eligible,
        CASE WHEN u.email IS NOT NULL THEN 1 ELSE 0 END AS email_eligible,
        1 AS portal_eligible
       FROM bookings b
       JOIN residents r ON r.id = b.resident_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN institutions i ON i.id = r.institution_id
       WHERE b.status IN ('pending', 'confirmed')
         AND b.total_amount_minor > (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p WHERE p.booking_id = b.id AND p.status = 'verified')
         AND u.status = 'active'`
    ).then((r) => r.results ?? []);
  }

  private async staffRecipients(staffIds: number[], roleCodes: string[]) {
    const where: string[] = ["u.status = 'active'", "s.status = 'active'"];
    const binds: unknown[] = [];
    if (staffIds.length) { where.push(`s.id IN (${staffIds.map(() => "?").join(",")})`); binds.push(...staffIds); }
    if (roleCodes.length) { where.push(`role.code IN (${roleCodes.map(() => "?").join(",")})`); binds.push(...roleCodes); }
    const rows = await this.repo.all<Record<string, unknown>>(
      `SELECT u.id AS user_id, NULL AS resident_id, s.id AS staff_id, 'staff' AS recipient_kind,
        u.display_name, NULL AS resident_code, NULL AS student_id, NULL AS institution_name, s.staff_code,
        NULL AS room_id, NULL AS room_code,
        CASE WHEN u.phone IS NOT NULL THEN 1 ELSE 0 END AS sms_eligible,
        CASE WHEN u.email IS NOT NULL THEN 1 ELSE 0 END AS email_eligible,
        0 AS portal_eligible
       FROM staff s JOIN users u ON u.id = s.user_id JOIN roles role ON role.id = s.role_id
       WHERE ${where.join(" AND ")}`,
      ...binds
    );
    return rows.results ?? [];
  }

  private async snapshotMessageRecipients(messageId: number, recipients: Array<Record<string, unknown>>) {
    const deduped = Array.from(new Map(recipients.map((r) => [Number(r.user_id), r])).values());
    for (const r of deduped) {
      await this.repo.run(
        `INSERT OR IGNORE INTO message_recipient_snapshots
         (message_id, user_id, resident_id, staff_id, recipient_kind, display_name, resident_code, student_id, institution_name, staff_code, room_id, room_code, sms_eligible, email_eligible, portal_eligible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        messageId,
        r.user_id,
        r.resident_id ?? null,
        r.staff_id ?? null,
        r.recipient_kind,
        r.display_name,
        r.resident_code ?? null,
        r.student_id ?? null,
        r.institution_name ?? null,
        r.staff_code ?? null,
        r.room_id ?? null,
        r.room_code ?? null,
        r.sms_eligible ? 1 : 0,
        r.email_eligible ? 1 : 0,
        r.portal_eligible ? 1 : 0
      );
    }
  }
}
