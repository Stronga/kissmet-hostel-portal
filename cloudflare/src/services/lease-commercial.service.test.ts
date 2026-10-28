import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { AdminService } from "./admin.service";
import { requirePermission } from "../middleware/auth.middleware";
import type { AuthUser } from "../auth/context";

const manager: AuthUser = {
  id: 1,
  userType: "staff",
  displayName: "Manager",
  email: "m@test",
  role: "manager",
  staffId: 1,
  residentId: null,
  sessionId: 1
};
const superAdmin: AuthUser = { ...manager, role: "super_admin" };
const reception: AuthUser = { ...manager, role: "reception", id: 3, staffId: 3 };

class LeaseCommercialRepo {
  rows: Record<string, Record<string, unknown>[]> = {
    academic_sessions: [{ id: 1, code: "2026-2027", name: "2026/27", status: "active" }],
    lease_periods: [],
    rate_cards: [],
    rooms: [{ id: 1, room_code: "R1", capacity: 2, status: "available" }],
    applications: [{ id: 1, resident_id: 1, academic_session_id: 1, status: "approved", application_number: "KSM-APP-0001" }],
    bookings: [],
    payments: [],
    audits: []
  };
  audits: Array<{ action: string; entityType: string; entityId: number | null; metadata?: Record<string, unknown> }> = [];
  bookingSeq = 1;

  async list(table: string) {
    return { results: this.rows[table] ?? [] };
  }
  async get(table: string, id: number) {
    return (this.rows[table] ?? []).find((r) => r.id === id) ?? null;
  }
  async allocateBookingNumber() {
    return `KSM-BKG-${String(this.bookingSeq++).padStart(4, "0")}`;
  }
  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
    if (sql.startsWith("SELECT * FROM applications")) {
      return this.get("applications", binds[0] as number) as T;
    }
    if (sql.startsWith("SELECT id FROM bookings")) {
      return (this.rows.bookings.find(
        (b) =>
          b.resident_id === binds[0] &&
          b.academic_session_id === binds[1] &&
          ["pending", "confirmed"].includes(String(b.status))
      ) ?? null) as T;
    }
    if (sql.includes("FROM rate_cards") && sql.includes("status = 'active'")) {
      const leasePeriodId = binds[0];
      const occupancy = binds[1];
      const asOf = binds[2] as string | null;
      const card = this.rows.rate_cards.find((r) => {
        if (r.lease_period_id !== leasePeriodId || r.occupancy_capacity !== occupancy || r.status !== "active") {
          return false;
        }
        if (asOf && r.effective_from && String(r.effective_from) > asOf) return false;
        if (asOf && r.effective_to && String(r.effective_to) < asOf) return false;
        return true;
      });
      return (card ?? null) as T;
    }
    if (sql.includes("COUNT(*) AS verified_count")) {
      return {
        verified_count: this.rows.payments.filter((p) => p.booking_id === binds[0] && p.status === "verified").length
      } as T;
    }
    return null;
  }
  async all<T>() {
    return { results: [] as T[] };
  }
  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO lease_periods")) {
      if (this.rows.lease_periods.some((p) => p.code === binds[1])) {
        throw new Error("UNIQUE constraint failed: lease_periods.code");
      }
      if (binds[6] != null && this.rows.lease_periods.some((p) => p.academic_session_id === binds[6])) {
        throw new Error("UNIQUE constraint failed: idx_lease_periods_one_per_academic_session");
      }
      if (binds[6] != null && binds[0] !== "academic_calendar") {
        throw new Error("CHECK constraint failed: academic_session_id");
      }
      if (String(binds[3]) > String(binds[4])) {
        throw new Error("CHECK constraint failed: starts_on <= ends_on");
      }
      const id = this.rows.lease_periods.length + 1;
      this.rows.lease_periods.push({
        id,
        kind: binds[0],
        code: binds[1],
        name: binds[2],
        starts_on: binds[3],
        ends_on: binds[4],
        status: binds[5],
        academic_session_id: binds[6],
        notes: binds[7],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null
      });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE lease_periods SET name")) {
      const row = this.rows.lease_periods.find((p) => p.id === binds[5]);
      if (!row) return { meta: { changes: 0 } };
      if (binds[3] != null && this.rows.lease_periods.some((p) => p.id !== binds[5] && p.academic_session_id === binds[3])) {
        throw new Error("UNIQUE constraint failed: academic_session");
      }
      Object.assign(row, {
        name: binds[0],
        starts_on: binds[1],
        ends_on: binds[2],
        academic_session_id: binds[3],
        notes: binds[4]
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE lease_periods SET status")) {
      const row = this.rows.lease_periods.find((p) => p.id === binds[1]);
      if (row) {
        row.status = binds[0];
        if (binds[0] === "archived") row.archived_at = "2026-01-02T00:00:00.000Z";
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO rate_cards")) {
      if (![1, 2, 4].includes(Number(binds[1]))) throw new Error("CHECK occupancy");
      if (Number(binds[3]) <= 0) throw new Error("CHECK amount");
      if (this.rows.rate_cards.some((r) => r.rate_code === binds[2])) {
        throw new Error("UNIQUE constraint failed: rate_cards.rate_code");
      }
      if (
        binds[6] === "active" &&
        this.rows.rate_cards.some(
          (r) => r.lease_period_id === binds[0] && r.occupancy_capacity === binds[1] && r.status === "active"
        )
      ) {
        throw new Error("UNIQUE constraint failed: idx_rate_cards_one_active_per_period_occupancy");
      }
      const id = this.rows.rate_cards.length + 1;
      this.rows.rate_cards.push({
        id,
        lease_period_id: binds[0],
        occupancy_capacity: binds[1],
        rate_code: binds[2],
        amount_minor: binds[3],
        currency: binds[4],
        package_months: binds[5],
        status: binds[6],
        effective_from: binds[7],
        effective_to: binds[8],
        notes: binds[9],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null
      });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE rate_cards") && sql.includes("amount_minor")) {
      const row = this.rows.rate_cards.find((r) => r.id === binds[5]);
      if (row) {
        Object.assign(row, {
          amount_minor: binds[0],
          package_months: binds[1],
          effective_from: binds[2],
          effective_to: binds[3],
          notes: binds[4]
        });
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE rate_cards SET status")) {
      const row = this.rows.rate_cards.find((r) => r.id === binds[1]);
      if (
        row &&
        binds[0] === "active" &&
        this.rows.rate_cards.some(
          (r) =>
            r.id !== row.id &&
            r.lease_period_id === row.lease_period_id &&
            r.occupancy_capacity === row.occupancy_capacity &&
            r.status === "active"
        )
      ) {
        throw new Error("UNIQUE constraint failed: active");
      }
      if (row) {
        row.status = binds[0];
        if (binds[0] === "archived") row.archived_at = "2026-01-02T00:00:00.000Z";
      }
      return { meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO bookings") && sql.includes("lease_period_id")) {
      if (this.rows.bookings.some((b) => b.booking_number === binds[3])) {
        throw new Error("UNIQUE constraint failed: bookings.booking_number");
      }
      if (
        this.rows.bookings.some(
          (b) =>
            b.resident_id === binds[0] &&
            b.academic_session_id === binds[1] &&
            ["pending", "confirmed"].includes(String(b.status))
        )
      ) {
        throw new Error("UNIQUE constraint failed");
      }
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
        override_reason: null
      });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE bookings SET") && sql.includes("override_reason")) {
      const row = this.rows.bookings.find((b) => b.id === binds[8]);
      if (row) {
        Object.assign(row, {
          total_amount_minor: binds[0],
          maintenance_fee_minor: binds[1],
          starts_on: binds[2],
          ends_on: binds[3],
          payment_requirement_type: binds[4],
          payment_fixed_amount_minor: binds[5],
          payment_percentage_basis_points: binds[6],
          override_reason: binds[7]
        });
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE bookings SET status")) {
      const row = this.rows.bookings.find((b) => b.id === binds[3]);
      if (row) row.status = binds[0];
      return { meta: { changes: 1 } };
    }
    return { meta: { last_row_id: 0, changes: 1 } };
  }
  async audit(
    _actorUserId: number | null,
    _actorStaffId: number | null,
    action: string,
    entityType: string,
    entityId: number | null,
    metadata?: Record<string, unknown>
  ) {
    this.audits.push({ action, entityType, entityId, metadata });
  }
}

function service(repo = new LeaseCommercialRepo()) {
  return { service: new AdminService(repo as never), repo };
}

describe("Stage 2L-C lease periods API/service", () => {
  it("allows Super Admin and Manager to create lease periods", async () => {
    for (const actor of [superAdmin, manager]) {
      const { service: svc, repo } = service();
      const row = await svc.createLeasePeriod(actor, {
        kind: "calendar_year",
        code: `CY-${actor.role}`,
        name: "Calendar 2027",
        startsOn: "2027-01-01",
        endsOn: "2027-12-31"
      });
      expect(row).toMatchObject({ kind: "calendar_year", status: "draft" });
      expect(repo.audits.some((a) => a.action === "admin.lease_period.create")).toBe(true);
    }
  });

  it("rejects invalid kind and invalid date ranges", async () => {
    const { service: svc } = service();
    await expect(
      svc.createLeasePeriod(manager, {
        kind: "semester",
        code: "BAD",
        name: "Bad",
        startsOn: "2027-01-01",
        endsOn: "2027-12-31"
      })
    ).rejects.toThrow(/Invalid lease kind/);
    await expect(
      svc.createLeasePeriod(manager, {
        kind: "short_term",
        code: "ST-BAD",
        name: "Bad dates",
        startsOn: "2027-06-01",
        endsOn: "2027-01-01"
      })
    ).rejects.toThrow(/starts_on must be <= ends_on/);
  });

  it("allows CY/ST without academic session and rejects inappropriate session links", async () => {
    const { service: svc, repo } = service();
    const cy = await svc.createLeasePeriod(manager, {
      kind: "calendar_year",
      code: "CY-2027",
      name: "CY",
      startsOn: "2027-01-01",
      endsOn: "2027-12-31"
    });
    expect((cy as Record<string, unknown>).academic_session_id).toBeNull();

    await expect(
      svc.createLeasePeriod(manager, {
        kind: "short_term",
        code: "ST-BAD-LINK",
        name: "ST",
        startsOn: "2027-01-01",
        endsOn: "2027-03-31",
        academicSessionId: 1
      })
    ).rejects.toThrow(/only academic_calendar/);

    const ac = await svc.createLeasePeriod(manager, {
      kind: "academic_calendar",
      code: "AC-2026",
      name: "AC",
      startsOn: "2026-09-01",
      endsOn: "2027-06-30",
      academicSessionId: 1
    });
    expect((ac as Record<string, unknown>).academic_session_id).toBe(1);
    expect(repo.rows.lease_periods).toHaveLength(2);
  });

  it("enforces unique codes and status lifecycle with audit", async () => {
    const { service: svc, repo } = service();
    await svc.createLeasePeriod(manager, {
      kind: "short_term",
      code: "ST-1",
      name: "ST",
      startsOn: "2027-01-01",
      endsOn: "2027-03-31"
    });
    await expect(
      svc.createLeasePeriod(manager, {
        kind: "short_term",
        code: "ST-1",
        name: "Dup",
        startsOn: "2027-04-01",
        endsOn: "2027-06-30"
      })
    ).rejects.toThrow(/already exists/);

    await svc.updateLeasePeriodStatus(manager, 1, "active");
    expect(repo.audits.some((a) => a.action === "admin.lease_period.status_change")).toBe(true);
    expect((await svc.get("lease_periods", 1) as Record<string, unknown>).status).toBe("active");
  });

  it("blocks reception write via permission middleware", async () => {
    const app = new Hono();
    app.post("/lease-periods", requirePermission("admin:write"), (c) => c.json({ ok: true }));
    const res = await app.request("/lease-periods", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }, { Variables: {} } as never);
    // without auth user middleware sets nothing — simulate by setting role on a mini app
    const gated = new Hono<{ Variables: { authUser: AuthUser } }>();
    gated.use("*", async (c, next) => {
      c.set("authUser", reception);
      await next();
    });
    gated.post("/lease-periods", requirePermission("admin:write"), (c) => c.json({ ok: true }));
    const denied = await gated.request("/lease-periods", { method: "POST" });
    expect(denied.status).toBe(403);
  });
});

describe("Stage 2L-C rate cards API/service", () => {
  async function seedPeriod(repo = new LeaseCommercialRepo()) {
    const svc = new AdminService(repo as never);
    await svc.createLeasePeriod(manager, {
      kind: "academic_calendar",
      code: "AC-R",
      name: "AC",
      startsOn: "2026-09-01",
      endsOn: "2027-06-30"
    });
    return { svc, repo };
  }

  it("creates 1/2/4 person cards and rejects invalid occupancy/amount", async () => {
    const { svc, repo } = await seedPeriod();
    for (const [occ, amount, code] of [
      [1, 900000, "RC-1"],
      [2, 600000, "RC-2"],
      [4, 450000, "RC-4"]
    ] as const) {
      const card = await svc.createRateCard(manager, {
        leasePeriodId: 1,
        occupancyCapacity: occ,
        rateCode: code,
        amountMinor: amount,
        status: "active"
      });
      expect(card).toMatchObject({ occupancy_capacity: occ, amount_minor: amount, status: "active" });
    }
    expect(repo.audits.filter((a) => a.action === "admin.rate_card.create")).toHaveLength(3);

    await expect(
      svc.createRateCard(manager, {
        leasePeriodId: 1,
        occupancyCapacity: 3,
        rateCode: "RC-3",
        amountMinor: 100
      })
    ).rejects.toThrow(/occupancy capacity/);
    await expect(
      svc.createRateCard(manager, {
        leasePeriodId: 1,
        occupancyCapacity: 1,
        rateCode: "RC-BAD",
        amountMinor: 0
      })
    ).rejects.toThrow(/amount_minor/);
  });

  it("does not resolve inactive/archived cards and rejects duplicate active", async () => {
    const { svc, repo } = await seedPeriod();
    await svc.createRateCard(manager, {
      leasePeriodId: 1,
      occupancyCapacity: 2,
      rateCode: "RC-A",
      amountMinor: 600000,
      status: "active"
    });
    await expect(
      svc.createRateCard(manager, {
        leasePeriodId: 1,
        occupancyCapacity: 2,
        rateCode: "RC-B",
        amountMinor: 610000,
        status: "active"
      })
    ).rejects.toThrow(/already exists/);

    await svc.updateRateCardStatus(manager, 1, "inactive");
    await expect(svc.resolveActiveRateCard(1, 2)).rejects.toThrow(/Active rate card not found/);

    await svc.createRateCard(manager, {
      leasePeriodId: 1,
      occupancyCapacity: 2,
      rateCode: "RC-C",
      amountMinor: 620000,
      status: "active"
    });
    const resolved = await svc.resolveActiveRateCard(1, 2);
    expect(resolved.amount_minor).toBe(620000);
    expect(repo.audits.some((a) => a.action === "admin.rate_card.status_change")).toBe(true);
  });

  it("resolves the correct period/capacity card", async () => {
    const { svc } = await seedPeriod();
    await svc.createLeasePeriod(manager, {
      kind: "short_term",
      code: "ST-R",
      name: "ST",
      startsOn: "2027-01-01",
      endsOn: "2027-03-31"
    });
    await svc.createRateCard(manager, {
      leasePeriodId: 1,
      occupancyCapacity: 2,
      rateCode: "AC-2",
      amountMinor: 600000,
      status: "active"
    });
    await svc.createRateCard(manager, {
      leasePeriodId: 2,
      occupancyCapacity: 2,
      rateCode: "ST-2",
      amountMinor: 350000,
      status: "active",
      packageMonths: 3
    });
    expect((await svc.resolveActiveRateCard(1, 2)).amount_minor).toBe(600000);
    expect((await svc.resolveActiveRateCard(2, 2)).amount_minor).toBe(350000);
    await expect(svc.resolveActiveRateCard(1, 4)).rejects.toThrow(/not found/);
  });
});

describe("Stage 2L-C booking agreement snapshot + overrides", () => {
  async function seedFlexible() {
    const repo = new LeaseCommercialRepo();
    const svc = new AdminService(repo as never);
    await svc.createLeasePeriod(manager, {
      kind: "academic_calendar",
      code: "AC-B",
      name: "AC",
      startsOn: "2026-09-01",
      endsOn: "2027-06-30",
      status: "active"
    });
    await svc.createRateCard(manager, {
      leasePeriodId: 1,
      occupancyCapacity: 2,
      rateCode: "AC-2P",
      amountMinor: 600000,
      status: "active"
    });
    return { svc, repo };
  }

  it("prices from rate card, snapshots agreement fields, and keeps maintenance separate", async () => {
    const { svc, repo } = await seedFlexible();
    const created = await svc.createBookingFromRateCard(manager, {
      applicationId: 1,
      roomId: 1,
      leasePeriodId: 1,
      maintenanceFeeMinor: 15000
    });
    expect(created.agreement.pricing_path).toBe("lease_rate_card");
    expect(created.agreement.agreed_accommodation_amount_minor).toBe(600000);
    expect(created.agreement.maintenance_fee_minor).toBe(15000);
    expect(created.agreement.lease_period_id).toBe(1);
    expect(created.agreement.lease_kind).toBe("academic_calendar");
    expect(created.agreement.starts_on).toBe("2026-09-01");
    expect(created.agreement.ends_on).toBe("2027-06-30");
    expect(created.booking.total_amount_minor).toBe(600000);
    expect(created.booking.priced_room_rate_id).toBeNull();
    expect(repo.audits.some((a) => a.action === "admin.booking.create" && a.metadata?.pricingPath === "lease_rate_card")).toBe(true);

    // Later rate-card update must NOT alter booking amount
    await svc.updateRateCard(manager, 1, { amountMinor: 999999 });
    const again = await svc.getBookingAgreement(1);
    expect(again.agreement.agreed_accommodation_amount_minor).toBe(600000);
    expect((await svc.get("rate_cards", 1) as Record<string, unknown>).amount_minor).toBe(999999);
  });

  it("allows management override before lock with reason and audit", async () => {
    const { svc, repo } = await seedFlexible();
    await svc.createBookingFromRateCard(manager, {
      applicationId: 1,
      roomId: 1,
      leasePeriodId: 1,
      maintenanceFeeMinor: 10000
    });
    const overridden = await svc.overrideBookingAgreementTerms(manager, 1, {
      totalAmountMinor: 550000,
      maintenanceFeeMinor: 5000,
      overrideReason: "Manager discretionary discount"
    });
    expect(overridden.agreement.agreed_accommodation_amount_minor).toBe(550000);
    expect(overridden.agreement.maintenance_fee_minor).toBe(5000);
    expect(overridden.agreement.override_reason).toBe("Manager discretionary discount");
    expect(repo.audits.some((a) => a.action === "admin.booking.terms_override")).toBe(true);

    await expect(
      svc.overrideBookingAgreementTerms(manager, 1, {
        totalAmountMinor: 500000,
        overrideReason: "   "
      })
    ).rejects.toThrow(/Override reason is required/);
  });

  it("blocks override after verified payment and after confirmed status", async () => {
    const { svc, repo } = await seedFlexible();
    await svc.createBookingFromRateCard(manager, {
      applicationId: 1,
      roomId: 1,
      leasePeriodId: 1
    });
    repo.rows.payments.push({ id: 1, booking_id: 1, status: "verified", amount_minor: 1000 });
    await expect(
      svc.overrideBookingAgreementTerms(manager, 1, {
        totalAmountMinor: 100,
        overrideReason: "too late"
      })
    ).rejects.toThrow(/financially locked/);

    repo.rows.payments = [];
    repo.rows.bookings[0].status = "confirmed";
    await expect(
      svc.overrideBookingAgreementTerms(manager, 1, {
        totalAmountMinor: 100,
        overrideReason: "too late"
      })
    ).rejects.toThrow(/locked after confirmation/);
  });

  it("blocks reception from agreement override via admin:write", async () => {
    const gated = new Hono<{ Variables: { authUser: AuthUser } }>();
    gated.use("*", async (c, next) => {
      c.set("authUser", reception);
      await next();
    });
    gated.patch("/bookings/:id/agreement", requirePermission("admin:write"), (c) => c.json({ ok: true }));
    const denied = await gated.request("/bookings/1/agreement", { method: "PATCH" });
    expect(denied.status).toBe(403);

    const allowed = new Hono<{ Variables: { authUser: AuthUser } }>();
    allowed.use("*", async (c, next) => {
      c.set("authUser", manager);
      await next();
    });
    allowed.patch("/bookings/:id/agreement", requirePermission("admin:write"), (c) => c.json({ ok: true }));
    expect((await allowed.request("/bookings/1/agreement", { method: "PATCH" })).status).toBe(200);
  });
});
