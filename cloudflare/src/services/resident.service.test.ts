import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ResidentService } from "./resident.service";
import { hashPassword } from "../auth/crypto";
import type { AuthUser } from "../auth/context";
import { requirePermission } from "../middleware/auth.middleware";

const resident: AuthUser = { id: 1, userType: "resident", displayName: "Ama", email: "ama@test", role: "resident", staffId: null, residentId: 1, sessionId: 1 };
const otherResident: AuthUser = { ...resident, id: 2, residentId: 2 };
const reception: AuthUser = { ...resident, userType: "staff", role: "reception", staffId: 1, residentId: null };
const manager: AuthUser = { ...reception, role: "manager" };

class Sms {
  last: { destination: string; otp: string } | null = null;
  async sendOtp(destination: string, otp: string) { this.last = { destination, otp }; }
}

class Repo {
  rows: Record<string, Record<string, unknown>[]> = {
    institutions: [{ id: 1, code: "ug", name: "University of Ghana", status: "active" }, { id: 2, code: "old", name: "Old", status: "inactive" }],
    academic_sessions: [{ id: 1, code: "2026", name: "2026 Academic Year", status: "active" }, { id: 2, code: "2025", name: "2025 Academic Year", status: "closed" }],
    users: [{ id: 1, phone: "+2331", email: "ama@test", display_name: "Ama" }, { id: 2, phone: "+2332", email: "kojo@test", display_name: "Kojo" }],
    residents: [{ id: 1, user_id: 1, institution_id: 1, resident_code: "KSM-RES-0001", student_id: "S1", first_name: "Ama", middle_name: null, last_name: "A", status: "applicant", phone_verified_at: "now" }, { id: 2, user_id: 2, institution_id: 1, resident_code: "KSM-RES-0002", student_id: "S2", first_name: "Kojo", last_name: "K", status: "applicant", phone_verified_at: "now" }],
    otp_codes: [],
    sessions: [],
    documents: [],
    applications: [],
    bookings: [{ id: 1, resident_id: 1, academic_session_id: 1, application_id: 1, booking_number: "KSM-BKG-0001", status: "pending", total_amount_minor: 250000, currency: "GHS", priced_room_id: 1, payment_attention_required: 0 }],
    payments: [],
    receipts: [],
    payment_confirmation_settings: [{ id: 1, requirement_type: "full", fixed_amount_minor: null, percentage_basis_points: null, status: "active" }],
    allocations: [{ id: 1, booking_id: 1, resident_id: 1, status: "active", bed_id: 1, academic_session_id: 1, starts_on: "2026-09-01", ends_on: null }],
    beds: [{ id: 1, room_id: 1, bed_code: "R1-A", label: "A" }],
    rooms: [{ id: 1, room_code: "R1", room_name: "Room 1", gender_policy: "female", status: "available" }],
    maintenance_requests: [{ id: 1, request_number: "KSM-MNT-0001", resident_id: 1, room_id: 1, bed_id: 1, status: "open", title: "Leak", category: "plumbing", priority: "urgent", opened_at: "2026-09-01T00:00:00.000Z" }, { id: 2, request_number: "KSM-MNT-0002", resident_id: 2, status: "open", title: "Other", category: "cleaning", priority: "normal" }],
    announcements: [{ id: 1, title: "Residents", body: "Resident update", audience: "residents", severity: "info", status: "published", published_at: "2026-09-01T00:00:00.000Z", expires_at: null }, { id: 2, title: "All", body: "All update", audience: "all", severity: "high_alert", status: "published", published_at: "2026-09-02T00:00:00.000Z", expires_at: null }, { id: 3, title: "Staff", audience: "staff", status: "published", expires_at: null }, { id: 4, title: "Draft", audience: "all", status: "draft", expires_at: null }, { id: 5, title: "Expired", audience: "all", status: "published", expires_at: "2000-01-01T00:00:00.000Z" }],
    announcement_channels: [{ announcement_id: 1, channel: "resident_portal", status: "enabled" }, { announcement_id: 2, channel: "resident_portal", status: "enabled" }, { announcement_id: 3, channel: "resident_portal", status: "enabled" }, { announcement_id: 4, channel: "resident_portal", status: "enabled" }, { announcement_id: 5, channel: "resident_portal", status: "enabled" }],
    messages: [{ id: 1, subject: "Room update", body: "Maintenance team will inspect your room.", status: "sent", sent_at: "2026-09-02T10:00:00.000Z", target_type: "room", target_label: "Room R1", target_config_json: "{\"roomId\":1}" }, { id: 2, subject: "Private account note", body: "Please visit accounts.", status: "partially_failed", sent_at: "2026-09-01T10:00:00.000Z", target_type: "individual_resident", target_label: "Ama", target_config_json: "{\"targetIds\":[1]}" }, { id: 3, subject: "Draft hidden", body: "Hidden", status: "draft", sent_at: null, target_type: "all_residents" }],
    message_recipient_snapshots: [{ id: 1, message_id: 1, user_id: 1, resident_id: 1, recipient_kind: "resident", display_name: "Ama", resident_code: "KSM-RES-0001", room_id: 1, room_code: "R1", sms_eligible: 1, email_eligible: 1, portal_eligible: 1 }, { id: 2, message_id: 1, user_id: 2, resident_id: 2, recipient_kind: "resident", display_name: "Kojo", resident_code: "KSM-RES-0002", room_id: 1, room_code: "R1", sms_eligible: 1, email_eligible: 1, portal_eligible: 1 }, { id: 3, message_id: 2, user_id: 1, resident_id: 1, recipient_kind: "resident", display_name: "Ama", resident_code: "KSM-RES-0001", sms_eligible: 1, email_eligible: 1, portal_eligible: 1 }],
    portal_message_deliveries: [{ id: 1, message_id: 1, recipient_snapshot_id: 1, user_id: 1, status: "unread", delivered_at: "2026-09-02T10:01:00.000Z", read_at: null }, { id: 2, message_id: 1, recipient_snapshot_id: 2, user_id: 2, status: "unread", delivered_at: "2026-09-02T10:01:00.000Z", read_at: null }, { id: 3, message_id: 2, recipient_snapshot_id: 3, user_id: 1, status: "read", delivered_at: "2026-09-01T10:01:00.000Z", read_at: "2026-09-01T11:00:00.000Z" }]
  };
  audits: string[] = [];
  residentSeq = 3;
  appSeq = 1;
  mntSeq = 3;
  paySeq = 1;

  async all<T>(sql: string, ...binds: unknown[]) {
    if (sql.includes("FROM institutions")) return { results: this.rows.institutions.filter((i) => i.status === "active").map(({ code, name }) => ({ code, name })) as T[] };
    if (sql.includes("FROM documents")) return { results: this.rows.documents.filter((d) => d.resident_id === binds[0]) as T[] };
    if (sql.includes("FROM applications")) return { results: this.rows.applications.filter((a) => a.resident_id === binds[0]) as T[] };
    if (sql.includes("FROM bookings")) return {
      results: this.rows.bookings.filter((b) => b.resident_id === binds[0]).map((b) => {
        const session = this.rows.academic_sessions.find((s) => s.id === b.academic_session_id);
        const app = this.rows.applications.find((a) => a.id === b.application_id);
        const room = this.rows.rooms.find((r) => r.id === b.priced_room_id);
        return { ...b, academic_session_code: session?.code, academic_session_name: session?.name, application_number: app?.application_number, priced_room_code: room?.room_code, priced_room_name: room?.room_name };
      }) as T[]
    };
    if (sql.includes("FROM payments")) return { results: this.rows.payments.filter((p) => p.resident_id === binds[0]).map((p) => ({ ...p, booking_number: this.rows.bookings.find((b) => b.id === p.booking_id)?.booking_number })) as T[] };
    if (sql.includes("FROM receipts")) return { results: this.rows.receipts.filter((r) => this.rows.payments.find((p) => p.id === r.payment_id)?.resident_id === binds[0]).map((r) => ({ ...r, ...this.rows.payments.find((p) => p.id === r.payment_id) })) as T[] };
    if (sql.includes("FROM allocations")) return {
      results: this.rows.allocations.filter((a) => a.resident_id === binds[0]).map((allocation) => {
        const bed = this.rows.beds.find((b) => b.id === allocation.bed_id);
        const room = this.rows.rooms.find((r) => r.id === bed?.room_id);
        const session = this.rows.academic_sessions.find((s) => s.id === allocation.academic_session_id);
        const booking = this.rows.bookings.find((b) => b.id === allocation.booking_id);
        return { id: allocation.id, status: allocation.status, starts_on: allocation.starts_on, ends_on: allocation.ends_on, assigned_at: allocation.assigned_at, released_at: allocation.released_at, bed_code: bed?.bed_code, label: bed?.label, room_code: room?.room_code, room_name: room?.room_name, room_gender_policy: room?.gender_policy, room_status: room?.status, academic_session_code: session?.code, academic_session_name: session?.name, booking_number: booking?.booking_number };
      }) as T[]
    };
    if (sql.includes("FROM maintenance_requests")) return { results: this.rows.maintenance_requests.filter((m) => m.resident_id === binds[0]).map((m) => this.maintenanceRow(m)) as T[] };
    if (sql.includes("FROM announcements")) return { results: this.visibleAnnouncements() as T[] };
    if (sql.includes("FROM portal_message_deliveries")) return { results: this.messagesFor(binds[0] as number) as T[] };
    return { results: [] as T[] };
  }
  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
    if (sql.includes("FROM institutions")) return (this.rows.institutions.find((i) => String(i.code).toLowerCase() === String(binds[0]).toLowerCase() && i.status === "active") ?? null) as T;
    if (sql.includes("FROM academic_sessions WHERE status = 'active'")) return (this.rows.academic_sessions.find((s) => s.status === "active") ?? null) as T;
    if (sql.includes("FROM academic_sessions WHERE id")) return (this.rows.academic_sessions.find((s) => s.id === binds[0] && s.status === "active") ?? null) as T;
    if (sql.includes("FROM residents WHERE institution_id")) return (this.rows.residents.find((r) => r.institution_id === binds[0] && r.student_id === binds[1]) ?? null) as T;
    if (sql.includes("FROM otp_codes WHERE purpose")) return (this.rows.otp_codes.at(-1) ?? null) as T;
    if (sql.includes("FROM residents r JOIN users")) return this.profile(binds[0] as number) as T;
    if (sql.includes("COUNT(*) AS count FROM documents")) return { count: this.rows.documents.filter((d) => d.resident_id === binds[0] && ["student_card", "ghana_card"].includes(String(d.document_type))).length } as T;
    if (sql.includes("FROM applications WHERE resident_id") && sql.includes("academic_session_id") && sql.includes("NOT IN")) {
      return (this.rows.applications.find((a) => a.resident_id === binds[0] && a.academic_session_id === binds[1] && !["cancelled", "archived"].includes(String(a.status))) ?? null) as T;
    }
    if (sql.includes("FROM applications WHERE id")) return (this.rows.applications.find((a) => a.id === binds[0] && a.resident_id === binds[1]) ?? null) as T;
    if (sql.includes("FROM documents WHERE id")) {
      const doc = this.rows.documents.find((d) => d.id === binds[0] && d.resident_id === binds[1]);
      if (!doc) return null;
      if (sql.includes("original_filename") && !sql.includes("r2_key")) {
        return { id: doc.id, document_type: doc.document_type, status: doc.status, original_filename: doc.original_filename, content_type: doc.content_type, size_bytes: doc.size_bytes, created_at: doc.created_at } as T;
      }
      return doc as T;
    }
    if (sql.includes("FROM bookings WHERE resident_id")) return (this.rows.bookings.find((b) => b.resident_id === binds[0] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
    if (sql.includes("FROM bookings WHERE id")) return (this.rows.bookings.find((b) => b.id === binds[0] && b.resident_id === binds[1] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
    if (sql.includes("verified_minor")) {
      const rows = this.rows.payments.filter((p) => p.booking_id === binds[0] && p.resident_id === binds[1]);
      return {
        verified_minor: rows.filter((p) => p.status === "verified").reduce((sum, p) => sum + Number(p.amount_minor), 0),
        submitted_minor: rows.filter((p) => p.status === "submitted").reduce((sum, p) => sum + Number(p.amount_minor), 0),
        pending_minor: rows.filter((p) => p.status === "pending").reduce((sum, p) => sum + Number(p.amount_minor), 0),
        refunded_minor: rows.filter((p) => p.status === "refunded").reduce((sum, p) => sum + Number(p.amount_minor), 0)
      } as T;
    }
    if (sql.includes("FROM payment_confirmation_settings")) return this.rows.payment_confirmation_settings[0] as T;
    if (sql.includes("FROM payments WHERE id")) return (this.rows.payments.find((p) => p.id === binds[0] && p.resident_id === binds[1]) ?? null) as T;
    if (sql.includes("FROM receipts rec")) {
      const row = this.rows.receipts.find((r) => r.id === binds[0]);
      const payment = this.rows.payments.find((p) => p.id === row?.payment_id && p.resident_id === binds[1]);
      return row && payment ? { ...row, ...payment } as T : null;
    }
    if (sql.includes("SELECT bed_id FROM allocations")) return (this.rows.allocations.find((a) => a.resident_id === binds[0] && a.status === "active") ?? null) as T;
    if (sql.includes("FROM allocations")) {
      const allocation = this.rows.allocations.find((a) => a.resident_id === binds[0] && a.status === "active");
      const bed = this.rows.beds.find((b) => b.id === allocation?.bed_id);
      const room = this.rows.rooms.find((r) => r.id === bed?.room_id);
      const session = this.rows.academic_sessions.find((s) => s.id === allocation?.academic_session_id);
      const booking = this.rows.bookings.find((b) => b.id === allocation?.booking_id);
      return allocation ? { id: allocation.id, status: allocation.status, starts_on: allocation.starts_on, ends_on: allocation.ends_on, assigned_at: allocation.assigned_at, released_at: allocation.released_at, bed_code: bed?.bed_code, label: bed?.label, room_code: room?.room_code, room_name: room?.room_name, room_gender_policy: room?.gender_policy, room_status: room?.status, academic_session_code: session?.code, academic_session_name: session?.name, booking_number: booking?.booking_number } as T : null;
    }
    if (sql.includes("FROM maintenance_requests")) {
      const row = this.rows.maintenance_requests.find((m) => m.id === binds[0] && m.resident_id === binds[1]);
      return row ? this.maintenanceRow(row) as T : null;
    }
    if (sql.includes("FROM announcements")) return (this.visibleAnnouncements().find((a) => a.id === binds[0]) ?? null) as T;
    if (sql.includes("FROM portal_message_deliveries")) return (this.messagesFor(binds.length === 3 ? binds[1] as number : binds[0] as number).find((m) => m.id === binds[0]) ?? null) as T;
    return null;
  }
  async get(table: string, id: number) { return (this.rows[table] ?? []).find((r) => r.id === id) ?? null; }
  visibleAnnouncements() {
    return this.rows.announcements
      .filter((a) => ["all", "residents"].includes(String(a.audience)) && a.status === "published" && (!a.expires_at || String(a.expires_at) > new Date().toISOString()) && this.rows.announcement_channels.some((c) => c.announcement_id === a.id && c.channel === "resident_portal" && c.status === "enabled"))
      .sort((a, b) => Number(b.id) - Number(a.id));
  }
  messagesFor(userId: number) {
    return this.rows.portal_message_deliveries
      .filter((d) => d.user_id === userId)
      .map((d) => {
        const snapshot = this.rows.message_recipient_snapshots.find((s) => s.id === d.recipient_snapshot_id && s.user_id === userId && s.recipient_kind === "resident");
        const message = this.rows.messages.find((m) => m.id === d.message_id && ["sent", "partially_failed"].includes(String(m.status)));
        return snapshot && message ? { id: d.id, status: d.status, delivered_at: d.delivered_at, read_at: d.read_at, subject: message.subject, body: message.body, sent_at: message.sent_at, message_status: message.status, sender_label: "Kissmet Hostel" } : null;
      })
      .filter(Boolean)
      .sort((a, b) => String((b as Record<string, unknown>).sent_at).localeCompare(String((a as Record<string, unknown>).sent_at))) as Record<string, unknown>[];
  }
  maintenanceRow(m: Record<string, unknown>) {
    const room = this.rows.rooms.find((r) => r.id === m.room_id);
    const bed = this.rows.beds.find((b) => b.id === m.bed_id);
    return { id: m.id, request_number: m.request_number, category: m.category, priority: m.priority, status: m.status, title: m.title, description: m.description, opened_at: m.opened_at, assigned_at: m.assigned_at, started_at: m.started_at, resolved_at: m.resolved_at, closed_at: m.closed_at, room_code: room?.room_code, room_name: room?.room_name, bed_code: bed?.bed_code, bed_label: bed?.label };
  }
  async allocateResidentCode() { return `KSM-RES-${String(this.residentSeq++).padStart(4, "0")}`; }
  async allocateApplicationNumber() { return `KSM-APP-${String(this.appSeq++).padStart(4, "0")}`; }
  async allocateMaintenanceRequestNumber() { return `KSM-MNT-${String(this.mntSeq++).padStart(4, "0")}`; }
  async allocatePaymentReference() { return `KSM-PAY-${String(this.paySeq++).padStart(4, "0")}`; }
  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO otp_codes")) {
      const id = this.rows.otp_codes.length + 1;
      this.rows.otp_codes.push({ id, destination: binds[0], code_hash: binds[1], rate_limit_key: binds[2], expires_at: binds[3], registration_payload_json: binds[4], status: "pending", attempt_count: 0, max_attempts: 5 });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO users")) {
      const id = this.rows.users.length + 1;
      this.rows.users.push({ id, email: binds[0], phone: binds[1], display_name: binds[2] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO residents")) {
      if (this.rows.residents.some((r) => r.institution_id === binds[1] && r.student_id === binds[3])) throw new Error("UNIQUE constraint failed");
      const id = this.rows.residents.length + 1;
      this.rows.residents.push({ id, user_id: binds[0], institution_id: binds[1], resident_code: binds[2], student_id: binds[3], first_name: binds[4], middle_name: binds[5], last_name: binds[6], status: "applicant", phone_verified_at: "now" });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO sessions")) this.rows.sessions.push({ id: 1, user_id: binds[0], token_hash: binds[1] });
    if (sql.startsWith("INSERT INTO documents")) {
      const id = this.rows.documents.length + 1;
      if (sql.includes("'payment_slip'")) {
        this.rows.documents.push({ id, owner_user_id: binds[0], resident_id: binds[1], booking_id: binds[2], payment_id: binds[3], document_type: "payment_slip", status: "uploaded", r2_key: binds[4], original_filename: binds[5], content_type: binds[6], size_bytes: binds[7] });
      } else {
        this.rows.documents.push({ id, owner_user_id: binds[0], resident_id: binds[1], document_type: binds[2], status: "uploaded", r2_key: binds[3], original_filename: binds[4], content_type: binds[5], size_bytes: binds[6] });
      }
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO payments")) {
      const id = this.rows.payments.length + 1;
      this.rows.payments.push({ id, booking_id: binds[0], resident_id: binds[1], payment_reference: binds[2], status: "pending", amount_minor: binds[3], currency: binds[4], method: binds[5], paid_at: binds[6], notes: binds[7] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO applications")) {
      if (this.rows.applications.some((a) => a.resident_id === binds[0] && a.academic_session_id === binds[1] && ["draft", "submitted", "under_review", "approved"].includes(String(a.status)))) throw new Error("UNIQUE constraint failed");
      const id = this.rows.applications.length + 1;
      this.rows.applications.push({ id, resident_id: binds[0], academic_session_id: binds[1], application_number: binds[2], status: "draft" });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO maintenance_requests")) {
      const id = this.rows.maintenance_requests.length + 1;
      const bed = this.rows.beds.find((b) => b.id === binds[3]);
      this.rows.maintenance_requests.push({ id, request_number: binds[0], resident_id: binds[1], room_id: bed?.room_id ?? null, bed_id: binds[3], category: binds[4], priority: binds[5], status: "open", title: binds[6], description: binds[7], opened_at: "2026-09-02T00:00:00.000Z" });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE applications")) {
      const id = sql.includes("decision_notes") ? binds[1] : binds[0];
      const row = this.rows.applications.find((a) => a.id === id);
      if (row && sql.includes("status = 'submitted'")) row.status = "submitted";
      if (row && sql.includes("decision_notes")) row.decision_notes = binds[0];
    }
    if (sql.startsWith("UPDATE otp_codes")) {
      const row = this.rows.otp_codes.find((o) => o.id === binds.at(-1));
      if (row) row.status = "used";
    }
    if (sql.startsWith("UPDATE payments")) {
      const row = this.rows.payments.find((p) => p.id === binds.at(-1));
      if (row && sql.includes("status = 'submitted'")) row.status = "submitted";
    }
    if (sql.includes("UPDATE portal_message_deliveries")) {
      const row = this.rows.portal_message_deliveries.find((d) => d.id === binds[0] && d.user_id === binds[1]);
      if (row) {
        row.status = "read";
        row.read_at ??= "2026-09-02T12:00:00.000Z";
      }
    }
    return { meta: { last_row_id: 1, changes: 1 } };
  }
  async audit(_actorUserId: number | null, _actorStaffId: number | null, action: string) { this.audits.push(action); }
  profile(id: number) {
    const r = this.rows.residents.find((row) => row.id === id);
    const u = this.rows.users.find((row) => row.id === r?.user_id);
    const i = this.rows.institutions.find((row) => row.id === r?.institution_id);
    return r ? { ...r, phone: u?.phone, email: u?.email, institution_code: i?.code, institution_name: i?.name } : null;
  }
}

function make(repo = new Repo()) {
  const sms = new Sms();
  const puts: string[] = [];
  const r2 = { put: async (key: string) => { puts.push(key); } };
  return { svc: new ResidentService({} as never, sms, r2 as never, repo as never), repo, sms, puts };
}

describe("resident onboarding", () => {
  it("lists only active public institutions", async () => {
    const { svc } = make();
    await expect(svc.activeInstitutions()).resolves.toMatchObject({ results: [{ code: "ug" }] });
    await expect(svc.activeAcademicSession()).resolves.toMatchObject({ code: "2026", status: "active" });
  });

  it("requests registration OTP and rejects invalid OTP", async () => {
    const { svc, sms } = make();
    await svc.requestRegistrationOtp({ firstName: "New", lastName: "Student", phone: "+2339", institutionCode: "ug", studentId: "S9" });
    expect(sms.last?.destination).toBe("+2339");
    await expect(svc.verifyRegistrationOtp("ug", "S9", "000000")).rejects.toThrow("Invalid or expired OTP");
  });

  it("verifies phone, creates applicant resident, generates resident code, and issues session", async () => {
    const { svc, sms, repo } = make();
    await svc.requestRegistrationOtp({ firstName: "New", middleName: "M", lastName: "Student", phone: "+2339", email: "new@test", institutionCode: "ug", studentId: "S9" });
    const result = await svc.verifyRegistrationOtp("ug", "S9", sms.last!.otp) as Record<string, unknown>;
    expect(result.token).toBeTruthy();
    expect(repo.rows.residents.at(-1)?.resident_code).toBe("KSM-RES-0003");
    expect(repo.rows.sessions).toHaveLength(1);
  });

  it("detects duplicate institution/student registration", async () => {
    const { svc, sms } = make();
    await svc.requestRegistrationOtp({ firstName: "Dup", lastName: "Student", phone: "+2339", institutionCode: "ug", studentId: "S1" });
    expect(sms.last).toBeNull();
  });

  it("retrieves own profile and prevents cross-resident document/application access", async () => {
    const { svc, repo } = make();
    repo.rows.documents.push({ id: 1, resident_id: 1, document_type: "student_card", status: "uploaded" });
    repo.rows.applications.push({ id: 1, resident_id: 1, application_number: "KSM-APP-0001", status: "draft" });
    await expect(svc.me(resident)).resolves.toMatchObject({ resident_code: "KSM-RES-0001" });
    await expect(svc.ownDocument(resident, 1)).resolves.not.toHaveProperty("r2_key");
    await expect(svc.ownDocument(otherResident, 1)).rejects.toThrow("Document not found");
    await expect(svc.ownApplication(otherResident, 1)).rejects.toThrow("Application not found");
  });

  it("uploads private Student Card and Ghana Card documents", async () => {
    const { svc, puts } = make();
    const student = await svc.uploadIdentityDocument(resident, "student_card", new File(["x"], "student.pdf", { type: "application/pdf" })) as Record<string, unknown>;
    const ghana = await svc.uploadIdentityDocument(resident, "ghana_card", new File(["x"], "ghana.png", { type: "image/png" })) as Record<string, unknown>;
    expect(puts.every((key) => key.startsWith("identity/1/"))).toBe(true);
    expect(student).not.toHaveProperty("r2_key");
    expect(student).not.toHaveProperty("r2_bucket");
    expect(ghana).not.toHaveProperty("r2_key");
    await expect(svc.uploadIdentityDocument(resident, "student_card", new File(["x"], "bad.txt", { type: "text/plain" }))).rejects.toThrow("Unsupported document type");
  });

  it("creates, updates, and submits own draft application after required uploads", async () => {
    const { svc, repo } = make();
    repo.rows.documents.push({ id: 1, resident_id: 1, document_type: "student_card", status: "uploaded" }, { id: 2, resident_id: 1, document_type: "ghana_card", status: "uploaded" });
    const app = await svc.createApplication(resident, 1) as Record<string, unknown>;
    expect(app.application_number).toBe("KSM-APP-0001");
    await expect(svc.updateApplication(resident, Number(app.id), { notes: "Quiet room preferred" })).resolves.toMatchObject({ decision_notes: "Quiet room preferred" });
    await expect(svc.createApplication(resident, 1)).rejects.toThrow("Active application already exists for this session");
    await expect(svc.createApplication(resident, 2)).rejects.toThrow("Active academic session not found");
    await expect(svc.submitApplication(resident, Number(app.id))).resolves.toMatchObject({ status: "submitted" });
  });

  it("rejects incomplete application submission and exposes own booking/allocation only", async () => {
    const { svc } = make();
    const app = await svc.createApplication(resident, 1) as Record<string, unknown>;
    await expect(svc.submitApplication(resident, Number(app.id))).rejects.toThrow("Incomplete application");
    await expect(svc.bookings(resident)).resolves.toMatchObject({ results: [{ booking_number: "KSM-BKG-0001" }] });
    await expect(svc.bookings(resident)).resolves.toMatchObject({ results: [{ total_amount_minor: 250000, academic_session_name: "2026 Academic Year", priced_room_code: "R1" }] });
    await expect(svc.bookings(otherResident)).resolves.toMatchObject({ results: [] });
    await expect(svc.allocation(resident)).resolves.toMatchObject({ room_code: "R1", bed_code: "R1-A", academic_session_name: "2026 Academic Year", booking_number: "KSM-BKG-0001", room_gender_policy: "female" });
    await expect(svc.allocation(otherResident)).resolves.toBeNull();
  });

  it("returns resident-owned allocation history with safe labels only", async () => {
    const { svc, repo } = make();
    repo.rows.allocations.unshift({ id: 2, booking_id: 1, resident_id: 1, status: "transferred", bed_id: 1, academic_session_id: 1, starts_on: "2026-08-01", ends_on: "2026-08-31", assigned_by_staff_id: 4 });
    const rows = (await svc.allocations(resident)).results as Record<string, unknown>[];
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "active", room_code: "R1", bed_code: "R1-A", booking_number: "KSM-BKG-0001" }),
      expect.objectContaining({ status: "transferred", starts_on: "2026-08-01", ends_on: "2026-08-31" })
    ]));
    expect(JSON.stringify(rows)).not.toMatch(/assigned_by_staff_id|staffId|audit/i);
    expect((await svc.allocations(otherResident)).results).toEqual([]);
  });

  it("keeps Ghana Card staff access restricted by permission", async () => {
    const app = new Hono<{ Variables: { authUser: AuthUser } }>();
    app.use("*", async (c, next) => { c.set("authUser", reception); return next(); });
    app.get("/ghana", requirePermission("document:ghana_card"), (c) => c.json({ ok: true }));
    expect((await app.request("/ghana")).status).toBe(403);

    const allowed = new Hono<{ Variables: { authUser: AuthUser } }>();
    allowed.use("*", async (c, next) => { c.set("authUser", manager); return next(); });
    allowed.get("/ghana", requirePermission("document:ghana_card"), (c) => c.json({ ok: true }));
    expect((await allowed.request("/ghana")).status).toBe(200);
  });

  it("lets residents create and view only their own maintenance requests", async () => {
    const { svc, repo } = make();
    const created = await svc.createMaintenance(resident, { category: "plumbing", priority: "urgent", title: "Leak", description: "Pipe leak" }) as Record<string, unknown>;
    expect(created.request_number).toBe("KSM-MNT-0003");
    expect(created).toMatchObject({ status: "open", room_code: "R1", bed_code: "R1-A", bed_label: "A" });
    expect(JSON.stringify(created)).not.toMatch(/resident_id|room_id|bed_id|assigned_to_staff_id|staff/i);
    await expect(svc.maintenance(resident)).resolves.toMatchObject({ results: expect.arrayContaining([expect.objectContaining({ request_number: "KSM-MNT-0003", room_code: "R1" })]) });
    await expect(svc.ownMaintenance(otherResident, Number(created.id))).rejects.toThrow("Maintenance request not found");
    await expect(svc.createMaintenance(resident, { category: "invalid", title: "Bad" })).rejects.toThrow("Invalid maintenance category");
    await expect(svc.createMaintenance(resident, { category: "plumbing", priority: "emergency", title: "Bad" })).rejects.toThrow("Invalid maintenance priority");
    expect(repo.audits).toContain("resident.maintenance.created");
  });

  it("allows general maintenance requests without active allocation and preserves original room labels", async () => {
    const { svc, repo } = make();
    repo.rows.allocations = [];
    const general = await svc.createMaintenance(resident, { category: "security", title: "Gate light" }) as Record<string, unknown>;
    expect(general).toMatchObject({ request_number: "KSM-MNT-0003", room_code: undefined, bed_code: undefined });
    repo.rows.beds.push({ id: 2, room_id: 2, bed_code: "R2-A", label: "A" });
    repo.rows.rooms.push({ id: 2, room_code: "R2", room_name: "Room 2", gender_policy: "female", status: "available" });
    repo.rows.allocations = [{ id: 5, booking_id: 1, resident_id: 1, status: "active", bed_id: 2, academic_session_id: 1 }];
    const existing = await svc.ownMaintenance(resident, 1) as Record<string, unknown>;
    expect(existing).toMatchObject({ room_code: "R1", bed_code: "R1-A" });
  });

  it("shows resident and all announcements but excludes staff draft and expired announcements", async () => {
    const { svc } = make();
    const rows = (await svc.announcements(resident)).results as Record<string, unknown>[];
    expect(rows.map((row) => row.title)).toEqual(["All", "Residents"]);
    expect(rows[0]).toMatchObject({ severity: "high_alert" });
    await expect(svc.announcement(resident, 3)).rejects.toThrow("Announcement not found");
    await expect(svc.announcement(resident, 4)).rejects.toThrow("Announcement not found");
    await expect(svc.announcement(resident, 5)).rejects.toThrow("Announcement not found");
  });

  it("lists resident-owned portal messages from send-time snapshots without exposing recipients", async () => {
    const { svc, repo } = make();
    repo.rows.allocations = [{ id: 5, booking_id: 1, resident_id: 1, status: "active", bed_id: 2, academic_session_id: 1 }];
    repo.rows.rooms.push({ id: 2, room_code: "R2", room_name: "Room 2" });
    repo.rows.beds.push({ id: 2, room_id: 2, bed_code: "R2-A", label: "A" });

    const rows = (await svc.messages(resident)).results as Record<string, unknown>[];
    expect(rows.map((row) => row.subject)).toEqual(["Room update", "Private account note"]);
    expect(rows[0]).toMatchObject({ status: "unread", sender_label: "Kissmet Hostel" });
    expect(JSON.stringify(rows)).not.toMatch(/Kojo|recipient|target_config|room_id|resident_id|phone|email|provider|created_by_staff_id/i);
    await expect(svc.messages(otherResident)).resolves.toMatchObject({ results: [expect.objectContaining({ subject: "Room update" })] });
  });

  it("retrieves and marks only the resident's own portal message delivery as read", async () => {
    const { svc, repo } = make();
    await expect(svc.message(resident, 1)).resolves.toMatchObject({ subject: "Room update", status: "unread" });
    await expect(svc.message(resident, 2)).rejects.toThrow("Message not found");
    const read = await svc.markMessageRead(resident, 1) as Record<string, unknown>;
    expect(read).toMatchObject({ id: 1, status: "read", read_at: "2026-09-02T12:00:00.000Z" });
    expect(repo.rows.portal_message_deliveries.find((d) => d.id === 2)?.status).toBe("unread");
    await expect(svc.markMessageRead(resident, 1)).resolves.toMatchObject({ status: "read" });
    expect(repo.audits).toContain("resident.message.read");
  });

  it("creates resident-owned payments with backend references and matching currency", async () => {
    const { svc, repo } = make();
    const payment = await svc.createPayment(resident, { bookingId: 1, amountMinor: 100000, currency: "GHS", method: "mobile_money" }) as Record<string, unknown>;
    expect(payment.payment_reference).toBe("KSM-PAY-0001");
    expect(payment.status).toBe("pending");
    await expect(svc.createPayment(otherResident, { bookingId: 1, amountMinor: 100000, currency: "GHS", method: "cash" })).rejects.toThrow("Booking not found");
    await expect(svc.createPayment(resident, { bookingId: 1, amountMinor: 100000, currency: "USD", method: "cash" })).rejects.toThrow("Payment currency must match booking currency");
    await expect(svc.createPayment(resident, { bookingId: 1, amountMinor: 0, currency: "GHS", method: "cash" })).rejects.toThrow("Payment amount must be positive");
    expect(repo.audits).toContain("resident.payment.created");
  });

  it("summarizes verified submitted pending and refunded resident payments", async () => {
    const { svc, repo } = make();
    repo.rows.payments.push(
      { id: 1, booking_id: 1, resident_id: 1, payment_reference: "KSM-PAY-0001", status: "verified", amount_minor: 100000, currency: "GHS" },
      { id: 2, booking_id: 1, resident_id: 1, payment_reference: "KSM-PAY-0002", status: "submitted", amount_minor: 50000, currency: "GHS" },
      { id: 3, booking_id: 1, resident_id: 1, payment_reference: "KSM-PAY-0003", status: "refunded", amount_minor: 25000, currency: "GHS" }
    );
    await expect(svc.paymentSummary(resident)).resolves.toMatchObject({
      bookingTotalMinor: 250000,
      verifiedTotalMinor: 100000,
      submittedTotalMinor: 50000,
      refundedTotalMinor: 25000,
      outstandingMinor: 150000,
      confirmationRequirementMet: false
    });
  });

  it("submits payments without verifying them and uploads private slips", async () => {
    const { svc, repo, puts } = make();
    const payment = await svc.createPayment(resident, { bookingId: 1, amountMinor: 50000, currency: "GHS", method: "bank_transfer" }) as Record<string, unknown>;
    await expect(svc.submitPayment(resident, Number(payment.id))).resolves.toMatchObject({ status: "submitted" });
    await svc.uploadPaymentSlip(resident, Number(payment.id), new File(["x"], "slip.pdf", { type: "application/pdf" }));
    expect(puts[0]).toContain("payment-slips/KSM-PAY-0001/");
    expect(repo.rows.documents.at(-1)).toMatchObject({ document_type: "payment_slip", resident_id: 1, payment_id: payment.id });
    await expect(svc.uploadPaymentSlip(otherResident, Number(payment.id), new File(["x"], "slip.pdf", { type: "application/pdf" }))).rejects.toThrow("Payment not found");
    await expect(svc.uploadPaymentSlip(resident, Number(payment.id), new File(["x"], "bad.txt", { type: "text/plain" }))).rejects.toThrow("Unsupported payment slip file type");
    expect(repo.audits).toContain("resident.payment.submitted");
    expect(repo.audits).toContain("resident.payment.slip_uploaded");
  });

  it("lists and retrieves only resident-owned receipts", async () => {
    const { svc, repo } = make();
    repo.rows.payments.push({ id: 1, booking_id: 1, resident_id: 1, payment_reference: "KSM-PAY-0001", status: "verified", amount_minor: 100000, currency: "GHS" });
    repo.rows.receipts.push({ id: 1, payment_id: 1, receipt_number: "KSM-RCP-0001", status: "issued" });
    await expect(svc.receipts(resident)).resolves.toMatchObject({ results: [expect.objectContaining({ receipt_number: "KSM-RCP-0001", payment_reference: "KSM-PAY-0001" })] });
    await expect(svc.receipt(resident, 1)).resolves.toMatchObject({ receipt_number: "KSM-RCP-0001" });
    await expect(svc.receipt(otherResident, 1)).rejects.toThrow("Receipt not found");
  });
});
