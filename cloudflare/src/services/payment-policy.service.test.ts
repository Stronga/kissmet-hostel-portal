import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { AdminService } from "./admin.service";
import { ResidentService } from "./resident.service";
import { requirePermission } from "../middleware/auth.middleware";
import type { AuthUser } from "../auth/context";
import type { Env } from "../types/bindings";

const superAdmin: AuthUser = { id: 9, userType: "staff", displayName: "SA", email: "sa@test", role: "super_admin", staffId: 9, residentId: null, sessionId: 1 };
const manager: AuthUser = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts: AuthUser = { ...manager, id: 2, role: "accounts", staffId: 2 };
const reception: AuthUser = { ...manager, id: 3, role: "reception", staffId: 3 };
const maintenance: AuthUser = { ...manager, id: 4, role: "maintenance", staffId: 4 };
const residentActor: AuthUser = { id: 10, userType: "resident", displayName: "Ama", email: null, role: "resident", staffId: null, residentId: 1, sessionId: 2 };
const otherResidentActor: AuthUser = { ...residentActor, id: 11, residentId: 2, sessionId: 3 };

class PolicyRepo {
  rows: Record<string, Record<string, unknown>[]> = {
    lease_periods: [
      { id: 1, kind: "academic_calendar", code: "AC-26", name: "AC", starts_on: "2026-09-01", ends_on: "2027-06-30", status: "active", academic_session_id: 1 },
      { id: 2, kind: "calendar_year", code: "CY-27", name: "CY", starts_on: "2027-01-01", ends_on: "2027-12-31", status: "active", academic_session_id: null },
      { id: 3, kind: "short_term", code: "ST-Q1", name: "ST", starts_on: "2027-01-01", ends_on: "2027-03-31", status: "active", academic_session_id: null }
    ],
    rate_cards: [
      { id: 1, lease_period_id: 1, occupancy_capacity: 2, rate_code: "AC-2", amount_minor: 600000, currency: "GHS", status: "active", package_months: null },
      { id: 2, lease_period_id: 2, occupancy_capacity: 2, rate_code: "CY-2", amount_minor: 900000, currency: "GHS", status: "active", package_months: null },
      { id: 3, lease_period_id: 3, occupancy_capacity: 2, rate_code: "ST-2", amount_minor: 350000, currency: "GHS", status: "active", package_months: 3 }
    ],
    applications: [
      { id: 1, resident_id: 1, academic_session_id: 1, lease_period_id: 1, lease_kind: "academic_calendar", status: "approved", application_number: "A1" },
      { id: 2, resident_id: 2, academic_session_id: null, lease_period_id: 2, lease_kind: "calendar_year", status: "approved", application_number: "A2" },
      { id: 3, resident_id: 3, academic_session_id: null, lease_period_id: 3, lease_kind: "short_term", status: "approved", application_number: "A3" }
    ],
    rooms: [
      { id: 1, room_code: "R1", capacity: 2, status: "available" },
      { id: 2, room_code: "R2", capacity: 2, status: "available" },
      { id: 3, room_code: "R3", capacity: 2, status: "available" }
    ],
    bookings: [],
    payments: [],
    payment_confirmation_settings: [{ id: 1, requirement_type: "full", fixed_amount_minor: null, percentage_basis_points: null, status: "active" }],
    academic_sessions: [{ id: 1, code: "2026", name: "2026/2027", status: "active" }],
    residents: [
      { id: 1, resident_code: "KSM-RES-0001", resident_kind: "student", institution_id: 1, student_id: "STU1", ghana_card_number: null },
      { id: 2, resident_code: "KSM-RES-0002", resident_kind: "non_student", institution_id: null, student_id: null, ghana_card_number: "GHA-123456789-0" },
      { id: 3, resident_code: "KSM-RES-0003", resident_kind: "student", institution_id: 1, student_id: "STU3", ghana_card_number: null }
    ]
  };
  audits: Array<{ action: string; entityType: string; entityId: number | null; metadata?: Record<string, unknown> }> = [];
  bookingSeq = 1;
  paymentSeq = 1;

  async list(table: string) { return { results: this.rows[table] ?? [] }; }
  async get(table: string, id: number) { return (this.rows[table] ?? []).find((r) => r.id === id) ?? null; }
  async all<T>(sql: string, ...binds: unknown[]) {
    if (sql.includes("FROM bookings b") && sql.includes("outstanding_amount_minor")) {
      const sessionFilter = sql.includes("b.academic_session_id = ?");
      const sessionId = sessionFilter ? binds[0] : null;
      const results = this.rows.bookings
        .filter((b) => ["pending", "confirmed", "completed"].includes(String(b.status)))
        .filter((b) => sessionId == null || b.academic_session_id === sessionId)
        .map((b) => {
          const verified = this.rows.payments.filter((p) => p.booking_id === b.id && p.status === "verified").reduce((s, p) => s + Number(p.amount_minor), 0);
          const obligation = Number(b.total_amount_minor) + Number(b.maintenance_fee_minor ?? 0);
          const resident = this.rows.residents.find((r) => r.id === b.resident_id);
          return {
            id: b.id,
            booking_number: b.booking_number,
            status: b.status,
            total_amount_minor: b.total_amount_minor,
            maintenance_fee_minor: b.maintenance_fee_minor,
            lease_kind: b.lease_kind,
            academic_session_id: b.academic_session_id,
            resident_code: resident?.resident_code,
            verified_amount_minor: verified,
            outstanding_amount_minor: obligation - verified
          };
        });
      return { results: results as T[] };
    }
    return { results: [] as T[] };
  }
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
    if (sql.includes("FROM rooms") || (sql.startsWith("SELECT") && sql.includes("rooms"))) {
      return (this.rows.rooms.find((r) => r.id === binds[0]) ?? null) as T;
    }
    if (sql.includes("verified_paid_minor") || (sql.includes("COALESCE(SUM(amount_minor)") && sql.includes("verified"))) {
      const bookingId = binds[0] as number;
      const sum = this.rows.payments.filter((p) => p.booking_id === bookingId && p.status === "verified").reduce((s, p) => s + Number(p.amount_minor), 0);
      if (sql.includes("verified_count")) return { verified_count: this.rows.payments.filter((p) => p.booking_id === bookingId && p.status === "verified").length } as T;
      if (sql.includes("verified_minor")) return { verified_minor: sum } as T;
      return { verified_paid_minor: sum } as T;
    }
    if (sql.includes("COUNT(*) AS verified_count")) {
      return { verified_count: this.rows.payments.filter((p) => p.booking_id === binds[0] && p.status === "verified").length } as T;
    }
    if (sql.includes("payment_confirmation_settings")) return this.rows.payment_confirmation_settings[0] as T;
    if (sql.includes("FROM bookings WHERE resident_id") && sql.includes("ORDER BY id DESC")) {
      return ([...this.rows.bookings].reverse().find((b) => b.resident_id === binds[0] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
    }
    if (sql.includes("FROM bookings WHERE id = ? AND resident_id")) {
      return (this.rows.bookings.find((b) => b.id === binds[0] && b.resident_id === binds[1] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
    }
    if (sql.includes("Duplicate") || sql.includes("SELECT id FROM bookings WHERE")) {
      if (sql.includes("application_id")) return (this.rows.bookings.find((b) => b.application_id === binds[0] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
      if (sql.includes("lease_period_id")) return (this.rows.bookings.find((b) => b.resident_id === binds[0] && b.lease_period_id === binds[1] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
      if (sql.includes("academic_session_id")) return (this.rows.bookings.find((b) => b.resident_id === binds[0] && b.academic_session_id === binds[1] && ["pending", "confirmed"].includes(String(b.status))) ?? null) as T;
    }
    if (sql.includes("CASE WHEN status")) {
      const rows = this.rows.payments.filter((p) => p.booking_id === binds[0] && p.resident_id === binds[1]);
      return {
        verified_minor: rows.filter((p) => p.status === "verified").reduce((s, p) => s + Number(p.amount_minor), 0),
        submitted_minor: rows.filter((p) => p.status === "submitted").reduce((s, p) => s + Number(p.amount_minor), 0),
        pending_minor: rows.filter((p) => p.status === "pending").reduce((s, p) => s + Number(p.amount_minor), 0),
        refunded_minor: rows.filter((p) => p.status === "refunded").reduce((s, p) => s + Number(p.amount_minor), 0)
      } as T;
    }
    return null;
  }
  async allocateBookingNumber() { return `KSM-BKG-${String(this.bookingSeq++).padStart(4, "0")}`; }
  async allocatePaymentReference() { return `KSM-PAY-${String(this.paymentSeq++).padStart(4, "0")}`; }
  async allocateApplicationNumber() { return "KSM-APP-0001"; }
  async allocateResidentCode() { return "KSM-RES-0099"; }
  async allocateReceiptNumber() { return "KSM-RCP-0001"; }
  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO bookings")) {
      const id = this.rows.bookings.length + 1;
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
        payment_attention_required: 0,
        payment_attention_reason: null
      });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE bookings SET") && sql.includes("partial_payment_authorized") && !sql.includes("total_amount_minor")) {
      const row = this.rows.bookings.find((b) => b.id === binds[4]);
      if (row) {
        Object.assign(row, {
          partial_payment_authorized: binds[0],
          payment_requirement_type: binds[1],
          payment_fixed_amount_minor: binds[2],
          payment_percentage_basis_points: binds[3]
        });
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE bookings SET") && sql.includes("override_reason")) {
      const row = this.rows.bookings.find((b) => b.id === binds[9]);
      if (row) {
        Object.assign(row, {
          total_amount_minor: binds[0],
          maintenance_fee_minor: binds[1],
          starts_on: binds[2],
          ends_on: binds[3],
          payment_requirement_type: binds[4],
          payment_fixed_amount_minor: binds[5],
          payment_percentage_basis_points: binds[6],
          partial_payment_authorized: binds[7],
          override_reason: binds[8]
        });
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE rate_cards")) {
      const row = this.rows.rate_cards.find((r) => r.id === binds[binds.length - 1]);
      if (row && sql.includes("amount_minor")) row.amount_minor = binds[0];
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO payments")) {
      const id = this.rows.payments.length + 1;
      this.rows.payments.push({
        id,
        booking_id: binds[0],
        resident_id: binds[1],
        payment_reference: binds[2],
        status: "pending",
        amount_minor: binds[3],
        currency: binds[4],
        method: binds[5],
        paid_at: binds[6],
        notes: binds[7]
      });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.includes("UPDATE payments") && sql.includes("status = 'verified'")) {
      const row = this.rows.payments.find((p) => p.id === binds[2]);
      const booking = this.rows.bookings.find((b) => b.id === binds[3]);
      const verified = this.rows.payments
        .filter((p) => p.booking_id === binds[5] && p.status === "verified" && p.id !== binds[6])
        .reduce((s, p) => s + Number(p.amount_minor), 0);
      const obligation = booking ? Number(booking.total_amount_minor) + Number(booking.maintenance_fee_minor ?? 0) : 0;
      if (row && booking && obligation >= verified + Number(binds[4])) {
        Object.assign(row, { status: "verified", verified_by_staff_id: binds[0], notes: binds[1] });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("UPDATE payments SET status")) {
      const row = this.rows.payments.find((p) => p.id === binds[3] || p.id === binds[1]);
      if (row) Object.assign(row, { status: binds[0] === "submitted" || binds[0] === "rejected" || binds[0] === "cancelled" ? binds[0] : row.status });
      return { meta: { changes: 1 } };
    }
    return { meta: { last_row_id: 0, changes: 1 } };
  }
  async audit(_a: number | null, _s: number | null, action: string, entityType: string, entityId: number | null, metadata?: Record<string, unknown>) {
    this.audits.push({ action, entityType, entityId, metadata });
  }
}

function admin(repo = new PolicyRepo()) {
  return { svc: new AdminService(repo as never), repo };
}

function residentSvc(repo: PolicyRepo) {
  const env = { DB: {} as D1Database } as Env;
  return new ResidentService(env, { sendOtp: async () => ({ ok: true }) } as never, undefined, repo as never);
}

describe("Stage 2L-J payment policy", () => {
  it("defaults new AC/CY/ST agreements to full payment", async () => {
    const { svc } = admin();
    for (const [applicationId, roomId, leasePeriodId, kind] of [
      [1, 1, 1, "academic_calendar"],
      [2, 2, 2, "calendar_year"],
      [3, 3, 3, "short_term"]
    ] as const) {
      const created = await svc.createBookingFromRateCard(manager, {
        applicationId,
        roomId,
        leasePeriodId,
        maintenanceFeeMinor: 50000
      });
      expect(created.agreement.lease_kind).toBe(kind);
      expect(created.agreement.partial_payment_authorized).toBe(0);
      expect(created.agreement.payment_requirement_type).toBe("full");
      expect(created.financial.total_obligation_minor).toBe(
        Number(created.agreement.agreed_accommodation_amount_minor) + 50000
      );
    }
  });

  it("lets Super Admin and Manager authorize partial payment on one agreement only", async () => {
    const { svc, repo } = admin();
    const a = await svc.createBookingFromRateCard(manager, { applicationId: 1, roomId: 1, leasePeriodId: 1, maintenanceFeeMinor: 50000 });
    const b = await svc.createBookingFromRateCard(manager, { applicationId: 2, roomId: 2, leasePeriodId: 2, maintenanceFeeMinor: 50000 });

    const updated = await svc.setBookingPaymentPolicy(superAdmin, a.booking.id as number, {
      partialPaymentAuthorized: true,
      paymentRequirementType: "fixed",
      paymentFixedAmountMinor: 300000,
      reason: "Resident contacted management"
    });
    expect(updated.agreement.partial_payment_authorized).toBe(1);
    expect(updated.agreement.payment_requirement_type).toBe("fixed");
    expect(updated.agreement.payment_fixed_amount_minor).toBe(300000);
    expect(updated.agreement.agreed_accommodation_amount_minor).toBe(600000);

    expect((await svc.getBookingAgreement(b.booking.id as number)).agreement.partial_payment_authorized).toBe(0);

    await expect(svc.setBookingPaymentPolicy(manager, a.booking.id as number, {
      partialPaymentAuthorized: true,
      paymentRequirementType: "percentage",
      paymentPercentageBasisPoints: 5000,
      reason: "Revised arrangement"
    })).resolves.toMatchObject({ agreement: { payment_requirement_type: "percentage", payment_percentage_basis_points: 5000 } });

    expect(repo.audits.some((x) => x.action === "admin.booking.payment_policy_change")).toBe(true);
    expect(JSON.stringify(repo.audits)).not.toMatch(/GHA-|OTP|token|slip/i);
  });

  it("rejects Accounts, Reception, and Maintenance from payment-policy routes", async () => {
    for (const actor of [accounts, reception, maintenance]) {
      const app = new Hono<{ Variables: { authUser: AuthUser } }>();
      app.use("*", async (c, next) => { c.set("authUser", actor); await next(); });
      app.patch("/bookings/:id/payment-policy", requirePermission("admin:write"), (c) => c.json({ ok: true }));
      expect((await app.request("/bookings/1/payment-policy", { method: "PATCH" })).status).toBe(403);
    }
    const allowed = new Hono<{ Variables: { authUser: AuthUser } }>();
    allowed.use("*", async (c, next) => { c.set("authUser", manager); await next(); });
    allowed.patch("/bookings/:id/payment-policy", requirePermission("admin:write"), (c) => c.json({ ok: true }));
    expect((await allowed.request("/bookings/1/payment-policy", { method: "PATCH" })).status).toBe(200);
  });

  it("does not change price snapshot when policy changes or rate card mutates", async () => {
    const { svc, repo } = admin();
    const created = await svc.createBookingFromRateCard(manager, {
      applicationId: 1,
      roomId: 1,
      leasePeriodId: 1,
      agreedAmountMinor: 550000,
      overrideReason: "Negotiated deal",
      maintenanceFeeMinor: 50000
    });
    expect(created.agreement.agreed_accommodation_amount_minor).toBe(550000);

    await svc.setBookingPaymentPolicy(manager, 1, {
      partialPaymentAuthorized: true,
      paymentRequirementType: "fixed",
      paymentFixedAmountMinor: 250000,
      reason: "Installment approved"
    });
    const afterPolicy = await svc.getBookingAgreement(1);
    expect(afterPolicy.agreement.agreed_accommodation_amount_minor).toBe(550000);
    expect(afterPolicy.agreement.maintenance_fee_minor).toBe(50000);
    expect(afterPolicy.financial.total_obligation_minor).toBe(600000);

    repo.rows.rate_cards[0].amount_minor = 999999;
    const again = await svc.getBookingAgreement(1);
    expect(again.agreement.agreed_accommodation_amount_minor).toBe(550000);
    expect(again.financial.total_obligation_minor).toBe(600000);
  });

  it("keeps payment_attention distinct from partial authorization", async () => {
    const { svc, repo } = admin();
    await svc.createBookingFromRateCard(manager, { applicationId: 1, roomId: 1, leasePeriodId: 1, maintenanceFeeMinor: 0 });
    repo.rows.bookings[0].payment_attention_required = 1;
    repo.rows.bookings[0].payment_attention_reason = "Refund review";
    await svc.setBookingPaymentPolicy(manager, 1, {
      partialPaymentAuthorized: true,
      paymentRequirementType: "fixed",
      paymentFixedAmountMinor: 100000,
      reason: "Partial ok"
    });
    const booking = repo.rows.bookings[0];
    expect(booking.partial_payment_authorized).toBe(1);
    expect(booking.payment_attention_required).toBe(1);
    expect(booking.payment_attention_reason).toBe("Refund review");
  });

  it("counts verified payments only and supports multi-payment balances with maintenance", async () => {
    const { svc, repo } = admin();
    await svc.createBookingFromRateCard(manager, { applicationId: 1, roomId: 1, leasePeriodId: 1, maintenanceFeeMinor: 50000 });
    await svc.setBookingPaymentPolicy(manager, 1, {
      partialPaymentAuthorized: true,
      paymentRequirementType: "fixed",
      paymentFixedAmountMinor: 300000,
      reason: "Partial"
    });

    repo.rows.payments.push(
      { id: 1, booking_id: 1, resident_id: 1, status: "pending", amount_minor: 100000 },
      { id: 2, booking_id: 1, resident_id: 1, status: "rejected", amount_minor: 50000 },
      { id: 3, booking_id: 1, resident_id: 1, status: "verified", amount_minor: 300000 }
    );
    const financial = (await svc.getBookingAgreement(1)).financial;
    expect(financial.verified_paid_minor).toBe(300000);
    expect(financial.total_obligation_minor).toBe(650000);
    expect(financial.balance_minor).toBe(350000);

    repo.rows.payments.push({ id: 4, booking_id: 1, resident_id: 1, status: "verified", amount_minor: 350000 });
    const paid = (await svc.getBookingAgreement(1)).financial;
    expect(paid.verified_paid_minor).toBe(650000);
    expect(paid.balance_minor).toBe(0);

    const summary = await svc.bookingPaymentSummary(1);
    expect(summary.agreementObligationMinor).toBe(650000);
    expect(summary.balanceMinor).toBe(0);
    expect(summary.partialPaymentAuthorized).toBe(true);
  });

  it("rejects overpayment against obligation", async () => {
    const { svc, repo } = admin();
    await svc.createBookingFromRateCard(manager, { applicationId: 1, roomId: 1, leasePeriodId: 1, maintenanceFeeMinor: 50000 });
    await expect(svc.createPayment(manager, {
      bookingId: 1,
      residentId: 1,
      amountMinor: 700000,
      method: "cash"
    })).rejects.toThrow(/exceed/);

    const payment = await svc.createPayment(manager, { bookingId: 1, residentId: 1, amountMinor: 650000, method: "cash" }) as Record<string, unknown>;
    repo.rows.payments[0].status = "submitted";
    await expect(svc.verifyPayment(manager, Number(payment.id))).resolves.toMatchObject({
      summary: { balanceMinor: 0, agreementObligationMinor: 650000 }
    });
  });

  it("allows policy enable/revoke after verified payments without changing price", async () => {
    const { svc, repo } = admin();
    await svc.createBookingFromRateCard(manager, { applicationId: 1, roomId: 1, leasePeriodId: 1, maintenanceFeeMinor: 50000 });
    repo.rows.payments.push({ id: 1, booking_id: 1, resident_id: 1, status: "verified", amount_minor: 200000 });

    await expect(svc.overrideBookingAgreementTerms(manager, 1, {
      totalAmountMinor: 500000,
      overrideReason: "try price change"
    })).rejects.toThrow(/financially locked/);

    await svc.setBookingPaymentPolicy(manager, 1, {
      partialPaymentAuthorized: true,
      paymentRequirementType: "fixed",
      paymentFixedAmountMinor: 200000,
      reason: "Enable after deposit"
    });
    expect((await svc.getBookingAgreement(1)).agreement.agreed_accommodation_amount_minor).toBe(600000);

    await svc.setBookingPaymentPolicy(manager, 1, {
      partialPaymentAuthorized: false,
      reason: "Revert to full remaining"
    });
    const after = await svc.getBookingAgreement(1);
    expect(after.agreement.partial_payment_authorized).toBe(0);
    expect(after.agreement.payment_requirement_type).toBe("full");
    expect(after.financial.verified_paid_minor).toBe(200000);
    expect(after.financial.balance_minor).toBe(450000);
  });

  it("enforces full vs partial amount rules for resident submissions", async () => {
    const { svc, repo } = admin();
    await svc.createBookingFromRateCard(manager, { applicationId: 1, roomId: 1, leasePeriodId: 1, maintenanceFeeMinor: 50000 });
    const resident = residentSvc(repo);

    await expect(resident.createPayment(residentActor, {
      bookingId: 1,
      amountMinor: 300000,
      currency: "GHS",
      method: "mobile_money"
    })).rejects.toThrow(/Full payment is required/);

    await expect(resident.createPayment(residentActor, {
      bookingId: 1,
      amountMinor: 650000,
      currency: "GHS",
      method: "mobile_money"
    })).resolves.toMatchObject({ amount_minor: 650000 });

    // Second agreement path for Other resident + CY with partial
    await svc.createBookingFromRateCard(manager, { applicationId: 2, roomId: 2, leasePeriodId: 2, maintenanceFeeMinor: 50000 });
    await svc.setBookingPaymentPolicy(manager, 2, {
      partialPaymentAuthorized: true,
      paymentRequirementType: "fixed",
      paymentFixedAmountMinor: 400000,
      reason: "Other resident arrangement"
    });
    const other = residentSvc(repo);
    await expect(other.createPayment(otherResidentActor, {
      bookingId: 2,
      amountMinor: 100000,
      currency: "GHS",
      method: "cash"
    })).rejects.toThrow(/below the approved partial-payment arrangement minimum/);

    await expect(other.createPayment(otherResidentActor, {
      bookingId: 2,
      amountMinor: 400000,
      currency: "GHS",
      method: "cash"
    })).resolves.toMatchObject({ amount_minor: 400000 });

    const summary = await other.paymentSummary(otherResidentActor);
    expect(summary).toMatchObject({
      partialPaymentAuthorized: true,
      paymentRequirementType: "fixed",
      paymentFixedAmountMinor: 400000,
      agreementObligationMinor: 950000,
      maintenanceFeeMinor: 50000
    });
  });

  it("includes null-session CY/ST in general outstanding and scopes session reports to AC", async () => {
    const { svc, repo } = admin();
    await svc.createBookingFromRateCard(manager, { applicationId: 1, roomId: 1, leasePeriodId: 1, maintenanceFeeMinor: 10000 });
    await svc.createBookingFromRateCard(manager, { applicationId: 2, roomId: 2, leasePeriodId: 2, maintenanceFeeMinor: 20000 });
    await svc.createBookingFromRateCard(manager, { applicationId: 3, roomId: 3, leasePeriodId: 3, maintenanceFeeMinor: 30000 });

    const general = await svc.reportOutstanding({});
    expect(general.balances).toHaveLength(3);
    expect(general.balances.some((b) => b.lease_kind === "calendar_year" && b.academic_session_id == null)).toBe(true);
    expect(general.balances.some((b) => b.lease_kind === "short_term" && b.academic_session_id == null)).toBe(true);
    expect(general.totalOutstandingMinor).toBe(600000 + 10000 + 900000 + 20000 + 350000 + 30000);

    const sessionScoped = await svc.reportOutstanding({ academicSessionId: 1 });
    expect(sessionScoped.balances).toHaveLength(1);
    expect(sessionScoped.balances[0].lease_kind).toBe("academic_calendar");
    // document: session filter intentionally excludes null-session CY/ST
  });
});
