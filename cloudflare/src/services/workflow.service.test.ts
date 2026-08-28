import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { AdminService } from "./admin.service";
import { requirePermission } from "../middleware/auth.middleware";
import type { AuthUser } from "../auth/context";

const manager: AuthUser = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const reception: AuthUser = { ...manager, role: "reception" };
const maintenance: AuthUser = { ...manager, role: "maintenance" };

class WorkflowRepo {
  rows: Record<string, Record<string, unknown>[]> = {
    applications: [],
    bookings: [],
    allocations: [],
    payments: [],
    receipts: [],
    documents: [],
    payment_confirmation_settings: [{ id: 1, requirement_type: "full", fixed_amount_minor: null, percentage_basis_points: null, status: "active" }],
    residents: [{ id: 1, gender: "female" }, { id: 2, gender: "male" }],
    rooms: [{ id: 1, status: "available", gender_policy: "female", capacity: 2 }, { id: 2, status: "available", gender_policy: "male", capacity: 1 }, { id: 3, status: "available", gender_policy: "female", capacity: 1 }],
    beds: [{ id: 1, room_id: 1, status: "available", label: "A" }, { id: 2, room_id: 1, status: "available", label: "B" }, { id: 3, room_id: 2, status: "maintenance", label: "A" }, { id: 4, room_id: 3, status: "available", label: "A" }],
    room_rates: [{ id: 1, room_id: 1, academic_session_id: 1, amount_minor: 250000, currency: "GHS", status: "active" }]
  };
  audits: string[] = [];
  bookingSeq = 1;
  paymentSeq = 1;
  receiptSeq = 1;

  async list(table: string) { return { results: this.rows[table] ?? [] }; }
  async get(table: string, id: number) { return (this.rows[table] ?? []).find((r) => r.id === id) ?? null; }
  async all<T>(sql: string, ...binds: unknown[]) {
    if (sql.includes("FROM beds")) {
      const [sessionId, gender] = binds;
      const results = this.rows.beds.filter((bed) => {
        const room = this.rows.rooms.find((r) => r.id === bed.room_id)!;
        const rate = this.rows.room_rates.find((r) => r.room_id === room.id && r.academic_session_id === sessionId && r.status === "active");
        const occupied = this.rows.allocations.some((a) => a.bed_id === bed.id && a.status === "active");
        return room.status === "available" && bed.status === "available" && rate && !occupied && (room.gender_policy === "any" || !gender || room.gender_policy === gender);
      });
      return { results: results as T[] };
    }
    return { results: [] as T[] };
  }
  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
    if (sql.startsWith("SELECT * FROM applications")) return this.get("applications", binds[0] as number) as T;
    if (sql.startsWith("SELECT id FROM bookings")) return (this.rows.bookings.find((b) => b.resident_id === binds[0] && b.academic_session_id === binds[1] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
    if (sql.startsWith("SELECT id, amount_minor") || sql.startsWith("SELECT amount_minor")) return (this.rows.room_rates.find((r) => r.room_id === binds[0] && r.academic_session_id === binds[1] && r.status === "active") ?? null) as T;
    if (sql.startsWith("SELECT COALESCE(SUM(amount_minor)")) return { verified_paid_minor: this.rows.payments.filter((p) => p.booking_id === binds[0] && p.status === "verified").reduce((sum, p) => sum + Number(p.amount_minor), 0) } as T;
    if (sql.startsWith("SELECT requirement_type")) return this.rows.payment_confirmation_settings[0] as T;
    if (sql.startsWith("SELECT id FROM receipts")) return (this.rows.receipts.find((r) => r.payment_id === binds[0] && r.status === "issued") ?? null) as T;
    if (sql.includes("FROM receipts rec")) return (this.rows.receipts.find((r) => r.id === binds[0]) ?? null) as T;
    if (sql.startsWith("SELECT gender")) return (this.rows.residents.find((r) => r.id === binds[0]) ?? null) as T;
    if (sql.includes("FROM beds b")) {
      const resident = this.rows.residents.find((r) => r.id === binds[0]);
      const bed = this.rows.beds.find((b) => b.id === binds[1]);
      const room = this.rows.rooms.find((r) => r.id === bed?.room_id);
      return bed && room ? { ...bed, room_status: room.status, gender_policy: room.gender_policy, gender: resident?.gender } as T : null;
    }
    if (sql.startsWith("SELECT id FROM allocations WHERE bed_id")) return (this.rows.allocations.find((a) => a.bed_id === binds[0] && a.status === "active" && a.id !== binds[1]) ?? null) as T;
    if (sql.startsWith("SELECT id FROM allocations WHERE resident_id")) return (this.rows.allocations.find((a) => a.resident_id === binds[0] && a.academic_session_id === binds[1] && a.status === "active" && a.id !== binds[2]) ?? null) as T;
    return null;
  }
  async allocateBookingNumber() { return `KSM-BKG-${String(this.bookingSeq++).padStart(4, "0")}`; }
  async allocatePaymentReference() { return `KSM-PAY-${String(this.paymentSeq++).padStart(4, "0")}`; }
  async allocateReceiptNumber() { return `KSM-RCP-${String(this.receiptSeq++).padStart(4, "0")}`; }
  async allocateResidentCode() { return "KSM-RES-0001"; }
  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO applications")) {
      if (this.rows.applications.some((a) => a.resident_id === binds[0] && a.academic_session_id === binds[1] && ["draft", "submitted", "under_review", "approved"].includes(String(a.status)))) throw new Error("UNIQUE constraint failed");
      const id = this.rows.applications.length + 1;
      this.rows.applications.push({ id, resident_id: binds[0], academic_session_id: binds[1], application_number: binds[2], status: "draft", decision_notes: binds[3] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE applications")) {
      const row = this.rows.applications.find((a) => a.id === binds[6]);
      if (row) Object.assign(row, { status: binds[0], reviewed_by_staff_id: binds[3], decision_notes: binds[5] });
    }
    if (sql.startsWith("INSERT INTO bookings")) {
      if (this.rows.bookings.some((b) => b.booking_number === binds[3])) throw new Error("UNIQUE constraint failed: bookings.booking_number");
      if (this.rows.bookings.some((b) => b.resident_id === binds[0] && b.academic_session_id === binds[1] && ["pending", "confirmed"].includes(String(b.status)))) throw new Error("UNIQUE constraint failed");
      const id = this.rows.bookings.length + 1;
      this.rows.bookings.push({ id, resident_id: binds[0], academic_session_id: binds[1], application_id: binds[2], booking_number: binds[3], status: "pending", total_amount_minor: binds[4], currency: binds[5], priced_room_id: binds[7], priced_room_rate_id: binds[8] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE bookings")) {
      const row = this.rows.bookings.find((b) => b.id === binds[3]);
      if (row) Object.assign(row, { status: binds[0] });
    }
    if (sql.startsWith("INSERT INTO payments")) {
      if (this.rows.payments.some((p) => p.payment_reference === binds[2])) throw new Error("UNIQUE constraint failed: payments.payment_reference");
      const id = this.rows.payments.length + 1;
      this.rows.payments.push({ id, booking_id: binds[0], resident_id: binds[1], payment_reference: binds[2], status: "pending", amount_minor: binds[3], currency: binds[4], method: binds[5], paid_at: binds[6], notes: binds[7] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE payments SET status = 'verified'")) {
      const row = this.rows.payments.find((p) => p.id === binds[2]);
      if (row) Object.assign(row, { status: "verified", verified_by_staff_id: binds[0], notes: binds[1] });
    } else if (sql.startsWith("UPDATE payments SET status = 'refunded'")) {
      const row = this.rows.payments.find((p) => p.id === binds[1]);
      if (row) Object.assign(row, { status: "refunded", notes: binds[0] });
    } else if (sql.startsWith("UPDATE payments")) {
      const row = this.rows.payments.find((p) => p.id === binds[3]);
      if (row) Object.assign(row, { status: binds[0], notes: binds[1] });
    }
    if (sql.startsWith("INSERT INTO documents")) {
      const id = this.rows.documents.length + 1;
      this.rows.documents.push({ id, resident_id: binds[0], booking_id: binds[1], payment_id: binds[2], document_type: "payment_slip", r2_key: binds[3], status: "uploaded" });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO receipts")) {
      if (this.rows.receipts.some((r) => r.payment_id === binds[0] && r.status === "issued")) throw new Error("UNIQUE constraint failed");
      const id = this.rows.receipts.length + 1;
      this.rows.receipts.push({ id, payment_id: binds[0], receipt_number: binds[1], status: "issued", issued_by_staff_id: binds[2] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE receipts")) {
      const row = this.rows.receipts.find((r) => r.id === binds[1]);
      if (row) Object.assign(row, { status: "voided", void_reason: binds[0] });
    }
    if (sql.startsWith("INSERT INTO allocations")) {
      const id = this.rows.allocations.length + 1;
      this.rows.allocations.push({ id, booking_id: binds[0], resident_id: binds[1], academic_session_id: binds[2], bed_id: binds[3], status: "active", starts_on: binds[4] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE allocations")) {
      const row = this.rows.allocations.find((a) => a.id === binds[1]);
      if (row) Object.assign(row, { status: sql.includes("'transferred'") ? "transferred" : binds[0] });
    }
    return { meta: { last_row_id: Math.max(1, ...Object.values(this.rows).flat().map((r) => Number(r.id) || 0)), changes: 1 } };
  }
  async audit(_actorUserId: number, _actorStaffId: number | null, action: string) { this.audits.push(action); }
}

function service(repo = new WorkflowRepo()) {
  return { svc: new AdminService(repo as never), repo };
}

async function approvedBooking(svc: AdminService, repo: WorkflowRepo, residentId = 1) {
  await svc.createApplication(manager, { residentId, academicSessionId: 1, applicationNumber: `APP-${residentId}-${repo.rows.applications.length + 1}` });
  const appId = Number(repo.rows.applications.at(-1)!.id);
  await svc.updateApplicationStatus(manager, appId, "submitted");
  await svc.updateApplicationStatus(manager, appId, "under_review");
  await svc.updateApplicationStatus(manager, appId, "approved");
  await svc.createBooking(manager, { applicationId: appId, roomId: 1 });
  return Number(repo.rows.bookings.at(-1)!.id);
}

describe("phase 5 workflows", () => {
  it("creates, submits, reviews, approves, rejects, and blocks invalid application transitions", async () => {
    const { svc, repo } = service();
    const app = await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" }) as Record<string, unknown>;
    await svc.updateApplicationStatus(manager, Number(app.id), "submitted");
    await svc.updateApplicationStatus(manager, Number(app.id), "under_review", "Looks complete");
    await svc.updateApplicationStatus(manager, Number(app.id), "approved");
    await expect(svc.updateApplicationStatus(manager, Number(app.id), "rejected")).rejects.toThrow("Invalid workflow transition");
    expect(repo.audits).toContain("admin.application.approved");
  });

  it("prevents duplicate active applications for the same resident and session", async () => {
    const { svc } = service();
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await expect(svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-2" })).rejects.toThrow("UNIQUE");
  });

  it("creates bookings from approved applications with generated unique numbers and historical prices", async () => {
    const { svc, repo } = service();
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await expect(svc.createBooking(manager, { applicationId: 1, roomId: 1 })).rejects.toThrow("Only approved");
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    const booking = await svc.createBooking(manager, { applicationId: 1, roomId: 1 }) as Record<string, unknown>;
    repo.rows.room_rates[0].amount_minor = 300000;
    expect(booking.booking_number).toBe("KSM-BKG-0001");
    expect(booking.total_amount_minor).toBe(250000);
    await expect(svc.createBooking(manager, { applicationId: 1, roomId: 1 })).rejects.toThrow("Duplicate active booking");
    repo.rows.bookings[0].status = "cancelled";
    await svc.createApplication(manager, { residentId: 2, academicSessionId: 1, applicationNumber: "APP-2" });
    await svc.updateApplicationStatus(manager, 2, "submitted");
    await svc.updateApplicationStatus(manager, 2, "under_review");
    await svc.updateApplicationStatus(manager, 2, "approved");
    const second = await svc.createBooking(manager, { applicationId: 2, roomId: 1 }) as Record<string, unknown>;
    expect(second.booking_number).toBe("KSM-BKG-0002");
    expect(new Set(repo.rows.bookings.map((row) => row.booking_number)).size).toBe(repo.rows.bookings.length);
  });

  it("requires an active room rate for booking price capture", async () => {
    const { svc, repo } = service();
    repo.rows.room_rates = [];
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    await expect(svc.createBooking(manager, { applicationId: 1, roomId: 1 })).rejects.toThrow("Missing active room rate");
  });

  it("lists availability and enforces allocation constraints", async () => {
    const { svc, repo } = service();
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    await svc.createBooking(manager, { applicationId: 1, roomId: 1 });
    expect(await svc.availability(1, 1)).toHaveLength(2);
    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" })).rejects.toThrow("Booking is not eligible for allocation");
    repo.rows.bookings[0].status = "confirmed";
    await svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" });
    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" })).rejects.toThrow("Unavailable bed");
    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 2, startsOn: "2026-09-01" })).rejects.toThrow("Resident already allocated");
    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 2, academicSessionId: 1, bedId: 2, startsOn: "2026-09-01" })).rejects.toThrow("Booking/resident mismatch");
    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 2, bedId: 2, startsOn: "2026-09-01" })).rejects.toThrow("Session mismatch");
    await svc.updateAllocationStatus(manager, 1, "ended");
  });

  it("rejects inactive beds and gender-policy mismatches", async () => {
    const { svc, repo } = service();
    await svc.createApplication(manager, { residentId: 2, academicSessionId: 1, applicationNumber: "APP-1" });
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    repo.rows.room_rates.push({ id: 2, room_id: 2, academic_session_id: 1, amount_minor: 250000, currency: "GHS", status: "active" });
    await svc.createBooking(manager, { applicationId: 1, roomId: 2 });
    repo.rows.bookings[0].status = "confirmed";
    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 2, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" })).rejects.toThrow("Gender-policy mismatch");
    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 2, academicSessionId: 1, bedId: 3, startsOn: "2026-09-01" })).rejects.toThrow("Inactive bed");
  });

  it("transfers residents while preserving allocation history", async () => {
    const { svc, repo } = service();
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    await svc.createBooking(manager, { applicationId: 1, roomId: 1 });
    repo.rows.bookings[0].status = "confirmed";
    await svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" });
    const moved = await svc.transferAllocation(manager, 1, { destinationBedId: 2, startsOn: "2026-10-01" }) as Record<string, unknown>;
    expect(repo.rows.allocations[0].status).toBe("transferred");
    expect(moved.status).toBe("active");
    expect(repo.rows.allocations).toHaveLength(2);
    expect(repo.audits).toContain("admin.allocation.transfer");
  });

  it("allows allocation to the room used for booking price capture", async () => {
    const { svc, repo } = service();
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    const booking = await svc.createBooking(manager, { applicationId: 1, roomId: 1 }) as Record<string, unknown>;
    repo.rows.bookings[0].status = "confirmed";

    expect(booking).toMatchObject({ total_amount_minor: 250000, currency: "GHS", priced_room_id: 1, priced_room_rate_id: 1 });
    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" })).resolves.toMatchObject({ status: "active" });
  });

  it("rejects allocation to a differently priced room than the booking financial basis", async () => {
    const { svc, repo } = service();
    repo.rows.room_rates.push({ id: 2, room_id: 3, academic_session_id: 1, amount_minor: 300000, currency: "GHS", status: "active" });
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    await svc.createBooking(manager, { applicationId: 1, roomId: 1 });
    repo.rows.bookings[0].status = "confirmed";

    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 4, startsOn: "2026-09-01" })).rejects.toThrow("Destination room rate differs from booking financial basis");
  });

  it("allows allocation to a different room only when active rate and currency match", async () => {
    const { svc, repo } = service();
    repo.rows.room_rates.push({ id: 2, room_id: 3, academic_session_id: 1, amount_minor: 250000, currency: "GHS", status: "active" });
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    await svc.createBooking(manager, { applicationId: 1, roomId: 1 });
    repo.rows.bookings[0].status = "confirmed";

    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 4, startsOn: "2026-09-01" })).resolves.toMatchObject({ status: "active" });
    expect(repo.rows.bookings[0]).toMatchObject({ total_amount_minor: 250000, currency: "GHS", priced_room_id: 1 });
  });

  it("rejects cross-room transfer when the destination room rate differs", async () => {
    const { svc, repo } = service();
    repo.rows.room_rates.push({ id: 2, room_id: 3, academic_session_id: 1, amount_minor: 300000, currency: "GHS", status: "active" });
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    await svc.createBooking(manager, { applicationId: 1, roomId: 1 });
    repo.rows.bookings[0].status = "confirmed";
    await svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" });

    await expect(svc.transferAllocation(manager, 1, { destinationBedId: 4, startsOn: "2026-10-01" })).rejects.toThrow("Destination room rate differs from booking financial basis");
    expect(repo.rows.allocations[0].status).toBe("active");
  });

  it("allows same-priced cross-room transfer as interchangeable financial basis", async () => {
    const { svc, repo } = service();
    repo.rows.room_rates.push({ id: 2, room_id: 3, academic_session_id: 1, amount_minor: 250000, currency: "GHS", status: "active" });
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    await svc.createBooking(manager, { applicationId: 1, roomId: 1 });
    repo.rows.bookings[0].status = "confirmed";
    await svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" });

    await expect(svc.transferAllocation(manager, 1, { destinationBedId: 4, startsOn: "2026-10-01" })).resolves.toMatchObject({ status: "active" });
    expect(repo.rows.bookings[0]).toMatchObject({ total_amount_minor: 250000, currency: "GHS", priced_room_id: 1 });
  });

  it("allows normal allocation only for confirmed bookings", async () => {
    const { svc, repo } = service();
    await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: "APP-1" });
    await svc.updateApplicationStatus(manager, 1, "submitted");
    await svc.updateApplicationStatus(manager, 1, "under_review");
    await svc.updateApplicationStatus(manager, 1, "approved");
    await svc.createBooking(manager, { applicationId: 1, roomId: 1 });

    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" })).rejects.toThrow("Booking is not eligible for allocation");
    repo.rows.bookings[0].status = "confirmed";
    await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" })).resolves.toMatchObject({ status: "active" });
  });

  it("rejects new active allocations for cancelled, expired, and completed bookings", async () => {
    for (const status of ["cancelled", "expired", "completed"]) {
      const { svc, repo } = service();
      await svc.createApplication(manager, { residentId: 1, academicSessionId: 1, applicationNumber: `APP-${status}` });
      await svc.updateApplicationStatus(manager, 1, "submitted");
      await svc.updateApplicationStatus(manager, 1, "under_review");
      await svc.updateApplicationStatus(manager, 1, "approved");
      await svc.createBooking(manager, { applicationId: 1, roomId: 1 });
      repo.rows.bookings[0].status = status;

      await expect(svc.createAllocation(manager, { bookingId: 1, residentId: 1, academicSessionId: 1, bedId: 1, startsOn: "2026-09-01" })).rejects.toThrow("Booking is not eligible for allocation");
    }
  });

  it("enforces route permissions", async () => {
    const app = new Hono<{ Variables: { authUser: AuthUser } }>();
    app.use("*", async (c, next) => { c.set("authUser", maintenance); return next(); });
    app.post("/allocations", requirePermission("allocation:write"), (c) => c.json({ ok: true }));
    expect((await app.request("/allocations", { method: "POST" })).status).toBe(403);
  });

  it("blocks reception from financial verification authority", async () => {
    const app = new Hono<{ Variables: { authUser: AuthUser } }>();
    app.use("*", async (c, next) => { c.set("authUser", reception); return next(); });
    app.post("/payments/1/verify", requirePermission("payment:verify"), (c) => c.json({ ok: true }));
    expect((await app.request("/payments/1/verify", { method: "POST" })).status).toBe(403);
  });

  it("handles part payments, summaries, and payment reference generation", async () => {
    const { svc, repo } = service();
    const bookingId = await approvedBooking(svc, repo);
    const first = await svc.createPayment(manager, { bookingId, residentId: 1, amountMinor: 100000, method: "cash" }) as Record<string, unknown>;
    const second = await svc.createPayment(manager, { bookingId, residentId: 1, amountMinor: 150000, method: "mobile_money" }) as Record<string, unknown>;
    expect(first.payment_reference).toBe("KSM-PAY-0001");
    expect(second.payment_reference).toBe("KSM-PAY-0002");
    await svc.updatePaymentStatus(manager, 1, "submitted");
    await svc.verifyPayment(manager, 1);
    expect(await svc.bookingPaymentSummary(bookingId)).toMatchObject({ verifiedPaidMinor: 100000, balanceMinor: 150000, confirmationRequirementMet: false });
  });

  it("submits and rejects payments while blocking invalid status transitions", async () => {
    const { svc, repo } = service();
    const bookingId = await approvedBooking(svc, repo);
    await svc.createPayment(manager, { bookingId, residentId: 1, amountMinor: 100000, method: "bank_transfer" });
    await svc.updatePaymentStatus(manager, 1, "submitted");
    await expect(svc.updatePaymentStatus(manager, 1, "archived")).rejects.toThrow("Invalid workflow transition");
    await svc.updatePaymentStatus(manager, 1, "rejected", "Invalid slip");
    expect(repo.rows.payments[0].status).toBe("rejected");
    expect(repo.audits).toContain("admin.payment.rejected");
  });

  it("supports full, percentage, and fixed confirmation thresholds", async () => {
    const { svc, repo } = service();
    const bookingId = await approvedBooking(svc, repo);
    await expect(svc.updateBookingStatus(manager, bookingId, "confirmed")).rejects.toThrow("Payment confirmation requirement not satisfied");
    await svc.createPayment(manager, { bookingId, residentId: 1, amountMinor: 250000, method: "cash" });
    await svc.updatePaymentStatus(manager, 1, "submitted");
    await svc.verifyPayment(manager, 1);
    await expect(svc.updateBookingStatus(manager, bookingId, "confirmed")).resolves.toMatchObject({ status: "confirmed" });

    const half = service();
    half.repo.rows.payment_confirmation_settings[0] = { id: 1, requirement_type: "percentage", percentage_basis_points: 5000, fixed_amount_minor: null, status: "active" };
    const halfBooking = await approvedBooking(half.svc, half.repo);
    await half.svc.createPayment(manager, { bookingId: halfBooking, residentId: 1, amountMinor: 125000, method: "bank_transfer" });
    await half.svc.updatePaymentStatus(manager, 1, "submitted");
    await half.svc.verifyPayment(manager, 1);
    expect(await half.svc.bookingPaymentSummary(halfBooking)).toMatchObject({ requiredConfirmationAmountMinor: 125000, confirmationRequirementMet: true });

    const fixed = service();
    fixed.repo.rows.payment_confirmation_settings[0] = { id: 1, requirement_type: "fixed", fixed_amount_minor: 100000, percentage_basis_points: null, status: "active" };
    const fixedBooking = await approvedBooking(fixed.svc, fixed.repo);
    await fixed.svc.createPayment(manager, { bookingId: fixedBooking, residentId: 1, amountMinor: 100000, method: "card" });
    await fixed.svc.updatePaymentStatus(manager, 1, "submitted");
    await fixed.svc.verifyPayment(manager, 1);
    expect(await fixed.svc.bookingPaymentSummary(fixedBooking)).toMatchObject({ requiredConfirmationAmountMinor: 100000, confirmationRequirementMet: true });
  });

  it("rejects overpayment and payment resident mismatches", async () => {
    const { svc, repo } = service();
    const bookingId = await approvedBooking(svc, repo);
    await expect(svc.createPayment(manager, { bookingId, residentId: 2, amountMinor: 100000, method: "cash" })).rejects.toThrow("Payment resident/booking mismatch");
    await svc.createPayment(manager, { bookingId, residentId: 1, amountMinor: 250000, method: "cash" });
    await svc.updatePaymentStatus(manager, 1, "submitted");
    await svc.verifyPayment(manager, 1);
    repo.rows.bookings[0].status = "cancelled";
    repo.rows.applications[0].status = "archived";
    const secondBooking = await approvedBooking(svc, repo);
    await svc.createPayment(manager, { bookingId: secondBooking, residentId: 1, amountMinor: 300000, method: "cash" });
    await svc.updatePaymentStatus(manager, 2, "submitted");
    await expect(svc.verifyPayment(manager, 2)).rejects.toThrow("Payment would exceed booking total");
  });

  it("uploads private payment-slip metadata and issues unique receipts only for verified payments", async () => {
    const { svc, repo } = service();
    const puts: string[] = [];
    const svcWithR2 = new AdminService(repo as never, { put: async (key: string) => { puts.push(key); } } as never);
    const bookingId = await approvedBooking(svcWithR2, repo);
    await svcWithR2.createPayment(manager, { bookingId, residentId: 1, amountMinor: 250000, method: "cash" });
    await expect(svcWithR2.issueReceipt(manager, 1)).rejects.toThrow("Receipt requires verified payment");
    const file = new File(["slip"], "slip.pdf", { type: "application/pdf" });
    const doc = await svcWithR2.uploadPaymentSlip(manager, 1, file) as Record<string, unknown>;
    expect(puts[0]).toContain("payment-slips/KSM-PAY-0001/");
    expect(doc.document_type).toBe("payment_slip");
    await svcWithR2.updatePaymentStatus(manager, 1, "submitted");
    await svcWithR2.verifyPayment(manager, 1);
    const receipt = await svcWithR2.issueReceipt(manager, 1) as Record<string, unknown>;
    expect(receipt.receipt_number).toBe("KSM-RCP-0001");
    await expect(svcWithR2.issueReceipt(manager, 1)).rejects.toThrow("Payment already has an active receipt");
  });

  it("removes refunded payments from verified totals and flags confirmed booking deficiency", async () => {
    const { svc, repo } = service();
    const bookingId = await approvedBooking(svc, repo);
    await svc.createPayment(manager, { bookingId, residentId: 1, amountMinor: 250000, method: "cash" });
    await svc.updatePaymentStatus(manager, 1, "submitted");
    await svc.verifyPayment(manager, 1);
    await svc.updateBookingStatus(manager, bookingId, "confirmed");
    await svc.refundPayment(manager, 1);
    expect(await svc.bookingPaymentSummary(bookingId)).toMatchObject({ verifiedPaidMinor: 0, confirmationRequirementMet: false });
    expect(repo.rows.bookings[0].status).toBe("confirmed");
    expect(repo.audits).toContain("admin.booking.payment_deficiency_after_refund");
  });
});
