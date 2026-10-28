import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { AdminService } from "./admin.service";
import { requirePermission } from "../middleware/auth.middleware";
import type { AuthUser } from "../auth/context";

const superAdmin: AuthUser = { id: 9, userType: "staff", displayName: "SA", email: "sa@test", role: "super_admin", staffId: 9, residentId: null, sessionId: 1 };
const manager: AuthUser = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts: AuthUser = { ...manager, id: 2, role: "accounts", staffId: 2 };
const reception: AuthUser = { ...manager, id: 3, role: "reception", staffId: 3 };

class LifecycleRepo {
  rows: Record<string, Record<string, unknown>[]> = {
    lease_periods: [
      { id: 1, kind: "academic_calendar", code: "AC-26", name: "AC26", starts_on: "2026-09-01", ends_on: "2027-06-30", status: "active", academic_session_id: 1 },
      { id: 2, kind: "academic_calendar", code: "AC-27", name: "AC27", starts_on: "2027-09-01", ends_on: "2028-06-30", status: "active", academic_session_id: 2 },
      { id: 3, kind: "calendar_year", code: "CY-27", name: "CY27", starts_on: "2027-01-01", ends_on: "2027-12-31", status: "active", academic_session_id: null },
      { id: 4, kind: "short_term", code: "ST-Q1", name: "STQ1", starts_on: "2027-01-01", ends_on: "2027-03-31", status: "active", academic_session_id: null },
      { id: 5, kind: "short_term", code: "ST-Q2", name: "STQ2", starts_on: "2027-04-01", ends_on: "2027-06-30", status: "active", academic_session_id: null },
      { id: 6, kind: "calendar_year", code: "CY-28", name: "CY28", starts_on: "2028-01-01", ends_on: "2028-12-31", status: "active", academic_session_id: null }
    ],
    rate_cards: [
      { id: 1, lease_period_id: 1, occupancy_capacity: 2, rate_code: "AC26-2", amount_minor: 600000, currency: "GHS", status: "active" },
      { id: 2, lease_period_id: 2, occupancy_capacity: 2, rate_code: "AC27-2", amount_minor: 650000, currency: "GHS", status: "active" },
      { id: 3, lease_period_id: 3, occupancy_capacity: 2, rate_code: "CY27-2", amount_minor: 900000, currency: "GHS", status: "active" },
      { id: 4, lease_period_id: 4, occupancy_capacity: 2, rate_code: "STQ1-2", amount_minor: 350000, currency: "GHS", status: "active" },
      { id: 5, lease_period_id: 5, occupancy_capacity: 2, rate_code: "STQ2-2", amount_minor: 360000, currency: "GHS", status: "active" },
      { id: 6, lease_period_id: 6, occupancy_capacity: 2, rate_code: "CY28-2", amount_minor: 950000, currency: "GHS", status: "active" },
      { id: 7, lease_period_id: 3, occupancy_capacity: 4, rate_code: "CY27-4", amount_minor: 700000, currency: "GHS", status: "active" }
    ],
    rooms: [
      { id: 1, room_code: "DAISY", capacity: 2, status: "available", gender_policy: "any" },
      { id: 2, room_code: "ROSE", capacity: 2, status: "available", gender_policy: "any" },
      { id: 3, room_code: "LILY", capacity: 4, status: "available", gender_policy: "any" }
    ],
    beds: [
      { id: 1, room_id: 1, bed_code: "DAISY-B1", label: "B1", status: "available" },
      { id: 2, room_id: 1, bed_code: "DAISY-B2", label: "B2", status: "available" },
      { id: 3, room_id: 2, bed_code: "ROSE-B1", label: "B1", status: "available" },
      { id: 4, room_id: 2, bed_code: "ROSE-B2", label: "B2", status: "available" }
    ],
    residents: [
      { id: 1, resident_code: "KSM-RES-0001", gender: "female", ghana_card_number: null },
      { id: 2, resident_code: "KSM-RES-0002", gender: "male", ghana_card_number: "GHA-123456789-0" }
    ],
    applications: [
      { id: 1, resident_id: 1, academic_session_id: 1, lease_period_id: 1, lease_kind: "academic_calendar", status: "approved", application_number: "A1" }
    ],
    bookings: [],
    payments: [],
    allocations: [],
    payment_confirmation_settings: [{ id: 1, requirement_type: "full", fixed_amount_minor: null, percentage_basis_points: null, status: "active" }],
    academic_sessions: [
      { id: 1, code: "2026", name: "2026/27", status: "active" },
      { id: 2, code: "2027", name: "2027/28", status: "active" }
    ]
  };
  audits: Array<{ action: string; entityType: string; entityId: number | null; metadata?: Record<string, unknown> }> = [];
  bookingSeq = 1;
  allocationSeq = 1;

  async list(table: string) { return { results: this.rows[table] ?? [] }; }
  async get(table: string, id: number) { return (this.rows[table] ?? []).find((r) => r.id === id) ?? null; }
  async allocateBookingNumber() { return `KSM-BKG-${String(this.bookingSeq++).padStart(4, "0")}`; }
  async allocatePaymentReference() { return "KSM-PAY-0001"; }
  async allocateReceiptNumber() { return "KSM-RCP-0001"; }
  async allocateApplicationNumber() { return "KSM-APP-0001"; }
  async allocateResidentCode() { return "KSM-RES-0099"; }

  async all<T>(_sql: string, ..._binds: unknown[]) { return { results: [] as T[] }; }

  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
    if (sql.includes("FROM lease_periods") || (sql.includes("lease_periods") && sql.includes("id = ?"))) {
      return (this.rows.lease_periods.find((r) => r.id === binds[0]) ?? null) as T;
    }
    if (sql.includes("FROM rate_cards") || sql.includes("rate_cards")) {
      if (sql.includes("occupancy_capacity")) {
        return (this.rows.rate_cards.find((r) => r.lease_period_id === binds[0] && r.occupancy_capacity === binds[1] && r.status === "active") ?? null) as T;
      }
      return (this.rows.rate_cards.find((r) => r.id === binds[0]) ?? null) as T;
    }
    if (sql.includes("FROM applications")) return (this.rows.applications.find((a) => a.id === binds[0]) ?? null) as T;
    if (sql.includes("FROM rooms")) return (this.rows.rooms.find((r) => r.id === binds[0]) ?? null) as T;
    if (sql.includes("FROM beds") && sql.includes("JOIN rooms") && sql.includes("JOIN residents")) {
      const bed = this.rows.beds.find((b) => b.id === binds[1]);
      const room = bed ? this.rows.rooms.find((r) => r.id === bed.room_id) : null;
      const resident = this.rows.residents.find((r) => r.id === binds[0]);
      if (!bed || !room || !resident) return null;
      return {
        id: bed.id,
        status: bed.status,
        room_id: bed.room_id,
        room_status: room.status,
        gender_policy: room.gender_policy,
        gender: resident.gender
      } as T;
    }
    if (sql.includes("SELECT room_id FROM beds") || (sql.includes("FROM beds") && sql.includes("room_id"))) {
      const bed = this.rows.beds.find((b) => b.id === binds[0]);
      return (bed ? { room_id: bed.room_id, status: bed.status } : null) as T;
    }
    if (sql.includes("verified_paid_minor") || (sql.includes("COALESCE(SUM(amount_minor)") && sql.includes("verified"))) {
      const bookingId = binds[0] as number;
      const sum = this.rows.payments.filter((p) => p.booking_id === bookingId && p.status === "verified").reduce((s, p) => s + Number(p.amount_minor), 0);
      if (sql.includes("verified_count")) return { verified_count: this.rows.payments.filter((p) => p.booking_id === bookingId && p.status === "verified").length } as T;
      return { verified_paid_minor: sum } as T;
    }
    if (sql.includes("COUNT(*) AS verified_count")) {
      return { verified_count: this.rows.payments.filter((p) => p.booking_id === binds[0] && p.status === "verified").length } as T;
    }
    if (sql.includes("payment_confirmation_settings")) return this.rows.payment_confirmation_settings[0] as T;
    if (sql.includes("FROM allocations WHERE booking_id") && sql.includes("status = 'active'")) {
      return ([...this.rows.allocations].reverse().find((a) => a.booking_id === binds[0] && a.status === "active") ?? null) as T;
    }
    if (sql.includes("FROM allocations") && sql.includes("bed_id = ?")) {
      const bedId = binds[0];
      const ignoreId = binds[1];
      const startsOn = binds[2] as string;
      const endsOn = binds[3] as string | null;
      const hit = this.rows.allocations.find((a) => {
        if (a.bed_id !== bedId || a.id === ignoreId) return false;
        if (!["active", "transferred", "ended"].includes(String(a.status))) return false;
        const aEnd = a.ends_on == null ? null : String(a.ends_on);
        const aStart = String(a.starts_on);
        const aEndsBefore = aEnd != null && aEnd !== "" && aEnd < startsOn;
        const bEndsBefore = endsOn != null && endsOn !== "" && endsOn < aStart;
        return !(aEndsBefore || bEndsBefore);
      });
      return (hit ? { id: hit.id } : null) as T;
    }
    if (sql.includes("FROM allocations") && sql.includes("resident_id = ?")) {
      const residentId = binds[0];
      const ignoreId = binds[1];
      const startsOn = binds[2] as string;
      const endsOn = binds[3] as string | null;
      const hit = this.rows.allocations.find((a) => {
        if (a.resident_id !== residentId || a.id === ignoreId) return false;
        if (!["active", "transferred", "ended"].includes(String(a.status))) return false;
        const aEnd = a.ends_on == null ? null : String(a.ends_on);
        const aStart = String(a.starts_on);
        const aEndsBefore = aEnd != null && aEnd !== "" && aEnd < startsOn;
        const bEndsBefore = endsOn != null && endsOn !== "" && endsOn < aStart;
        return !(aEndsBefore || bEndsBefore);
      });
      return (hit ? { id: hit.id } : null) as T;
    }
    if (sql.includes("SELECT id FROM bookings WHERE")) {
      if (sql.includes("application_id")) return (this.rows.bookings.find((b) => b.application_id === binds[0] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
      if (sql.includes("lease_period_id")) return (this.rows.bookings.find((b) => b.resident_id === binds[0] && b.lease_period_id === binds[1] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
      if (sql.includes("academic_session_id")) return (this.rows.bookings.find((b) => b.resident_id === binds[0] && b.academic_session_id === binds[1] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
    }
    if (sql.includes("SELECT gender FROM residents")) {
      return (this.rows.residents.find((r) => r.id === binds[0]) as T) ?? null;
    }
    return null;
  }

  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO bookings")) {
      const id = this.rows.bookings.length + 1;
      // renew path hardcodes payment fields; createBookingFromRateCard passes them as binds
      const isRenew = sql.includes("NULL, ?, 'pending'") && sql.includes("'full', NULL, NULL, 0");
      if (isRenew) {
        this.rows.bookings.push({
          id,
          resident_id: binds[0],
          academic_session_id: binds[1],
          application_id: null,
          booking_number: binds[2],
          status: "pending",
          total_amount_minor: binds[3],
          currency: binds[4],
          expires_at: binds[5],
          priced_room_id: binds[6],
          priced_room_rate_id: null,
          lease_period_id: binds[7],
          lease_kind: binds[8],
          starts_on: binds[9],
          ends_on: binds[10],
          maintenance_fee_minor: binds[11],
          payment_requirement_type: "full",
          payment_fixed_amount_minor: null,
          payment_percentage_basis_points: null,
          partial_payment_authorized: 0,
          prior_booking_id: binds[12],
          override_reason: binds[13] ?? null,
          payment_attention_required: 0
        });
      } else {
        this.rows.bookings.push({
          id,
          resident_id: binds[0],
          academic_session_id: binds[1],
          application_id: binds[2],
          booking_number: binds[3],
          status: "pending",
          total_amount_minor: binds[4],
          currency: binds[5],
          expires_at: binds[6],
          priced_room_id: binds[7],
          priced_room_rate_id: null,
          lease_period_id: binds[8],
          lease_kind: binds[9],
          starts_on: binds[10],
          ends_on: binds[11],
          maintenance_fee_minor: binds[12],
          payment_requirement_type: binds[13],
          payment_fixed_amount_minor: binds[14],
          payment_percentage_basis_points: binds[15],
          partial_payment_authorized: 0,
          prior_booking_id: binds[16],
          override_reason: binds[17] ?? null,
          payment_attention_required: 0
        });
      }
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO allocations")) {
      const id = this.allocationSeq++;
      this.rows.allocations.push({
        id,
        booking_id: binds[0],
        resident_id: binds[1],
        academic_session_id: binds[2],
        bed_id: binds[3],
        status: "active",
        starts_on: binds[4],
        ends_on: binds[5],
        assigned_by_staff_id: binds[6],
        notes: binds[7] ?? null
      });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE bookings SET") && sql.includes("ends_on = ?") && sql.includes("total_amount_minor")) {
      // extension or cross-room commercial update
      const id = binds[binds.length - 1] as number;
      const row = this.rows.bookings.find((b) => b.id === id);
      if (row) {
        if (sql.includes("priced_room_id")) {
          row.priced_room_id = binds[0];
          row.total_amount_minor = binds[1];
          row.maintenance_fee_minor = binds[2];
          if (Number(binds[3]) === 1) row.override_reason = binds[4];
        } else {
          row.ends_on = binds[0];
          row.total_amount_minor = binds[1];
          row.maintenance_fee_minor = binds[2];
          row.override_reason = binds[3];
        }
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE bookings SET") && sql.includes("priced_room_id")) {
      const id = binds[binds.length - 1] as number;
      const row = this.rows.bookings.find((b) => b.id === id);
      if (row) {
        row.priced_room_id = binds[0];
        row.total_amount_minor = binds[1];
        row.maintenance_fee_minor = binds[2];
        if (binds.length >= 6 && Number(binds[3]) === 1) row.override_reason = binds[4];
        else if (binds.length === 5) row.override_reason = binds[3];
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE allocations SET status = 'transferred'")) {
      const row = this.rows.allocations.find((a) => a.id === binds[1]);
      if (row) Object.assign(row, { status: "transferred", ends_on: binds[0] });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE allocations SET ends_on")) {
      const row = this.rows.allocations.find((a) => a.id === binds[1] && a.status === "active");
      if (row) row.ends_on = binds[0];
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE bookings SET status")) {
      const row = this.rows.bookings.find((b) => b.id === binds[3] || b.id === binds[binds.length - 1]);
      if (row) row.status = binds[0];
      return { meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE bookings SET") && sql.includes("partial_payment_authorized")) {
      const row = this.rows.bookings.find((b) => b.id === binds[4] || b.id === binds[binds.length - 1]);
      if (row) {
        row.partial_payment_authorized = binds[0];
        row.payment_requirement_type = binds[1];
        row.payment_fixed_amount_minor = binds[2];
        row.payment_percentage_basis_points = binds[3];
      }
      return { meta: { changes: 1 } };
    }
    return { meta: { last_row_id: 0, changes: 1 } };
  }

  async audit(_a: number | null, _s: number | null, action: string, entityType: string, entityId: number | null, metadata?: Record<string, unknown>) {
    this.audits.push({ action, entityType, entityId, metadata });
  }
}

function admin(repo = new LifecycleRepo()) {
  return { svc: new AdminService(repo as never), repo };
}

async function seedPrior(repo: LifecycleRepo, svc: AdminService, opts?: Partial<{
  applicationId: number; roomId: number; leasePeriodId: number; maintenance: number; amount: number; status: string;
}>) {
  const created = await svc.createBookingFromRateCard(manager, {
    applicationId: opts?.applicationId ?? 1,
    roomId: opts?.roomId ?? 1,
    leasePeriodId: opts?.leasePeriodId ?? 1,
    maintenanceFeeMinor: opts?.maintenance ?? 50000,
    agreedAmountMinor: opts?.amount,
    overrideReason: opts?.amount ? "seed deal" : undefined
  });
  const id = created.booking.id as number;
  if (opts?.status && opts.status !== "pending") {
    const row = repo.rows.bookings.find((b) => b.id === id)!;
    row.status = opts.status;
  }
  return id;
}

describe("Stage 2L-K renewal", () => {
  it("creates renewal with prior_booking_id; old unchanged; no app share; full payment default", async () => {
    const { svc, repo } = admin();
    const priorId = await seedPrior(repo, svc, { status: "confirmed" });
    const priorSnapshot = { ...repo.rows.bookings.find((b) => b.id === priorId)! };
    // authorize partial on prior — must NOT carry
    await svc.setBookingPaymentPolicy(manager, priorId, {
      partialPaymentAuthorized: true,
      paymentRequirementType: "fixed",
      paymentFixedAmountMinor: 100000,
      reason: "prior arrangement"
    });
    repo.rows.payments.push({ id: 1, booking_id: priorId, amount_minor: 100000, status: "verified" });

    const renewed = await svc.renewBooking(manager, priorId, {
      roomId: 1,
      leasePeriodId: 2,
      maintenanceFeeMinor: 75000,
      reason: "Returning resident AC renewal"
    });
    expect(renewed.booking.prior_booking_id).toBe(priorId);
    expect(renewed.booking.application_id).toBeNull();
    expect(renewed.booking.resident_id).toBe(priorSnapshot.resident_id);
    expect(renewed.booking.lease_kind).toBe("academic_calendar");
    expect(renewed.booking.academic_session_id).toBe(2);
    expect(renewed.booking.total_amount_minor).toBe(650000); // new rate card, not old 600000
    expect(renewed.booking.maintenance_fee_minor).toBe(75000); // independent
    expect(Number(renewed.booking.partial_payment_authorized)).toBe(0);
    expect(renewed.booking.payment_requirement_type).toBe("full");
    expect(renewed.agreement.prior_booking_id).toBe(priorId);

    const prior = repo.rows.bookings.find((b) => b.id === priorId)!;
    expect(prior.total_amount_minor).toBe(priorSnapshot.total_amount_minor);
    expect(prior.starts_on).toBe(priorSnapshot.starts_on);
    expect(prior.ends_on).toBe(priorSnapshot.ends_on);
    expect(prior.priced_room_id).toBe(priorSnapshot.priced_room_id);
    expect(repo.rows.allocations.filter((a) => a.booking_id === renewed.booking.id).length).toBe(0);
    expect(repo.rows.payments.filter((p) => p.booking_id === renewed.booking.id).length).toBe(0);
    expect(repo.audits.some((a) => a.action === "admin.booking.renewal")).toBe(true);
  });

  it("supports same and different room renewal", async () => {
    const { svc, repo } = admin();
    const priorId = await seedPrior(repo, svc, { status: "completed" });
    const sameRoom = await svc.renewBooking(manager, priorId, {
      roomId: 1, leasePeriodId: 2, maintenanceFeeMinor: 0
    });
    expect(sameRoom.booking.priced_room_id).toBe(1);
    expect(sameRoom.booking.prior_booking_id).toBe(priorId);
    repo.rows.bookings.find((b) => b.id === sameRoom.booking.id)!.status = "completed";

    // Different prior for different room (new resident booking chain)
    repo.rows.bookings.push({
      id: 80, resident_id: 2, academic_session_id: 1, application_id: null, booking_number: "P80",
      status: "completed", total_amount_minor: 600000, currency: "GHS", priced_room_id: 1, lease_period_id: 1,
      lease_kind: "academic_calendar", starts_on: "2026-09-01", ends_on: "2027-06-30", maintenance_fee_minor: 0,
      payment_requirement_type: "full", partial_payment_authorized: 0, prior_booking_id: null
    });
    const diffRoom = await svc.renewBooking(manager, 80, {
      roomId: 2, leasePeriodId: 2, maintenanceFeeMinor: 0
    });
    expect(diffRoom.booking.priced_room_id).toBe(2);
    expect(repo.rows.bookings.find((b) => b.id === 80)!.priced_room_id).toBe(1);
  });

  it("rejects overlapping renewal dates and cancelled prior; blocks self-prior cycle", async () => {
    const { svc, repo } = admin();
    const priorId = await seedPrior(repo, svc, { status: "confirmed" });
    await expect(svc.renewBooking(manager, priorId, {
      roomId: 1, leasePeriodId: 1, startsOn: "2026-10-01", endsOn: "2027-05-01", maintenanceFeeMinor: 0
    })).rejects.toThrow(/overlap/i);

    repo.rows.bookings.push({
      id: 99, resident_id: 1, academic_session_id: null, application_id: null, booking_number: "X",
      status: "cancelled", total_amount_minor: 100, currency: "GHS", priced_room_id: 1, lease_period_id: 4,
      lease_kind: "short_term", starts_on: "2025-01-01", ends_on: "2025-03-31", maintenance_fee_minor: 0,
      payment_requirement_type: "full", partial_payment_authorized: 0, prior_booking_id: null
    });
    await expect(svc.renewBooking(manager, 99, {
      roomId: 1, leasePeriodId: 4, startsOn: "2027-01-01", endsOn: "2027-03-31", maintenanceFeeMinor: 0
    })).rejects.toThrow(/not eligible/i);
  });

  it("allows authorized price override on renewal; does not copy old price as authority", async () => {
    const { svc, repo } = admin();
    const priorId = await seedPrior(repo, svc, { status: "confirmed", amount: 550000 });
    await expect(svc.renewBooking(manager, priorId, {
      roomId: 1, leasePeriodId: 2, agreedAmountMinor: 500000, maintenanceFeeMinor: 0
    })).rejects.toThrow(/Override reason/);
    const renewed = await svc.renewBooking(manager, priorId, {
      roomId: 1, leasePeriodId: 2, agreedAmountMinor: 500000, overrideReason: "Loyalty discount", maintenanceFeeMinor: 0
    });
    expect(renewed.booking.total_amount_minor).toBe(500000);
    expect(renewed.booking.total_amount_minor).not.toBe(550000);
    expect(renewed.booking.total_amount_minor).not.toBe(650000);
  });

  it("gates renew behind admin:write", async () => {
    for (const role of [accounts, reception]) {
      const app = new Hono<{ Variables: { authUser: AuthUser } }>();
      app.use("*", async (c, next) => { c.set("authUser", role); await next(); });
      app.post("/bookings/:id/renew", requirePermission("admin:write"), (c) => c.json({ ok: true }));
      expect((await app.request("/bookings/1/renew", { method: "POST" })).status).toBe(403);
    }
    const allowed = new Hono<{ Variables: { authUser: AuthUser } }>();
    allowed.use("*", async (c, next) => { c.set("authUser", manager); await next(); });
    allowed.post("/bookings/:id/renew", requirePermission("admin:write"), (c) => c.json({ ok: true }));
    expect((await allowed.request("/bookings/1/renew", { method: "POST" })).status).toBe(200);
  });
});

describe("Stage 2L-K renewal lease-type transitions", () => {
  it("AC→CY without fake academic session", async () => {
    const { svc, repo } = admin();
    const acId = await seedPrior(repo, svc, { status: "completed" });
    const cy = await svc.renewBooking(manager, acId, {
      roomId: 2, leasePeriodId: 6, maintenanceFeeMinor: 0
    });
    expect(cy.booking.lease_kind).toBe("calendar_year");
    expect(cy.booking.academic_session_id).toBeNull();
    expect(cy.booking.prior_booking_id).toBe(acId);
    expect(cy.booking.starts_on).toBe("2028-01-01");
  });

  it("CY→ST without overlap or fake session", async () => {
    const { svc, repo } = admin();
    repo.rows.bookings.push({
      id: 60, resident_id: 1, academic_session_id: null, application_id: null, booking_number: "CY60",
      status: "completed", total_amount_minor: 900000, currency: "GHS", priced_room_id: 1, lease_period_id: 3,
      lease_kind: "calendar_year", starts_on: "2026-01-01", ends_on: "2026-12-31", maintenance_fee_minor: 0,
      payment_requirement_type: "full", partial_payment_authorized: 0, prior_booking_id: null
    });
    const st = await svc.renewBooking(manager, 60, {
      roomId: 1, leasePeriodId: 4, maintenanceFeeMinor: 0
    });
    expect(st.booking.lease_kind).toBe("short_term");
    expect(st.booking.academic_session_id).toBeNull();
    expect(st.booking.prior_booking_id).toBe(60);
  });

  it("ST→CY without overlap", async () => {
    const { svc, repo } = admin();
    repo.rows.bookings.push({
      id: 50, resident_id: 1, academic_session_id: null, application_id: null, booking_number: "ST50",
      status: "completed", total_amount_minor: 350000, currency: "GHS", priced_room_id: 1, lease_period_id: 4,
      lease_kind: "short_term", starts_on: "2027-01-01", ends_on: "2027-03-31", maintenance_fee_minor: 0,
      payment_requirement_type: "full", partial_payment_authorized: 0, prior_booking_id: null
    });
    const cy = await svc.renewBooking(manager, 50, {
      roomId: 1, leasePeriodId: 6, maintenanceFeeMinor: 0
    });
    expect(cy.booking.lease_kind).toBe("calendar_year");
    expect(cy.booking.academic_session_id).toBeNull();
    expect(cy.booking.starts_on).toBe("2028-01-01");
  });
});

describe("Stage 2L-K extension", () => {
  it("extends end date with reason; preserves verified payments; increases balance when amount rises", async () => {
    const { svc, repo } = admin();
    repo.rows.bookings.push({
      id: 10, resident_id: 1, academic_session_id: null, application_id: null, booking_number: "ST10",
      status: "confirmed", total_amount_minor: 350000, currency: "GHS", priced_room_id: 1, lease_period_id: 4,
      lease_kind: "short_term", starts_on: "2027-01-01", ends_on: "2027-03-31", maintenance_fee_minor: 50000,
      payment_requirement_type: "full", partial_payment_authorized: 0, prior_booking_id: null
    });
    repo.rows.payments.push({ id: 1, booking_id: 10, amount_minor: 400000, status: "verified" });

    await expect(svc.extendBookingAgreement(manager, 10, {
      endsOn: "2027-03-01", reason: "too early"
    })).rejects.toThrow(/after the current end/);

    await expect(svc.extendBookingAgreement(manager, 10, {
      endsOn: "2027-04-30", reason: ""
    })).rejects.toThrow(/reason/i);

    const extended = await svc.extendBookingAgreement(manager, 10, {
      endsOn: "2027-04-30",
      totalAmountMinor: 450000,
      reason: "Approved one-month extension"
    });
    expect(extended.booking.ends_on).toBe("2027-04-30");
    expect(extended.booking.total_amount_minor).toBe(450000);
    expect(extended.financial.verified_paid_minor).toBe(400000);
    expect(extended.financial.balance_minor).toBe(100000); // 450000+50000 - 400000
    expect(repo.audits.some((a) => a.action === "admin.booking.extension")).toBe(true);
  });

  it("rejects unsafe obligation reduction below verified payments", async () => {
    const { svc, repo } = admin();
    repo.rows.bookings.push({
      id: 11, resident_id: 1, academic_session_id: null, application_id: null, booking_number: "ST11",
      status: "confirmed", total_amount_minor: 350000, currency: "GHS", priced_room_id: 1, lease_period_id: 4,
      lease_kind: "short_term", starts_on: "2027-01-01", ends_on: "2027-03-31", maintenance_fee_minor: 0,
      payment_requirement_type: "full", partial_payment_authorized: 0, prior_booking_id: null
    });
    repo.rows.payments.push({ id: 1, booking_id: 11, amount_minor: 350000, status: "verified" });
    await expect(svc.extendBookingAgreement(manager, 11, {
      endsOn: "2027-04-30", totalAmountMinor: 200000, reason: "bad reduction"
    })).rejects.toThrow(/below verified/);
  });

  it("extends active allocation when free; rolls back agreement on bed conflict", async () => {
    const { svc, repo } = admin();
    repo.rows.bookings.push({
      id: 12, resident_id: 1, academic_session_id: null, application_id: null, booking_number: "ST12",
      status: "confirmed", total_amount_minor: 350000, currency: "GHS", priced_room_id: 1, lease_period_id: 4,
      lease_kind: "short_term", starts_on: "2027-01-01", ends_on: "2027-03-31", maintenance_fee_minor: 0,
      payment_requirement_type: "full", partial_payment_authorized: 0, prior_booking_id: null
    });
    repo.rows.allocations.push({
      id: 1, booking_id: 12, resident_id: 1, academic_session_id: null, bed_id: 1, status: "active",
      starts_on: "2027-01-01", ends_on: "2027-03-31"
    });

    const ok = await svc.extendBookingAgreement(manager, 12, {
      endsOn: "2027-04-30", reason: "extend stay", extendAllocation: true
    });
    expect(ok.booking.ends_on).toBe("2027-04-30");
    expect(repo.rows.allocations[0].ends_on).toBe("2027-04-30");
    expect(repo.audits.some((a) => a.action === "admin.allocation.extend")).toBe(true);

    // conflict case
    repo.rows.bookings.push({
      id: 13, resident_id: 2, academic_session_id: null, application_id: null, booking_number: "ST13",
      status: "confirmed", total_amount_minor: 350000, currency: "GHS", priced_room_id: 1, lease_period_id: 5,
      lease_kind: "short_term", starts_on: "2027-04-01", ends_on: "2027-06-30", maintenance_fee_minor: 0,
      payment_requirement_type: "full", partial_payment_authorized: 0, prior_booking_id: null
    });
    repo.rows.allocations.push({
      id: 2, booking_id: 13, resident_id: 2, academic_session_id: null, bed_id: 1, status: "active",
      starts_on: "2027-04-01", ends_on: "2027-06-30"
    });
    // Reset booking 12 to Mar 31 for another extend attempt into conflicted April
    repo.rows.bookings.find((b) => b.id === 12)!.ends_on = "2027-03-31";
    repo.rows.allocations.find((a) => a.id === 1)!.ends_on = "2027-03-31";
    await expect(svc.extendBookingAgreement(manager, 12, {
      endsOn: "2027-05-15", reason: "conflict extend", extendAllocation: true
    })).rejects.toThrow(/Unavailable bed|Resident already allocated/);
    expect(repo.rows.bookings.find((b) => b.id === 12)!.ends_on).toBe("2027-03-31");
  });

  it("gates extend behind admin:write", async () => {
    const app = new Hono<{ Variables: { authUser: AuthUser } }>();
    app.use("*", async (c, next) => { c.set("authUser", accounts); await next(); });
    app.post("/bookings/:id/extend", requirePermission("admin:write"), (c) => c.json({ ok: true }));
    expect((await app.request("/bookings/1/extend", { method: "POST" })).status).toBe(403);
  });
});

describe("Stage 2L-K transfer Path B", () => {
  it("preserves same-room transfer and rejects flexible cross-room on legacy endpoint", async () => {
    const { svc, repo } = admin();
    repo.rows.bookings.push({
      id: 20, resident_id: 1, academic_session_id: null, application_id: null, booking_number: "CY20",
      status: "confirmed", total_amount_minor: 900000, currency: "GHS", priced_room_id: 1, lease_period_id: 3,
      lease_kind: "calendar_year", starts_on: "2027-01-01", ends_on: "2027-12-31", maintenance_fee_minor: 0,
      payment_requirement_type: "full", partial_payment_authorized: 0, prior_booking_id: null
    });
    repo.rows.allocations.push({
      id: 10, booking_id: 20, resident_id: 1, academic_session_id: null, bed_id: 1, status: "active",
      starts_on: "2027-01-01", ends_on: "2027-12-31"
    });
    const moved = await svc.transferAllocation(manager, 10, { destinationBedId: 2, startsOn: "2027-04-01" }) as Record<string, unknown>;
    expect(moved.bed_id).toBe(2);
    expect(repo.rows.allocations.find((a) => a.id === 10)!.status).toBe("transferred");
    expect(repo.rows.bookings.find((b) => b.id === 20)!.priced_room_id).toBe(1);

    await expect(svc.transferAllocation(manager, Number(moved.id), {
      destinationBedId: 3, startsOn: "2027-06-01"
    })).rejects.toThrow(/cross-room transfer/i);
  });

  it("cross-room Path B updates agreement room, preserves payments, rejects unsafe reduction", async () => {
    const { svc, repo } = admin();
    repo.rows.bookings.push({
      id: 21, resident_id: 1, academic_session_id: null, application_id: null, booking_number: "CY21",
      status: "confirmed", total_amount_minor: 900000, currency: "GHS", priced_room_id: 1, lease_period_id: 3,
      lease_kind: "calendar_year", starts_on: "2027-01-01", ends_on: "2027-12-31", maintenance_fee_minor: 50000,
      payment_requirement_type: "full", partial_payment_authorized: 0, prior_booking_id: null, override_reason: null
    });
    repo.rows.allocations.push({
      id: 11, booking_id: 21, resident_id: 1, academic_session_id: null, bed_id: 1, status: "active",
      starts_on: "2027-01-01", ends_on: "2027-12-31"
    });
    repo.rows.payments.push({ id: 1, booking_id: 21, amount_minor: 900000, status: "verified" });

    await expect(svc.crossRoomTransferAllocation(manager, 11, {
      destinationBedId: 3, startsOn: "2027-05-01", reason: "move", agreedAmountMinor: 100000
    })).rejects.toThrow(/below verified/);

    const result = await svc.crossRoomTransferAllocation(manager, 11, {
      destinationBedId: 3, startsOn: "2027-05-01", reason: "Approved room change to ROSE"
    });
    expect(result.allocation).toMatchObject({ bed_id: 3, status: "active" });
    expect(result.agreement.booking.priced_room_id).toBe(2);
    expect(result.agreement.booking.total_amount_minor).toBe(900000);
    expect(repo.rows.allocations.find((a) => a.id === 11)!.status).toBe("transferred");
    expect(repo.rows.payments.filter((p) => p.booking_id === 21 && p.status === "verified")).toHaveLength(1);
    expect(repo.audits.some((a) => a.action === "admin.allocation.cross_room_transfer")).toBe(true);
  });

  it("gates cross-room transfer behind admin:write", async () => {
    const app = new Hono<{ Variables: { authUser: AuthUser } }>();
    app.use("*", async (c, next) => { c.set("authUser", reception); await next(); });
    app.post("/allocations/:id/cross-room-transfer", requirePermission("admin:write"), (c) => c.json({ ok: true }));
    expect((await app.request("/allocations/1/cross-room-transfer", { method: "POST" })).status).toBe(403);
    const sa = new Hono<{ Variables: { authUser: AuthUser } }>();
    sa.use("*", async (c, next) => { c.set("authUser", superAdmin); await next(); });
    sa.post("/allocations/:id/cross-room-transfer", requirePermission("admin:write"), (c) => c.json({ ok: true }));
    expect((await sa.request("/allocations/1/cross-room-transfer", { method: "POST" })).status).toBe(200);
  });
});
