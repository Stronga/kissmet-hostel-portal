import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import {
  all,
  expectReject,
  get,
  listMigrationFiles,
  openMigratedDatabase,
  readMigrationSql,
  run,
} from "./apply-migrations";
import { AdminRepository } from "../src/repositories/admin.repository";
import { AdminService } from "../src/services/admin.service";
import type { AuthUser } from "../src/auth/context";

const THROUGH_0017 = "0017_ghana_card_number_and_identity_realignment.sql";
const MIGRATION_0018 = "0018_session_optional_booking_agreements.sql";
const DISTINCTIVE_REASON = "DISTINCTIVE_ATTENTION_REASON_2LG_R";

type ColInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

function tableInfo(db: Database): ColInfo[] {
  return all<ColInfo>(db, `PRAGMA table_info(bookings)`).map((c) => ({
    name: String(c.name),
    type: String(c.type),
    notnull: Number(c.notnull),
    dflt_value: c.dflt_value,
    pk: Number(c.pk),
  }));
}

function seedGraph(db: Database) {
  run(
    db,
    `INSERT INTO users (email, phone, display_name, user_type, status)
     VALUES ('preserve.resident@example.com', '+233200000001', 'Preserve Resident', 'resident', 'active')`,
  );
  run(db, `INSERT INTO institutions (code, name, status) VALUES ('PRESERVE-UNI', 'Preserve University', 'active')`);
  run(
    db,
    `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, gender, status)
     SELECT id, (SELECT id FROM institutions WHERE code = 'PRESERVE-UNI'), 'PRESERVE-STU-1', 'Preserve', 'Resident', 'female', 'applicant'
     FROM users WHERE email = 'preserve.resident@example.com'`,
  );
  run(
    db,
    `INSERT INTO academic_sessions (code, name, starts_on, ends_on, status)
     VALUES ('2026-2027', '2026/2027 Academic Year', '2026-09-01', '2027-06-30', 'active')`,
  );
  run(
    db,
    `INSERT INTO rooms (room_code, room_name, floor, capacity, gender_policy, status)
     VALUES ('R1', 'Daisy', '1', 2, 'female', 'available')`,
  );
}

function createSqlJsD1(db: Database): D1Database {
  const wrap = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      async first<T>() {
        const row = get<Record<string, unknown>>(db, sql, binds as Array<string | number | null>);
        return (row as T) ?? null;
      },
      async all<T>() {
        const rows = all<Record<string, unknown>>(db, sql, binds as Array<string | number | null>);
        return { results: rows as T[], success: true };
      },
      async run() {
        run(db, sql, binds as Array<string | number | null>);
        const changes = Number(db.getRowsModified());
        let lastRowId: number | null = null;
        if (/^\s*INSERT\b/i.test(sql)) {
          const row = get<{ id: number }>(db, `SELECT last_insert_rowid() AS id`);
          lastRowId = row ? Number(row.id) : null;
        }
        return {
          success: true,
          meta: {
            changes,
            last_row_id: lastRowId,
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: changes,
          },
        };
      },
    };
    return stmt;
  };
  return {
    prepare(sql: string) {
      return wrap(sql) as unknown as D1PreparedStatement;
    },
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

const accountsActor: AuthUser = {
  id: 99,
  userType: "staff",
  displayName: "Accounts",
  email: "accounts@example.com",
  role: "accounts",
  staffId: 9,
  residentId: null,
  sessionId: 1,
};

describe("Stage 2L-G-R repaired 0018 booking rebuild", () => {
  it("lists migrations 0001–0018 intact with 0019 as a later forward migration", () => {
    const files = listMigrationFiles();
    expect(files[0]).toBe("0001_canonical_schema.sql");
    expect(files).toContain(THROUGH_0017);
    expect(files).toContain(MIGRATION_0018);
    expect(files.indexOf(MIGRATION_0018)).toBeGreaterThan(files.indexOf(THROUGH_0017));
    // 0019 is Stage 2L-H; 0001–0018 remain immutable and present.
    expect(files).toContain("0019_agreement_aware_allocations.sql");
    expect(files.indexOf("0019_agreement_aware_allocations.sql")).toBeGreaterThan(files.indexOf(MIGRATION_0018));
  });

  it("preserves every pre-0018 bookings column; only academic_session_id notnull changes", async () => {
    const db = await openMigratedDatabase(THROUGH_0017);
    const before = tableInfo(db);
    const beforeNames = before.map((c) => c.name);
    expect(beforeNames).toContain("payment_attention_required");
    expect(beforeNames).toContain("payment_attention_reason");

    seedGraph(db);
    db.run(readMigrationSql(MIGRATION_0018));

    const after = tableInfo(db);
    const afterNames = after.map((c) => c.name);
    const removed = beforeNames.filter((n) => !afterNames.includes(n));
    const added = afterNames.filter((n) => !beforeNames.includes(n));
    expect(removed).toEqual([]);
    expect(added).toEqual([]);

    const notnullChanged = before
      .filter((b) => {
        const a = after.find((x) => x.name === b.name);
        return a && a.notnull !== b.notnull;
      })
      .map((b) => b.name);
    expect(notnullChanged).toEqual(["academic_session_id"]);

    const sessionCol = after.find((c) => c.name === "academic_session_id");
    expect(Number(sessionCol?.notnull)).toBe(0);

    const attentionRequired = after.find((c) => c.name === "payment_attention_required");
    expect(attentionRequired?.type.toUpperCase()).toContain("INT");
    expect(Number(attentionRequired?.notnull)).toBe(1);

    const attentionReason = after.find((c) => c.name === "payment_attention_reason");
    expect(attentionReason?.type.toUpperCase()).toContain("TEXT");
    expect(Number(attentionReason?.notnull)).toBe(0);
  });

  it("carries payment_attention and agreement field values through the real 0018 rebuild", async () => {
    const db = await openMigratedDatabase(THROUGH_0017);
    seedGraph(db);
    const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
    const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
    const roomId = Number(get<{ id: number }>(db, `SELECT id FROM rooms`)!.id);

    run(
      db,
      `INSERT INTO bookings (
         resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
         priced_room_id, payment_attention_required, payment_attention_reason,
         maintenance_fee_minor, payment_requirement_type, payment_fixed_amount_minor,
         payment_percentage_basis_points, partial_payment_authorized, override_reason,
         booked_at, created_at, updated_at, expires_at
       ) VALUES (?, ?, 'KSM-BKG-PRESERVE', 'confirmed', 250000, 'GHS',
         ?, 1, ?,
         15000, 'percentage', NULL, 5000, 1, 'pre-0018 override note',
         '2026-01-15T10:00:00.000Z', '2026-01-15T10:00:00.000Z', '2026-01-16T11:00:00.000Z',
         '2026-02-01T00:00:00.000Z')`,
      [residentId, sessionId, roomId, DISTINCTIVE_REASON],
    );

    const before = get<Record<string, unknown>>(
      db,
      `SELECT * FROM bookings WHERE booking_number = 'KSM-BKG-PRESERVE'`,
    );
    expect(before).toBeTruthy();
    const bookingId = Number(before!.id);

    db.run(readMigrationSql(MIGRATION_0018));

    const after = get<Record<string, unknown>>(
      db,
      `SELECT * FROM bookings WHERE booking_number = 'KSM-BKG-PRESERVE'`,
    );
    expect(after).toBeTruthy();
    expect(Number(after!.id)).toBe(bookingId);
    expect(Number(after!.resident_id)).toBe(residentId);
    expect(Number(after!.academic_session_id)).toBe(sessionId);
    expect(Number(after!.priced_room_id)).toBe(roomId);
    expect(Number(after!.total_amount_minor)).toBe(250000);
    expect(Number(after!.payment_attention_required)).toBe(1);
    expect(String(after!.payment_attention_reason)).toBe(DISTINCTIVE_REASON);
    expect(Number(after!.maintenance_fee_minor)).toBe(15000);
    expect(after!.payment_requirement_type).toBe("percentage");
    expect(Number(after!.payment_percentage_basis_points)).toBe(5000);
    expect(Number(after!.partial_payment_authorized)).toBe(1);
    expect(after!.override_reason).toBe("pre-0018 override note");
    expect(after!.booked_at).toBe("2026-01-15T10:00:00.000Z");
    expect(after!.created_at).toBe("2026-01-15T10:00:00.000Z");
    expect(after!.updated_at).toBe("2026-01-16T11:00:00.000Z");
    expect(after!.expires_at).toBe("2026-02-01T00:00:00.000Z");
    expect(after!.status).toBe("confirmed");
    expect(after!.lease_period_id).toBeNull();
  });

  describe("booking commercial shapes after 0018", () => {
    let db: Database;
    beforeEach(async () => {
      db = await openMigratedDatabase();
      seedGraph(db);
    });

    it("accepts Legacy Path A (session present, lease null)", () => {
      const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
      const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
      run(
        db,
        `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
         VALUES (?, ?, 'KSM-BKG-PATH-A', 'pending', 250000, 'GHS')`,
        [residentId, sessionId],
      );
      const row = get<Record<string, unknown>>(db, `SELECT * FROM bookings WHERE booking_number = 'KSM-BKG-PATH-A'`);
      expect(Number(row?.academic_session_id)).toBe(sessionId);
      expect(row?.lease_period_id).toBeNull();
    });

    it("accepts Academic Calendar Path B with linked session", () => {
      const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
      const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
         VALUES ('academic_calendar', 'AC-SHAPE', 'AC', '2026-09-01', '2027-06-30', 'active', ?)`,
        [sessionId],
      );
      const leaseId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'AC-SHAPE'`)!.id);
      run(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (?, ?, 'KSM-BKG-AC', 'pending', 600000, 'GHS', ?, 'academic_calendar', '2026-09-01', '2027-06-30')`,
        [residentId, sessionId, leaseId],
      );
      const row = get<Record<string, unknown>>(db, `SELECT * FROM bookings WHERE booking_number = 'KSM-BKG-AC'`);
      expect(row?.lease_kind).toBe("academic_calendar");
      expect(Number(row?.academic_session_id)).toBe(sessionId);
    });

    it("accepts Calendar Year / Short-Term Path B with null session", () => {
      const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('calendar_year', 'CY-SHAPE', 'CY', '2027-01-01', '2027-12-31', 'active')`,
      );
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('short_term', 'ST-SHAPE', 'ST', '2027-01-01', '2027-03-31', 'active')`,
      );
      const cyId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'CY-SHAPE'`)!.id);
      const stId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'ST-SHAPE'`)!.id);
      run(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (?, NULL, 'KSM-BKG-CY', 'pending', 900000, 'GHS', ?, 'calendar_year', '2027-01-01', '2027-12-31')`,
        [residentId, cyId],
      );
      run(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (?, NULL, 'KSM-BKG-ST', 'pending', 350000, 'GHS', ?, 'short_term', '2027-01-01', '2027-03-31')`,
        [residentId, stId],
      );
      expect(get(db, `SELECT academic_session_id FROM bookings WHERE booking_number = 'KSM-BKG-CY'`)?.academic_session_id).toBeNull();
      expect(get(db, `SELECT academic_session_id FROM bookings WHERE booking_number = 'KSM-BKG-ST'`)?.academic_session_id).toBeNull();
    });

    it("rejects empty commercial identity and CY/ST with attached session", () => {
      const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
      const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
      const emptyErr = expectReject(
        db,
        `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
         VALUES (?, NULL, 'KSM-BKG-EMPTY', 'pending', 100000, 'GHS')`,
        [residentId],
      );
      expect(emptyErr).toMatch(/CHECK|constraint/i);

      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('short_term', 'ST-BAD', 'ST Bad', '2027-01-01', '2027-03-31', 'active')`,
      );
      const stId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'ST-BAD'`)!.id);
      const cyStErr = expectReject(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (?, ?, 'KSM-BKG-ST-BAD', 'pending', 350000, 'GHS', ?, 'short_term', '2027-01-01', '2027-03-31')`,
        [residentId, sessionId, stId],
      );
      expect(cyStErr).toMatch(/CHECK|constraint/i);
    });
  });

  describe("duplicate uniqueness on rebuilt schema", () => {
    let db: Database;
    beforeEach(async () => {
      db = await openMigratedDatabase();
      seedGraph(db);
      run(
        db,
        `INSERT INTO users (email, phone, display_name, user_type, status)
         VALUES ('second@example.com', '+233200000002', 'Second', 'resident', 'active')`,
      );
      run(
        db,
        `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, gender, status)
         SELECT id, 1, 'PRESERVE-STU-2', 'Second', 'Resident', 'female', 'applicant'
         FROM users WHERE email = 'second@example.com'`,
      );
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('calendar_year', 'CY-DUP-1', 'CY1', '2027-01-01', '2027-12-31', 'active')`,
      );
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('calendar_year', 'CY-DUP-2', 'CY2', '2028-01-01', '2028-12-31', 'active')`,
      );
      run(
        db,
        `INSERT INTO applications (resident_id, academic_session_id, application_number, status)
         VALUES (1, 1, 'KSM-APP-DUP-1', 'approved')`,
      );
    });

    it("blocks duplicate active legacy resident/session booking", () => {
      run(
        db,
        `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
         VALUES (1, 1, 'KSM-BKG-DUP-S1', 'pending', 100000, 'GHS')`,
      );
      const err = expectReject(
        db,
        `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
         VALUES (1, 1, 'KSM-BKG-DUP-S2', 'confirmed', 100000, 'GHS')`,
      );
      expect(err).toMatch(/UNIQUE|constraint/i);
    });

    it("blocks duplicate active resident/lease-period agreement", () => {
      const leaseId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'CY-DUP-1'`)!.id);
      run(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (1, NULL, 'KSM-BKG-DUP-L1', 'pending', 900000, 'GHS', ?, 'calendar_year', '2027-01-01', '2027-12-31')`,
        [leaseId],
      );
      const err = expectReject(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (1, NULL, 'KSM-BKG-DUP-L2', 'confirmed', 900000, 'GHS', ?, 'calendar_year', '2027-01-01', '2027-12-31')`,
        [leaseId],
      );
      expect(err).toMatch(/UNIQUE|constraint/i);
    });

    it("blocks duplicate active agreement from same application", () => {
      const appId = Number(get<{ id: number }>(db, `SELECT id FROM applications WHERE application_number = 'KSM-APP-DUP-1'`)!.id);
      const leaseId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'CY-DUP-1'`)!.id);
      run(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, application_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (1, NULL, ?, 'KSM-BKG-DUP-A1', 'pending', 900000, 'GHS', ?, 'calendar_year', '2027-01-01', '2027-12-31')`,
        [appId, leaseId],
      );
      const lease2 = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'CY-DUP-2'`)!.id);
      const err = expectReject(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, application_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (1, NULL, ?, 'KSM-BKG-DUP-A2', 'pending', 900000, 'GHS', ?, 'calendar_year', '2028-01-01', '2028-12-31')`,
        [appId, lease2],
      );
      expect(err).toMatch(/UNIQUE|constraint/i);
    });

    it("allows same resident different lease periods and non-active historical re-agreement", () => {
      const lease1 = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'CY-DUP-1'`)!.id);
      const lease2 = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'CY-DUP-2'`)!.id);
      run(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (1, NULL, 'KSM-BKG-MULTI-1', 'pending', 900000, 'GHS', ?, 'calendar_year', '2027-01-01', '2027-12-31')`,
        [lease1],
      );
      run(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (1, NULL, 'KSM-BKG-MULTI-2', 'pending', 950000, 'GHS', ?, 'calendar_year', '2028-01-01', '2028-12-31')`,
        [lease2],
      );
      expect(
        all(db, `SELECT booking_number FROM bookings WHERE resident_id = 1 AND status = 'pending' ORDER BY booking_number`).map(
          (r) => r.booking_number,
        ),
      ).toEqual(["KSM-BKG-MULTI-1", "KSM-BKG-MULTI-2"]);

      run(db, `UPDATE bookings SET status = 'cancelled' WHERE booking_number = 'KSM-BKG-MULTI-1'`);
      run(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on
         ) VALUES (1, NULL, 'KSM-BKG-MULTI-1B', 'pending', 910000, 'GHS', ?, 'calendar_year', '2027-01-01', '2027-12-31')`,
        [lease1],
      );
      expect(get(db, `SELECT status FROM bookings WHERE booking_number = 'KSM-BKG-MULTI-1B'`)?.status).toBe("pending");
    });
  });

  describe("live payment_attention service/query regression on real 0018 schema", () => {
    it("payment summary, refund attention write, finance and outstanding queries succeed", async () => {
      const db = await openMigratedDatabase();
      seedGraph(db);
      const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
      const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
      const roomId = Number(get<{ id: number }>(db, `SELECT id FROM rooms`)!.id);

      run(db, `INSERT INTO roles (code, name, is_system) VALUES ('accounts', 'Accounts', 1)`);
      run(
        db,
        `INSERT INTO users (email, phone, display_name, user_type, status)
         VALUES ('accounts@example.com', '+233200000099', 'Accounts', 'staff', 'active')`,
      );
      run(
        db,
        `INSERT INTO staff (id, user_id, role_id, staff_code, status)
         SELECT 9, u.id, r.id, 'KSM-STAFF-009', 'active'
         FROM users u CROSS JOIN roles r
         WHERE u.email = 'accounts@example.com' AND r.code = 'accounts'`,
      );
      // Align actor user id with seeded staff user
      const staffUserId = Number(get<{ id: number }>(db, `SELECT id FROM users WHERE email = 'accounts@example.com'`)!.id);
      const actor = { ...accountsActor, id: staffUserId };

      run(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           priced_room_id, payment_attention_required, payment_attention_reason
         ) VALUES (?, ?, 'KSM-BKG-ATTN', 'confirmed', 250000, 'GHS', ?, 0, NULL)`,
        [residentId, sessionId, roomId],
      );
      const bookingId = Number(get<{ id: number }>(db, `SELECT id FROM bookings WHERE booking_number = 'KSM-BKG-ATTN'`)!.id);

      run(
        db,
        `INSERT INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method)
         VALUES (?, ?, 'KSM-PAY-ATTN-1', 'verified', 100000, 'GHS', 'mobile_money')`,
        [bookingId, residentId],
      );
      const paymentId = Number(get<{ id: number }>(db, `SELECT id FROM payments WHERE payment_reference = 'KSM-PAY-ATTN-1'`)!.id);

      const d1 = createSqlJsD1(db);
      const repo = new AdminRepository(d1);
      const svc = new AdminService(repo);

      const summary = await svc.bookingPaymentSummary(bookingId);
      expect(summary.paymentAttentionRequired).toBe(false);
      expect(summary.verifiedPaidMinor).toBe(100000);
      expect(summary.balanceMinor).toBe(150000);

      // A paid full refund (RefundService; see tests/refund-milestone-2.test.ts) moves the payment to
      // refunded with refunded_amount_minor = amount; the attention recalculation then flags the booking.
      run(db, `UPDATE payments SET status = 'refunded', refunded_amount_minor = amount_minor, refund_status = 'fully_refunded' WHERE id = ?`, [paymentId]);
      const refundedSummary = await svc.recalculatePaymentAttention(actor, bookingId, "refund", paymentId);
      expect(refundedSummary?.verifiedPaidMinor).toBe(0);

      const afterRefund = get<Record<string, unknown>>(db, `SELECT payment_attention_required, payment_attention_reason FROM bookings WHERE id = ?`, [
        bookingId,
      ]);
      expect(Number(afterRefund?.payment_attention_required)).toBe(1);
      expect(String(afterRefund?.payment_attention_reason)).toMatch(/Refund reduced verified payments/i);

      const finance = await svc.financialReport();
      expect(Number(finance?.bookings_requiring_payment_attention)).toBeGreaterThanOrEqual(1);

      const appsBookings = await svc.reportApplicationsBookings({});
      expect(appsBookings.bookings.some((b) => Number(b.id) === bookingId && Number(b.payment_attention_required) === 1)).toBe(true);

      const outstanding = await svc.reportOutstanding({});
      expect(outstanding.balances.some((b) => Number(b.id) === bookingId && Number(b.payment_attention_required) === 1)).toBe(true);

      const reportFinance = await svc.reportFinance({});
      expect(Number(reportFinance.summary.bookings_requiring_payment_attention)).toBeGreaterThanOrEqual(1);
    });
  });
});
