/**
 * Stage 2L-L — Final backend completion audit.
 * Real migration chain 0001→0019 + real-schema E2E (A–E) + RBAC/privacy/integrity gates.
 * LOCAL/TEST ONLY. No production D1, SMS, email, payment, or MikroTik.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import { Hono } from "hono";
import {
  all,
  createSqlJsD1,
  get,
  listMigrationFiles,
  openMigratedDatabase,
  run,
} from "./apply-migrations";
import { AdminRepository } from "../src/repositories/admin.repository";
import { AdminService } from "../src/services/admin.service";
import { ResidentService } from "../src/services/resident.service";
import { MockSmsProvider } from "../src/services/sms.service";
import { requirePermission, requireRole, requireStaff } from "../src/middleware/auth.middleware";
import { hasPermission, type RoleCode } from "../src/auth/permissions";
import type { AuthUser } from "../src/auth/context";
import type { Env } from "../src/types/bindings";
import { presentResidentRow } from "../src/types/resident-kind";
import { computeAgreementFinancial } from "../src/services/agreement-financial";

const EXPECTED_MIGRATIONS = [
  "0001_canonical_schema.sql",
  "0002_auth_username.sql",
  "0003_resident_code_sequence.sql",
  "0004_booking_number_sequence.sql",
  "0005_payments_receipts_foundation.sql",
  "0006_resident_onboarding.sql",
  "0007_operations_reporting.sql",
  "0008_booking_priced_room.sql",
  "0009_announcements_alerts.sql",
  "0010_messages_communications.sql",
  "0011_system_settings.sql",
  "0012_resident_internet_accounts.sql",
  "0013_lease_periods_and_kinds.sql",
  "0014_rate_cards.sql",
  "0015_booking_agreement_terms.sql",
  "0016_resident_kind_and_application_flexibility.sql",
  "0017_ghana_card_number_and_identity_realignment.sql",
  "0018_session_optional_booking_agreements.sql",
  "0019_agreement_aware_allocations.sql",
  // Pre-Pi commissioning: additive connector heartbeat table (local only until approved).
  "0020_connector_heartbeats.sql",
];

const BOOKING_REQUIRED_COLS = [
  "id", "resident_id", "academic_session_id", "application_id", "booking_number", "status",
  "total_amount_minor", "currency", "priced_room_id", "priced_room_rate_id",
  "payment_attention_required", "payment_attention_reason",
  "lease_period_id", "lease_kind", "starts_on", "ends_on", "maintenance_fee_minor",
  "payment_requirement_type", "payment_fixed_amount_minor", "payment_percentage_basis_points",
  "partial_payment_authorized", "prior_booking_id", "override_reason",
];

const ALLOCATION_REQUIRED_COLS = [
  "id", "booking_id", "resident_id", "academic_session_id", "bed_id", "status",
  "starts_on", "ends_on", "assigned_by_staff_id", "assigned_at", "released_at", "notes",
];

function staffUser(role: RoleCode, id = 1): AuthUser {
  return {
    id,
    userType: "staff",
    displayName: role,
    email: `${role}@example.com`,
    role,
    staffId: id,
    residentId: null,
    sessionId: id,
  };
}

function residentUser(residentId: number, userId = 100 + residentId): AuthUser {
  return {
    id: userId,
    userType: "resident",
    displayName: `Resident ${residentId}`,
    email: `r${residentId}@example.com`,
    role: "resident",
    staffId: null,
    residentId,
    sessionId: userId,
  };
}


async function approveApplication(admin: AdminService, actor: AuthUser, applicationId: number) {
  await admin.updateApplicationStatus(actor, applicationId, "submitted");
  await admin.updateApplicationStatus(actor, applicationId, "under_review");
  await admin.updateApplicationStatus(actor, applicationId, "approved");
}

async function createApprovedApp(
  admin: AdminService,
  actor: AuthUser,
  opts: { residentId: number; leasePeriodId?: number | null; academicSessionId?: number | null }
) {
  const app = await admin.createApplication(actor, {
    residentId: opts.residentId,
    leasePeriodId: opts.leasePeriodId ?? null,
    academicSessionId: opts.academicSessionId ?? null,
  }) as Record<string, unknown>;
  await approveApplication(admin, actor, Number(app.id));
  return app;
}


async function paySubmitVerify(
  admin: AdminService,
  actor: AuthUser,
  opts: { bookingId: number; residentId: number; amountMinor: number; method?: string }
) {
  const payment = await admin.createPayment(actor, {
    bookingId: opts.bookingId,
    residentId: opts.residentId,
    amountMinor: opts.amountMinor,
    method: opts.method ?? "cash",
  }) as Record<string, unknown>;
  await admin.updatePaymentStatus(actor, Number(payment.id), "submitted");
  await admin.verifyPayment(actor, Number(payment.id));
  return payment;
}



function seedCore(db: Database) {
  for (const code of ["super_admin", "manager", "reception", "accounts", "maintenance"]) {
    run(db, `INSERT INTO roles (code, name, is_system) VALUES (?, ?, 1)`, [code, code]);
  }
  run(db, `INSERT INTO users (email, phone, display_name, user_type, status)
    VALUES ('manager@example.com', '+233200000099', 'Manager', 'staff', 'active')`);
  run(db, `INSERT INTO staff (id, user_id, role_id, staff_code, status)
    SELECT 1, u.id, r.id, 'KSM-STF-0001', 'active'
    FROM users u CROSS JOIN roles r
    WHERE u.email = 'manager@example.com' AND r.code = 'manager'`);

  run(db, `INSERT INTO institutions (code, name, status) VALUES ('UG', 'University of Ghana', 'active')`);
  run(db, `INSERT INTO academic_sessions (code, name, starts_on, ends_on, status)
    VALUES ('2026-2027', '2026/2027', '2026-09-01', '2027-06-30', 'active')`);

  run(db, `INSERT INTO rooms (room_code, room_name, floor, capacity, gender_policy, status)
    VALUES ('DAISY', 'Daisy', '1', 2, 'female', 'available')`);
  run(db, `INSERT INTO rooms (room_code, room_name, floor, capacity, gender_policy, status)
    VALUES ('ROSE', 'Rose', '1', 2, 'female', 'available')`);
  const daisy = get<{ id: number }>(db, `SELECT id FROM rooms WHERE room_code = 'DAISY'`)!;
  const rose = get<{ id: number }>(db, `SELECT id FROM rooms WHERE room_code = 'ROSE'`)!;
  run(db, `INSERT INTO beds (room_id, bed_code, label, status) VALUES (?, 'DAISY-B1', 'B1', 'available')`, [daisy.id]);
  run(db, `INSERT INTO beds (room_id, bed_code, label, status) VALUES (?, 'DAISY-B2', 'B2', 'available')`, [daisy.id]);
  run(db, `INSERT INTO beds (room_id, bed_code, label, status) VALUES (?, 'ROSE-B1', 'B1', 'available')`, [rose.id]);
  run(db, `INSERT INTO beds (room_id, bed_code, label, status) VALUES (?, 'ROSE-B2', 'B2', 'available')`, [rose.id]);

  const session = get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!;
  run(db, `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
    VALUES ('academic_calendar', 'AC-2026', 'AC 2026', '2026-09-01', '2027-06-30', 'active', ?)`, [session.id]);
  run(db, `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
    VALUES ('calendar_year', 'CY-2026', 'CY 2026', '2026-01-01', '2026-12-31', 'active', NULL)`);
  run(db, `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
    VALUES ('short_term', 'ST-2026-Q1', 'ST Q1', '2026-01-01', '2026-03-31', 'active', NULL)`);
  run(db, `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
    VALUES ('short_term', 'ST-2026-Q2', 'ST Q2', '2026-04-01', '2026-06-30', 'active', NULL)`);

  run(db, `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status)
    SELECT id, 2, 'AC-2', 250000, 'GHS', 'active' FROM lease_periods WHERE code = 'AC-2026'`);
  run(db, `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status)
    SELECT id, 2, 'CY-2', 300000, 'GHS', 'active' FROM lease_periods WHERE code = 'CY-2026'`);
  run(db, `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status)
    SELECT id, 2, 'ST-Q1-2', 150000, 'GHS', 'active' FROM lease_periods WHERE code = 'ST-2026-Q1'`);
  run(db, `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status)
    SELECT id, 2, 'ST-Q2-2', 160000, 'GHS', 'active' FROM lease_periods WHERE code = 'ST-2026-Q2'`);

  // Legacy room_rates exist but Path B must not silently fall back to them.
  run(db, `INSERT INTO room_rates (room_id, academic_session_id, rate_code, amount_minor, currency, status)
    VALUES (?, ?, 'DAISY-LEGACY', 999999, 'GHS', 'active')`, [daisy.id, session.id]);

  // payment_confirmation_settings row id=1 is seeded by migrations.
}

describe("Stage 2L-L migration chain & schema consistency", () => {
  it("applies exactly 0001→0020 (0020 = additive connector heartbeat only) and preserves critical columns", async () => {
    const files = listMigrationFiles();
    expect(files).toEqual(EXPECTED_MIGRATIONS);
    // The only migration after the 2L-L chain is the pre-Pi additive heartbeat table.
    expect(files.filter((f) => f > "0019_agreement_aware_allocations.sql")).toEqual(["0020_connector_heartbeats.sql"]);

    const db = await openMigratedDatabase();
    const bookingCols = all<{ name: string }>(db, `PRAGMA table_info(bookings)`).map((c) => String(c.name));
    for (const col of BOOKING_REQUIRED_COLS) {
      expect(bookingCols, `bookings missing ${col}`).toContain(col);
    }
    const allocCols = all<{ name: string }>(db, `PRAGMA table_info(allocations)`).map((c) => String(c.name));
    for (const col of ALLOCATION_REQUIRED_COLS) {
      expect(allocCols, `allocations missing ${col}`).toContain(col);
    }
    const sessionCol = all<{ name: string; notnull: number }>(db, `PRAGMA table_info(allocations)`)
      .find((c) => c.name === "academic_session_id");
    expect(sessionCol?.notnull).toBe(0);

    const residentCols = all<{ name: string }>(db, `PRAGMA table_info(residents)`).map((c) => String(c.name));
    expect(residentCols).toContain("ghana_card_number");
    expect(residentCols).toContain("resident_kind");
    expect(residentCols).toContain("institution_id");
  });

  it("documents Option A: only one simultaneously-active allocation per bed/resident", async () => {
    const db = await openMigratedDatabase();
    seedCore(db);
    // Indexes from 0019 remain the intentional operational model (not future multi-active scheduling).
    const indexes = all<{ name: string; sql: string }>(db, `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'allocations'`);
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_allocations_one_active_bed");
    expect(names).toContain("idx_allocations_one_active_resident");
  });
});

describe("Stage 2L-L live RBAC matrix (mounted permission gates)", () => {
  function mount(permission: string, role: RoleCode) {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authUser" as never, staffUser(role) as never);
      await next();
    });
    app.post("/action", requirePermission(permission), (c) => c.json({ ok: true }));
    return app;
  }

  const cases: Array<{ action: string; permission: string; allow: RoleCode[]; deny: RoleCode[] }> = [
    { action: "institution/session/lease/rate/capacity config", permission: "admin:write", allow: ["super_admin", "manager"], deny: ["reception", "accounts", "maintenance"] },
    { action: "agreement create / price override / payment policy / renew / extend / cross-room", permission: "admin:write", allow: ["super_admin", "manager"], deny: ["reception", "accounts", "maintenance"] },
    { action: "same-room allocation/transfer", permission: "allocation:write", allow: ["super_admin", "manager", "reception"], deny: ["accounts", "maintenance"] },
    { action: "payment verify", permission: "payment:verify", allow: ["super_admin", "manager", "accounts"], deny: ["reception", "maintenance"] },
    { action: "finance reports", permission: "report:finance", allow: ["super_admin", "manager", "accounts"], deny: ["reception", "maintenance"] },
    { action: "audit access", permission: "audit:read", allow: ["super_admin", "manager"], deny: ["reception", "accounts", "maintenance"] },
    { action: "staff role change", permission: "staff:read", allow: ["super_admin", "manager"], deny: ["reception", "accounts", "maintenance"] },
  ];

  for (const row of cases) {
    it(`${row.action}: allows ${row.allow.join(",")} and denies ${row.deny.join(",")}`, async () => {
      for (const role of row.allow) {
        expect(hasPermission(role, row.permission)).toBe(true);
        const res = await mount(row.permission, role).request("/action", { method: "POST" });
        expect(res.status, `${role} should allow`).toBe(200);
      }
      for (const role of row.deny) {
        expect(hasPermission(role, row.permission)).toBe(false);
        const res = await mount(row.permission, role).request("/action", { method: "POST" });
        expect(res.status, `${role} should deny`).toBe(403);
      }
    });
  }

  it("super_admin-only staff role change uses requireRole gate", async () => {
    const appFor = (role: RoleCode) => {
      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("authUser" as never, staffUser(role) as never);
        await next();
      });
      app.patch("/staff/:id/role", requireRole("super_admin"), (c) => c.json({ ok: true }));
      return app;
    };
    expect((await appFor("super_admin").request("/staff/1/role", { method: "PATCH" })).status).toBe(200);
    expect((await appFor("manager").request("/staff/1/role", { method: "PATCH" })).status).toBe(403);
    expect((await appFor("accounts").request("/staff/1/role", { method: "PATCH" })).status).toBe(403);
  });

  it("requireStaff blocks resident role from admin boundary", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authUser" as never, residentUser(1) as never);
      await next();
    });
    app.get("/admin-x", requireStaff(), (c) => c.json({ ok: true }));
    expect((await app.request("/admin-x")).status).toBe(403);
  });
});

describe("Stage 2L-L privacy, identity, IDOR, financial integrity (real sql.js)", () => {
  let db: Database;
  let admin: AdminService;
  let manager: AuthUser;

  beforeEach(async () => {
    db = await openMigratedDatabase();
    seedCore(db);
    admin = new AdminService(new AdminRepository(createSqlJsD1(db)));
    manager = staffUser("manager");
  });

  it("masks Ghana Card on list/get and redacts audit metadata keys", async () => {
    const created = await admin.createResident(manager, {
      displayName: "Other Person",
      firstName: "Other",
      lastName: "Person",
      gender: "female",
      phone: "+233200000777",
      institutionId: null,
      studentId: null,
      ghanaCardNumber: "GHA-111222333-4",
      status: "resident",
    }) as Record<string, unknown>;
    expect(created.ghana_card_number).toBeUndefined();
    expect(created.has_ghana_card_number).toBe(true);
    expect(String(created.ghana_card_number_masked)).toMatch(/\*/);
    expect(JSON.stringify(created)).not.toContain("GHA-111222333-4");

    const listed = await admin.listResidents(50, 0);
    const row = (listed.results as Record<string, unknown>[]).find((r) => Number(r.id) === Number(created.id));
    expect(row?.ghana_card_number).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain("GHA-111222333-4");

    // Defense-in-depth: even if a bad writer stored raw PII keys, audit read redacts them.
    run(db, `INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity_type, entity_id, metadata_json)
      VALUES (1, 1, 'test.leak', 'resident', ?, ?)`, [
      Number(created.id),
      JSON.stringify({
        ghana_card_number: "GHA-111222333-4",
        ghanaCardNumber: "GHA-111222333-4",
        phone: "+233200000777",
        otp: "123456",
        token: "sekrit",
        safeNote: "ok",
      }),
    ]);
    const audits = await admin.auditLogs(manager, { action: 'test.leak' }, 20, 0);
    const leak = (audits.results as Record<string, unknown>[]).find((a) => a.action === "test.leak");
    expect(leak).toBeTruthy();
    const meta = leak!.metadata as Record<string, unknown>;
    expect(meta.ghana_card_number).toBe("[REDACTED]");
    expect(meta.ghanaCardNumber).toBe("[REDACTED]");
    expect(meta.phone).toBe("[REDACTED]");
    expect(meta.otp).toBe("[REDACTED]");
    expect(meta.token).toBe("[REDACTED]");
    expect(meta.safeNote).toBe("ok");
  });

  it("enforces Listed vs Other identity invariants and rejects forged combinations", async () => {
    await expect(admin.createResident(manager, {
      displayName: "Bad",
      firstName: "Bad",
      lastName: "Combo",
      institutionId: null,
      studentId: "STU",
      ghanaCardNumber: null,
    })).rejects.toThrow();

    const inst = get<{ id: number }>(db, `SELECT id FROM institutions`)!;
    await expect(admin.createResident(manager, {
      displayName: "Bad2",
      firstName: "Bad2",
      lastName: "Combo",
      institutionId: inst.id,
      studentId: null,
      ghanaCardNumber: "GHA-000000000-0",
    })).rejects.toThrow();
  });

  it("blocks resident IDOR across documents/applications/payments via session residentId", async () => {
    const a = await admin.createResident(manager, {
      displayName: "A", firstName: "A", lastName: "One", gender: "female",
      institutionId: get<{ id: number }>(db, `SELECT id FROM institutions`)!.id,
      studentId: "UG-A-1", phone: "+233200000001", status: "resident",
    }) as Record<string, unknown>;
    const b = await admin.createResident(manager, {
      displayName: "B", firstName: "B", lastName: "Two", gender: "female",
      institutionId: null, studentId: null, ghanaCardNumber: "GHA-222333444-5",
      phone: "+233200000002", status: "resident",
    }) as Record<string, unknown>;

    // Insert a payment owned by B; A must not see it through ResidentService scoped queries.
    const stPeriod = get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'ST-2026-Q1'`)!;
    const daisy = get<{ id: number }>(db, `SELECT id FROM rooms WHERE room_code = 'DAISY'`)!;
    run(db, `INSERT INTO bookings (
      resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
      priced_room_id, lease_period_id, lease_kind, starts_on, ends_on, maintenance_fee_minor
    ) VALUES (?, NULL, 'KSM-BKG-IDOR-B', 'confirmed', 150000, 'GHS', ?, ?, 'short_term', '2026-01-01', '2026-03-31', 10000)`, [
      Number(b.id), daisy.id, stPeriod.id,
    ]);
    const bookingB = get<{ id: number }>(db, `SELECT id FROM bookings WHERE booking_number = 'KSM-BKG-IDOR-B'`)!;
    run(db, `INSERT INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method)
      VALUES (?, ?, 'PAY-IDOR-B', 'verified', 160000, 'GHS', 'cash')`, [bookingB.id, Number(b.id)]);

    const d1 = createSqlJsD1(db);
    const env = { DB: d1, APP_ENV: "local", APP_NAME: "kissmet-test" } as unknown as Env;
    const residentSvc = new ResidentService(env, new MockSmsProvider(env), undefined, new AdminRepository(d1));
    const userA = get<{ user_id: number }>(db, `SELECT user_id FROM residents WHERE id = ?`, [Number(a.id)])!;
    const scopedA = residentUser(Number(a.id), Number(userA.user_id));

    const bookingsA = await residentSvc.bookings(scopedA);
    expect((bookingsA.results ?? []).length).toBe(0);
    const paymentsA = await residentSvc.payments(scopedA);
    expect((paymentsA.results ?? []).length).toBe(0);
    await expect(residentSvc.receipt(scopedA, 1)).rejects.toThrow();
    expect(scopedA.residentId).not.toBe(Number(b.id));
  });

  it("financialReport includes maintenance in obligation (dashboard/report alignment)", async () => {
    const listed = await admin.createResident(manager, {
      displayName: "Fin", firstName: "Fin", lastName: "Test", gender: "female",
      institutionId: get<{ id: number }>(db, `SELECT id FROM institutions`)!.id,
      studentId: "UG-FIN-1", phone: "+233200000010", status: "resident",
    }) as Record<string, unknown>;
    const session = get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!;
    const acPeriod = get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'AC-2026'`)!;
    const daisy = get<{ id: number }>(db, `SELECT id FROM rooms WHERE room_code = 'DAISY'`)!;
    run(db, `INSERT INTO bookings (
      resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
      priced_room_id, lease_period_id, lease_kind, starts_on, ends_on, maintenance_fee_minor
    ) VALUES (?, ?, 'KSM-BKG-FIN', 'confirmed', 250000, 'GHS', ?, ?, 'academic_calendar', '2026-09-01', '2027-06-30', 50000)`, [
      Number(listed.id), session.id, daisy.id, acPeriod.id,
    ]);
    const bookingId = get<{ id: number }>(db, `SELECT id FROM bookings WHERE booking_number = 'KSM-BKG-FIN'`)!.id;
    run(db, `INSERT INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method)
      VALUES (?, ?, 'PAY-FIN-1', 'verified', 100000, 'GHS', 'cash')`, [bookingId, Number(listed.id)]);

    const dash = await admin.financialReport();
    expect(Number(dash?.expected_booking_revenue)).toBe(300000); // 250k + 50k maintenance
    expect(Number(dash?.verified_payments)).toBe(100000);
    expect(Number(dash?.outstanding_booking_balances)).toBe(200000);
    expect(Number(dash?.partially_paid_bookings)).toBe(1);
    expect(Number(dash?.fully_paid_bookings)).toBe(0);

    const outstanding = await admin.reportOutstanding({});
    expect(outstanding.balances.some((b) => Number(b.id) === bookingId && Number(b.outstanding_amount_minor) === 200000)).toBe(true);

    const computed = computeAgreementFinancial(
      { total_amount_minor: 250000, maintenance_fee_minor: 50000 },
      100000
    );
    expect(computed.total_obligation_minor).toBe(300000);
    expect(computed.balance_minor).toBe(200000);
  });
});

describe("Stage 2L-L E2E scenarios A–E (real schema through 0019)", () => {
  let db: Database;
  let admin: AdminService;
  let manager: AuthUser;
  let daisyId: number;
  let daisyB1: number;
  let daisyB2: number;
  let roseId: number;
  let roseB1: number;
  let sessionId: number;
  let acPeriodId: number;
  let cyPeriodId: number;
  let stPeriodId: number;
  let st2PeriodId: number;

  beforeEach(async () => {
    db = await openMigratedDatabase();
    seedCore(db);
    admin = new AdminService(new AdminRepository(createSqlJsD1(db)));
    manager = staffUser("manager");
    daisyId = Number(get<{ id: number }>(db, `SELECT id FROM rooms WHERE room_code = 'DAISY'`)!.id);
    roseId = Number(get<{ id: number }>(db, `SELECT id FROM rooms WHERE room_code = 'ROSE'`)!.id);
    daisyB1 = Number(get<{ id: number }>(db, `SELECT id FROM beds WHERE bed_code = 'DAISY-B1'`)!.id);
    daisyB2 = Number(get<{ id: number }>(db, `SELECT id FROM beds WHERE bed_code = 'DAISY-B2'`)!.id);
    roseB1 = Number(get<{ id: number }>(db, `SELECT id FROM beds WHERE bed_code = 'ROSE-B1'`)!.id);
    sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
    acPeriodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'AC-2026'`)!.id);
    cyPeriodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'CY-2026'`)!.id);
    stPeriodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'ST-2026-Q1'`)!.id);
    st2PeriodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'ST-2026-Q2'`)!.id);
  });

  it("A — Listed Academic Calendar full payment path", async () => {
    const inst = get<{ id: number }>(db, `SELECT id FROM institutions`)!;
    const resident = await admin.createResident(manager, {
      displayName: "Ama Calendar", firstName: "Ama", lastName: "Calendar", gender: "female",
      institutionId: inst.id, studentId: "UG-AC-99", phone: "+233200000101", status: "resident",
    }) as Record<string, unknown>;

    const app = await createApprovedApp(admin, manager, {
      residentId: Number(resident.id),
      academicSessionId: sessionId,
      leasePeriodId: acPeriodId,
    });
    expect(app.lease_kind).toBe("academic_calendar");

    const created = await admin.createBookingFromRateCard(manager, {
      applicationId: Number(app.id),
      leasePeriodId: acPeriodId,
      roomId: daisyId,
      maintenanceFeeMinor: 20000,
    });
    const booking = created.booking as Record<string, unknown>;
    expect(booking.lease_kind).toBe("academic_calendar");
    expect(Number(booking.academic_session_id)).toBe(sessionId);
    expect(Number(booking.total_amount_minor)).toBe(250000);
    expect(Number(booking.maintenance_fee_minor)).toBe(20000);
    expect(Number(booking.partial_payment_authorized)).toBe(0);

    run(db, `UPDATE rate_cards SET amount_minor = 1 WHERE rate_code = 'AC-2'`);
    const still = await admin.getBookingAgreement(Number(booking.id));
    expect(Number((still.booking as Record<string, unknown>).total_amount_minor)).toBe(250000);

    const payment = await paySubmitVerify(admin, manager, {
      bookingId: Number(booking.id),
      residentId: Number(resident.id),
      amountMinor: 270000,
    });
    await admin.updateBookingStatus(manager, Number(booking.id), "confirmed");
    const alloc = await admin.createAllocation(manager, {
      bookingId: Number(booking.id),
      bedId: daisyB1,
      startsOn: "2026-09-01",
      endsOn: "2027-06-30",
    }) as Record<string, unknown>;
    expect(alloc.status).toBe("active");
    const summary = await admin.bookingPaymentSummary(Number(booking.id));
    expect(summary.balanceMinor).toBe(0);
    const receipt = await admin.issueReceipt(manager, Number(payment.id)) as Record<string, unknown>;
    expect(receipt.receipt_number).toBeTruthy();
    expect(JSON.stringify(receipt)).not.toMatch(/GHA-/);
  });

  it("B — Other Short-Term partial then payoff", async () => {
    const resident = await admin.createResident(manager, {
      displayName: "Other ST", firstName: "Kojo", lastName: "Short", gender: "female",
      institutionId: null, studentId: null, ghanaCardNumber: "GHA-555666777-8",
      phone: "+233200000202", status: "resident",
    }) as Record<string, unknown>;

    const app = await createApprovedApp(admin, manager, {
      residentId: Number(resident.id),
      leasePeriodId: stPeriodId,
    });
    expect(app.academic_session_id).toBeNull();
    expect(app.lease_kind).toBe("short_term");

    const created = await admin.createBookingFromRateCard(manager, {
      applicationId: Number(app.id),
      leasePeriodId: stPeriodId,
      roomId: daisyId,
      maintenanceFeeMinor: 10000,
    });
    const booking = created.booking as Record<string, unknown>;
    expect(booking.academic_session_id).toBeNull();
    expect(Number(booking.partial_payment_authorized)).toBe(0);

    await admin.setBookingPaymentPolicy(manager, Number(booking.id), {
      partialPaymentAuthorized: true,
      paymentRequirementType: "fixed",
      paymentFixedAmountMinor: 50000,
      reason: "Management hardship arrangement",
    });

    // Confirmation threshold is independent of per-agreement partial policy.
    run(db, `UPDATE payment_confirmation_settings SET requirement_type = 'fixed', fixed_amount_minor = 50000 WHERE id = 1`);

    await paySubmitVerify(admin, manager, {
      bookingId: Number(booking.id), residentId: Number(resident.id), amountMinor: 50000, method: "mobile_money",
    });
    const mid = await admin.bookingPaymentSummary(Number(booking.id));
    expect(mid.verifiedPaidMinor).toBe(50000);
    expect(mid.balanceMinor).toBe(110000);

    await admin.updateBookingStatus(manager, Number(booking.id), "confirmed");
    await admin.createAllocation(manager, {
      bookingId: Number(booking.id),
      bedId: daisyB2,
      startsOn: "2026-01-01",
      endsOn: "2026-03-31",
    });

    const second = await paySubmitVerify(admin, manager, {
      bookingId: Number(booking.id), residentId: Number(resident.id), amountMinor: 110000,
    });
    const done = await admin.bookingPaymentSummary(Number(booking.id));
    expect(done.balanceMinor).toBe(0);
    expect(second).toBeTruthy();

    const outstanding = await admin.reportOutstanding({});
    expect(outstanding.balances.every((b) => Number(b.id) !== Number(booking.id))).toBe(true);
  });

  it("C — Calendar Year + cross-room transfer preserves history", async () => {
    const resident = await admin.createResident(manager, {
      displayName: "CY Res", firstName: "Efua", lastName: "Year", gender: "female",
      institutionId: null, studentId: null, ghanaCardNumber: "GHA-888999000-1",
      phone: "+233200000303", status: "resident",
    }) as Record<string, unknown>;

    const app = await createApprovedApp(admin, manager, {
      residentId: Number(resident.id),
      leasePeriodId: cyPeriodId,
    });
    const created = await admin.createBookingFromRateCard(manager, {
      applicationId: Number(app.id),
      leasePeriodId: cyPeriodId,
      roomId: daisyId,
      maintenanceFeeMinor: 0,
    });
    const booking = created.booking as Record<string, unknown>;
    expect(booking.academic_session_id).toBeNull();
    expect(Number(booking.total_amount_minor)).toBe(300000);

    await paySubmitVerify(admin, manager, {
      bookingId: Number(booking.id), residentId: Number(resident.id), amountMinor: 300000,
    });
    await admin.updateBookingStatus(manager, Number(booking.id), "confirmed");
    const alloc = await admin.createAllocation(manager, {
      bookingId: Number(booking.id),
      bedId: daisyB1,
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
    }) as Record<string, unknown>;

    const transfer = await admin.crossRoomTransferAllocation(manager, Number(alloc.id), {
      destinationBedId: roseB1,
      startsOn: "2026-06-01",
      reason: "Maintenance move",
    });
    const newAlloc = transfer.allocation as Record<string, unknown>;
    expect(newAlloc.status).toBe("active");
    expect(Number(newAlloc.bed_id)).toBe(roseB1);

    const old = get<Record<string, unknown>>(db, `SELECT status FROM allocations WHERE id = ?`, [Number(alloc.id)])!;
    expect(old.status).toBe("transferred");

    const updatedBooking = get<Record<string, unknown>>(db, `SELECT priced_room_id FROM bookings WHERE id = ?`, [Number(booking.id)])!;
    expect(Number(updatedBooking.priced_room_id)).toBe(roseId);
  });

  it("D — ST extension after verified payment preserves verified totals", async () => {
    const resident = await admin.createResident(manager, {
      displayName: "Ext", firstName: "Ext", lastName: "End", gender: "female",
      institutionId: null, studentId: null, ghanaCardNumber: "GHA-121212121-2",
      phone: "+233200000404", status: "resident",
    }) as Record<string, unknown>;

    const app = await createApprovedApp(admin, manager, {
      residentId: Number(resident.id),
      leasePeriodId: stPeriodId,
    });
    const created = await admin.createBookingFromRateCard(manager, {
      applicationId: Number(app.id),
      leasePeriodId: stPeriodId,
      roomId: daisyId,
      maintenanceFeeMinor: 5000,
    });
    const booking = created.booking as Record<string, unknown>;
    await paySubmitVerify(admin, manager, {
      bookingId: Number(booking.id), residentId: Number(resident.id), amountMinor: 155000,
    });
    await admin.updateBookingStatus(manager, Number(booking.id), "confirmed");
    await admin.createAllocation(manager, {
      bookingId: Number(booking.id),
      bedId: daisyB1,
      startsOn: "2026-01-01",
      endsOn: "2026-03-31",
    });

    const extended = await admin.extendBookingAgreement(manager, Number(booking.id), {
      endsOn: "2026-04-30",
      reason: "Stay one more month",
      totalAmountMinor: 200000,
      maintenanceFeeMinor: 5000,
    });
    expect(String((extended.booking as Record<string, unknown>).ends_on).slice(0, 10)).toBe("2026-04-30");
    expect(extended.financial.verified_paid_minor).toBe(155000);
    expect(extended.financial.balance_minor).toBe(50000);

    await expect(admin.extendBookingAgreement(manager, Number(booking.id), {
      endsOn: "2026-05-31",
      reason: "bad",
      totalAmountMinor: 10000,
      maintenanceFeeMinor: 0,
    })).rejects.toThrow(/verified/i);
  });

  it("E — Renewal creates new agreement with prior_booking_id and no carry-forward", async () => {
    const resident = await admin.createResident(manager, {
      displayName: "Renew", firstName: "Ren", lastName: "Ew", gender: "female",
      institutionId: get<{ id: number }>(db, `SELECT id FROM institutions`)!.id,
      studentId: "UG-REN-1", phone: "+233200000505", status: "resident",
    }) as Record<string, unknown>;

    const app = await createApprovedApp(admin, manager, {
      residentId: Number(resident.id),
      leasePeriodId: stPeriodId,
    });
    const first = await admin.createBookingFromRateCard(manager, {
      applicationId: Number(app.id),
      leasePeriodId: stPeriodId,
      roomId: daisyId,
      maintenanceFeeMinor: 8000,
    });
    const prior = first.booking as Record<string, unknown>;
    await admin.setBookingPaymentPolicy(manager, Number(prior.id), {
      partialPaymentAuthorized: true,
      paymentRequirementType: "percentage",
      paymentPercentageBasisPoints: 5000,
      reason: "prior partial",
    });
    run(db, `UPDATE payment_confirmation_settings SET requirement_type = 'fixed', fixed_amount_minor = 50000 WHERE id = 1`);
    await paySubmitVerify(admin, manager, {
      bookingId: Number(prior.id), residentId: Number(resident.id), amountMinor: 50000,
    });
    await admin.updateBookingStatus(manager, Number(prior.id), "confirmed");

    const renewed = await admin.renewBooking(manager, Number(prior.id), {
      leasePeriodId: st2PeriodId,
      roomId: roseId,
      maintenanceFeeMinor: 12000,
      reason: "Next term renewal",
    });
    const neu = renewed.booking as Record<string, unknown>;
    expect(Number(neu.prior_booking_id)).toBe(Number(prior.id));
    expect(Number(neu.total_amount_minor)).toBe(160000);
    expect(Number(neu.maintenance_fee_minor)).toBe(12000);
    expect(Number(neu.partial_payment_authorized)).toBe(0);
    expect(neu.application_id).toBeNull();
    expect(Number(neu.priced_room_id)).toBe(roseId);

    const old = get<Record<string, unknown>>(db, `SELECT status, total_amount_minor, partial_payment_authorized FROM bookings WHERE id = ?`, [Number(prior.id)])!;
    expect(old.status).toBe("confirmed");
    expect(Number(old.partial_payment_authorized)).toBe(1);

    const allocCount = get<{ c: number }>(db, `SELECT COUNT(*) AS c FROM allocations WHERE booking_id = ?`, [Number(neu.id)])!;
    expect(Number(allocCount.c)).toBe(0);

    const priorPayments = get<{ c: number }>(db, `SELECT COUNT(*) AS c FROM payments WHERE booking_id = ? AND status = 'verified'`, [Number(prior.id)])!;
    const newPayments = get<{ c: number }>(db, `SELECT COUNT(*) AS c FROM payments WHERE booking_id = ?`, [Number(neu.id)])!;
    expect(Number(priorPayments.c)).toBe(1);
    expect(Number(newPayments.c)).toBe(0);
  });

  it("requested Short-Term may be approved as Calendar Year without mutating application", async () => {
    const resident = await admin.createResident(manager, {
      displayName: "Req", firstName: "Req", lastName: "Diff", gender: "female",
      institutionId: null, studentId: null, ghanaCardNumber: "GHA-333444555-6",
      phone: "+233200000606", status: "resident",
    }) as Record<string, unknown>;
    const app = await createApprovedApp(admin, manager, {
      residentId: Number(resident.id),
      leasePeriodId: stPeriodId,
    });
    expect(app.lease_kind).toBe("short_term");

    const agreement = await admin.createBookingFromRateCard(manager, {
      applicationId: Number(app.id),
      leasePeriodId: cyPeriodId,
      roomId: daisyId,
    });
    expect((agreement.booking as Record<string, unknown>).lease_kind).toBe("calendar_year");
    const appAfter = get<Record<string, unknown>>(db, `SELECT lease_kind FROM applications WHERE id = ?`, [Number(app.id)])!;
    expect(appAfter.lease_kind).toBe("short_term");
  });

  it("rejects second simultaneously-active allocation (Option A)", async () => {
    const resident = await admin.createResident(manager, {
      displayName: "OptA", firstName: "Opt", lastName: "A", gender: "female",
      institutionId: null, studentId: null, ghanaCardNumber: "GHA-444555666-7",
      phone: "+233200000707", status: "resident",
    }) as Record<string, unknown>;
    const app = await createApprovedApp(admin, manager, {
      residentId: Number(resident.id),
      leasePeriodId: cyPeriodId,
    });
    const agreement = await admin.createBookingFromRateCard(manager, {
      applicationId: Number(app.id), leasePeriodId: cyPeriodId, roomId: daisyId,
    });
    const booking = agreement.booking as Record<string, unknown>;
    await paySubmitVerify(admin, manager, {
      bookingId: Number(booking.id), residentId: Number(resident.id), amountMinor: 300000,
    });
    await admin.updateBookingStatus(manager, Number(booking.id), "confirmed");
    await admin.createAllocation(manager, {
      bookingId: Number(booking.id),
      bedId: daisyB1, startsOn: "2026-01-01", endsOn: "2026-06-30",
    });
    await expect(admin.createAllocation(manager, {
      bookingId: Number(booking.id),
      bedId: daisyB2, startsOn: "2026-07-01", endsOn: "2026-12-31",
    })).rejects.toThrow();
  });
});

describe("Stage 2L-L presentResidentRow helper", () => {
  it("never returns raw ghana_card_number", () => {
    const presented = presentResidentRow({
      id: 1,
      resident_kind: "non_student",
      institution_id: null,
      student_id: null,
      ghana_card_number: "GHA-999888777-0",
      first_name: "X",
    });
    expect(presented).not.toHaveProperty("ghana_card_number");
    expect(presented.has_ghana_card_number).toBe(true);
    expect(JSON.stringify(presented)).not.toContain("GHA-999888777-0");
  });
});
