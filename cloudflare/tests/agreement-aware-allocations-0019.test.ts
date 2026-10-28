import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import {
  all,
  get,
  listMigrationFiles,
  openMigratedDatabase,
  readMigrationSql,
  run,
} from "./apply-migrations";
import { AdminRepository } from "../src/repositories/admin.repository";
import { AdminService, allocationIntervalsOverlap, dayBeforeIsoDate } from "../src/services/admin.service";
import type { AuthUser } from "../src/auth/context";

const THROUGH_0018 = "0018_session_optional_booking_agreements.sql";
const MIGRATION_0019 = "0019_agreement_aware_allocations.sql";

type ColInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

function tableInfo(db: Database, table = "allocations"): ColInfo[] {
  return all<ColInfo>(db, `PRAGMA table_info(${table})`).map((c) => ({
    name: String(c.name),
    type: String(c.type),
    notnull: Number(c.notnull),
    dflt_value: c.dflt_value,
    pk: Number(c.pk),
  }));
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

const manager: AuthUser = {
  id: 1,
  userType: "staff",
  displayName: "Manager",
  email: "manager@example.com",
  role: "manager",
  staffId: 1,
  residentId: null,
  sessionId: 1,
};

function seedFoundation(db: Database) {
  run(db, `INSERT INTO roles (code, name, is_system) VALUES ('manager', 'Manager', 1)`);
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
  run(db, `INSERT INTO beds (room_id, bed_code, label, status) VALUES (?, 'ARCHIVED-B', 'X', 'archived')`, [daisy.id]);

  run(db, `INSERT INTO users (email, phone, display_name, user_type, status)
    VALUES ('ac.resident@example.com', '+233200000001', 'AC Resident', 'resident', 'active')`);
  run(db, `INSERT INTO users (email, phone, display_name, user_type, status)
    VALUES ('cy.resident@example.com', '+233200000002', 'CY Resident', 'resident', 'active')`);
  run(db, `INSERT INTO users (email, phone, display_name, user_type, status)
    VALUES ('st.resident@example.com', '+233200000003', 'ST Resident', 'resident', 'active')`);

  const inst = get<{ id: number }>(db, `SELECT id FROM institutions WHERE code = 'UG'`)!;
  run(db, `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, gender, status, resident_kind)
    SELECT id, ?, 'UG-AC-1', 'Ama', 'Calendar', 'female', 'resident', 'student' FROM users WHERE email = 'ac.resident@example.com'`, [inst.id]);
  run(db, `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, gender, status, resident_kind, ghana_card_number)
    SELECT id, NULL, NULL, 'Kojo', 'Year', 'female', 'resident', 'non_student', 'GHA-123456789-0' FROM users WHERE email = 'cy.resident@example.com'`);
  run(db, `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, gender, status, resident_kind, ghana_card_number)
    SELECT id, NULL, NULL, 'Efua', 'Short', 'female', 'resident', 'non_student', 'GHA-987654321-0' FROM users WHERE email = 'st.resident@example.com'`);

  const session = get<{ id: number }>(db, `SELECT id FROM academic_sessions WHERE code = '2026-2027'`)!;
  run(db, `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
    VALUES ('academic_calendar', 'AC-2026', 'AC 2026', '2026-09-01', '2027-06-30', 'active', ?)`, [session.id]);
  run(db, `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
    VALUES ('calendar_year', 'CY-2026', 'CY 2026', '2026-01-01', '2026-12-31', 'active', NULL)`);
  run(db, `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
    VALUES ('short_term', 'ST-2026-Q1', 'ST Q1', '2026-01-01', '2026-03-31', 'active', NULL)`);

  run(db, `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status)
    SELECT id, 2, 'AC-2', 250000, 'GHS', 'active' FROM lease_periods WHERE code = 'AC-2026'`);
  run(db, `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status)
    SELECT id, 2, 'CY-2', 300000, 'GHS', 'active' FROM lease_periods WHERE code = 'CY-2026'`);
  run(db, `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status)
    SELECT id, 2, 'ST-2', 150000, 'GHS', 'active' FROM lease_periods WHERE code = 'ST-2026-Q1'`);

  run(db, `INSERT INTO room_rates (room_id, academic_session_id, rate_code, amount_minor, currency, status)
    VALUES (?, ?, 'DAISY-LEGACY', 250000, 'GHS', 'active')`, [daisy.id, session.id]);
}

describe("date helpers", () => {
  it("implements inclusive overlap and day-before", () => {
    expect(allocationIntervalsOverlap("2026-01-01", "2026-03-31", "2026-04-01", "2026-06-30")).toBe(false);
    expect(allocationIntervalsOverlap("2026-01-01", "2026-03-31", "2026-03-31", "2026-06-30")).toBe(true);
    expect(allocationIntervalsOverlap("2026-01-01", "2026-03-31", "2026-03-15", "2026-06-30")).toBe(true);
    expect(allocationIntervalsOverlap("2026-01-01", "2026-03-31", "2025-12-01", "2026-01-01")).toBe(true);
    expect(allocationIntervalsOverlap("2026-01-01", null, "2026-04-01", "2026-06-30")).toBe(true);
    expect(dayBeforeIsoDate("2026-04-01")).toBe("2026-03-31");
  });
});

describe("migration 0019 preservation", () => {
  it("lists 0019 after 0018 and makes academic_session_id nullable without column loss", async () => {
    const files = listMigrationFiles();
    expect(files).toContain(MIGRATION_0019);
    expect(files.indexOf(MIGRATION_0019)).toBeGreaterThan(files.indexOf(THROUGH_0018));

    const db = await openMigratedDatabase(THROUGH_0018);
    seedFoundation(db);

    const session = get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!;
    const resident = get<{ id: number }>(db, `SELECT id FROM residents WHERE first_name = 'Ama'`)!;
    const bed = get<{ id: number }>(db, `SELECT id FROM beds WHERE bed_code = 'DAISY-B1'`)!;
    const daisy = get<{ id: number }>(db, `SELECT id FROM rooms WHERE room_code = 'DAISY'`)!;
    const acPeriod = get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'AC-2026'`)!;

    run(db, `INSERT INTO bookings (
      resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
      priced_room_id, lease_period_id, lease_kind, starts_on, ends_on
    ) VALUES (?, ?, 'KSM-BKG-PRESERVE', 'confirmed', 250000, 'GHS', ?, ?, 'academic_calendar', '2026-09-01', '2027-06-30')`, [
      resident.id, session.id, daisy.id, acPeriod.id,
    ]);
    const booking = get<{ id: number }>(db, `SELECT id FROM bookings WHERE booking_number = 'KSM-BKG-PRESERVE'`)!;

    run(db, `INSERT INTO allocations (
      booking_id, resident_id, academic_session_id, bed_id, status, starts_on, ends_on,
      assigned_by_staff_id, assigned_at, notes
    ) VALUES (?, ?, ?, ?, 'active', '2026-09-01', '2027-06-30', 1, '2026-09-01T10:00:00.000Z', 'PRESERVE_NOTE_2LH')`, [
      booking.id, resident.id, session.id, bed.id,
    ]);

    const beforeCols = tableInfo(db);
    const beforeRow = get<Record<string, unknown>>(db, `SELECT * FROM allocations WHERE notes = 'PRESERVE_NOTE_2LH'`)!;
    expect(beforeCols.find((c) => c.name === "academic_session_id")?.notnull).toBe(1);

    // Multi-statement migration must not pass bind params (sql.js would stop early).
    db.run(readMigrationSql(MIGRATION_0019));

    const afterCols = tableInfo(db);
    expect(afterCols.map((c) => c.name).sort()).toEqual(beforeCols.map((c) => c.name).sort());
    expect(afterCols.find((c) => c.name === "academic_session_id")?.notnull).toBe(0);

    const afterRow = get<Record<string, unknown>>(db, `SELECT * FROM allocations WHERE notes = 'PRESERVE_NOTE_2LH'`)!;
    expect(afterRow).toMatchObject({
      booking_id: beforeRow.booking_id,
      resident_id: beforeRow.resident_id,
      academic_session_id: beforeRow.academic_session_id,
      bed_id: beforeRow.bed_id,
      status: "active",
      starts_on: "2026-09-01",
      ends_on: "2027-06-30",
      assigned_by_staff_id: 1,
      notes: "PRESERVE_NOTE_2LH",
    });
    expect(String(afterRow.assigned_at)).toContain("2026-09-01");

    // Null-session CY allocation persists after 0019.
    const cyResident = get<{ id: number }>(db, `SELECT id FROM residents WHERE first_name = 'Kojo'`)!;
    const cyPeriod = get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'CY-2026'`)!;
    const bed2 = get<{ id: number }>(db, `SELECT id FROM beds WHERE bed_code = 'DAISY-B2'`)!;
    run(db, `INSERT INTO bookings (
      resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
      priced_room_id, lease_period_id, lease_kind, starts_on, ends_on
    ) VALUES (?, NULL, 'KSM-BKG-CY-NULL', 'confirmed', 300000, 'GHS', ?, ?, 'calendar_year', '2026-01-01', '2026-12-31')`, [
      cyResident.id, daisy.id, cyPeriod.id,
    ]);
    const cyBooking = get<{ id: number }>(db, `SELECT id FROM bookings WHERE booking_number = 'KSM-BKG-CY-NULL'`)!;
    run(db, `INSERT INTO allocations (
      booking_id, resident_id, academic_session_id, bed_id, status, starts_on, ends_on
    ) VALUES (?, ?, NULL, ?, 'active', '2026-01-01', '2026-03-31')`, [
      cyBooking.id, cyResident.id, bed2.id,
    ]);
    const cyAlloc = get<Record<string, unknown>>(db, `SELECT * FROM allocations WHERE booking_id = ?`, [cyBooking.id])!;
    expect(cyAlloc.academic_session_id).toBeNull();
    expect(cyAlloc.status).toBe("active");
  });
});

describe("agreement-aware allocations (live sql.js)", () => {
  let db: Database;
  let svc: AdminService;
  let daisyId: number;
  let daisyB1: number;
  let daisyB2: number;
  let roseB1: number;
  let acResidentId: number;
  let cyResidentId: number;
  let stResidentId: number;
  let sessionId: number;
  let acPeriodId: number;
  let cyPeriodId: number;
  let stPeriodId: number;

  beforeEach(async () => {
    db = await openMigratedDatabase(); // through 0019
    seedFoundation(db);
    svc = new AdminService(new AdminRepository(createSqlJsD1(db)));

    daisyId = Number(get<{ id: number }>(db, `SELECT id FROM rooms WHERE room_code = 'DAISY'`)!.id);
    daisyB1 = Number(get<{ id: number }>(db, `SELECT id FROM beds WHERE bed_code = 'DAISY-B1'`)!.id);
    daisyB2 = Number(get<{ id: number }>(db, `SELECT id FROM beds WHERE bed_code = 'DAISY-B2'`)!.id);
    roseB1 = Number(get<{ id: number }>(db, `SELECT id FROM beds WHERE bed_code = 'ROSE-B1'`)!.id);
    acResidentId = Number(get<{ id: number }>(db, `SELECT id FROM residents WHERE first_name = 'Ama'`)!.id);
    cyResidentId = Number(get<{ id: number }>(db, `SELECT id FROM residents WHERE first_name = 'Kojo'`)!.id);
    stResidentId = Number(get<{ id: number }>(db, `SELECT id FROM residents WHERE first_name = 'Efua'`)!.id);
    sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
    acPeriodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'AC-2026'`)!.id);
    cyPeriodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'CY-2026'`)!.id);
    stPeriodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'ST-2026-Q1'`)!.id);
  });

  function insertConfirmedBooking(opts: {
    number: string;
    residentId: number;
    sessionId: number | null;
    periodId: number;
    kind: string;
    starts: string;
    ends: string;
    amount: number;
    roomId?: number;
  }) {
    run(db, `INSERT INTO bookings (
      resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
      priced_room_id, lease_period_id, lease_kind, starts_on, ends_on
    ) VALUES (?, ?, ?, 'confirmed', ?, 'GHS', ?, ?, ?, ?, ?)`, [
      opts.residentId,
      opts.sessionId,
      opts.number,
      opts.amount,
      opts.roomId ?? daisyId,
      opts.periodId,
      opts.kind,
      opts.starts,
      opts.ends,
    ]);
    return Number(get<{ id: number }>(db, `SELECT id FROM bookings WHERE booking_number = ?`, [opts.number])!.id);
  }

  it("allocates AC with session context and CY/ST with null session", async () => {
    const acId = insertConfirmedBooking({
      number: "KSM-BKG-AC", residentId: acResidentId, sessionId, periodId: acPeriodId,
      kind: "academic_calendar", starts: "2026-09-01", ends: "2027-06-30", amount: 250000,
    });
    const cyId = insertConfirmedBooking({
      number: "KSM-BKG-CY", residentId: cyResidentId, sessionId: null, periodId: cyPeriodId,
      kind: "calendar_year", starts: "2026-01-01", ends: "2026-12-31", amount: 300000,
    });
    const stId = insertConfirmedBooking({
      number: "KSM-BKG-ST", residentId: stResidentId, sessionId: null, periodId: stPeriodId,
      kind: "short_term", starts: "2026-01-01", ends: "2026-03-31", amount: 150000,
    });

    const ac = await svc.createAllocation(manager, {
      bookingId: acId, bedId: daisyB1, startsOn: "2026-09-01", endsOn: "2027-06-30",
    }) as Record<string, unknown>;
    expect(ac).toMatchObject({ status: "active", academic_session_id: sessionId, bed_id: daisyB1 });

    const st = await svc.createAllocation(manager, {
      bookingId: stId, bedId: daisyB2, startsOn: "2026-01-01", endsOn: "2026-03-31",
    }) as Record<string, unknown>;
    expect(st).toMatchObject({ status: "active", academic_session_id: null, bed_id: daisyB2 });

    // CY on daisyB2 after ST spell ends: end ST first (one-active-per-bed defense-in-depth), then allocate.
    await svc.updateAllocationStatus(manager, Number(st.id), "ended");
    run(db, `UPDATE allocations SET ends_on = '2026-03-31' WHERE id = ?`, [st.id]);
    await expect(svc.createAllocation(manager, {
      bookingId: cyId, bedId: daisyB2, startsOn: "2026-04-01", endsOn: "2026-12-31",
    })).resolves.toMatchObject({ status: "active", academic_session_id: null });
  });

  it("supports mixed lease types in the same room on different beds", async () => {
    const cyId = insertConfirmedBooking({
      number: "KSM-BKG-MIX-CY", residentId: cyResidentId, sessionId: null, periodId: cyPeriodId,
      kind: "calendar_year", starts: "2026-01-01", ends: "2026-12-31", amount: 300000,
    });
    const stId = insertConfirmedBooking({
      number: "KSM-BKG-MIX-ST", residentId: stResidentId, sessionId: null, periodId: stPeriodId,
      kind: "short_term", starts: "2026-01-01", ends: "2026-03-31", amount: 150000,
    });
    await expect(svc.createAllocation(manager, {
      bookingId: cyId, bedId: daisyB1, startsOn: "2026-01-01", endsOn: "2026-12-31",
    })).resolves.toMatchObject({ status: "active", academic_session_id: null, bed_id: daisyB1 });
    await expect(svc.createAllocation(manager, {
      bookingId: stId, bedId: daisyB2, startsOn: "2026-01-01", endsOn: "2026-03-31",
    })).resolves.toMatchObject({ status: "active", academic_session_id: null, bed_id: daisyB2 });
  });

  it("enforces bed overlap matrix", async () => {
    const holder = insertConfirmedBooking({
      number: "KSM-BKG-HOLD", residentId: acResidentId, sessionId, periodId: acPeriodId,
      kind: "academic_calendar", starts: "2026-01-01", ends: "2026-12-31", amount: 250000,
    });
    // Use AC booking but custom dates inside agreement
    const holderAlloc = await svc.createAllocation(manager, {
      bookingId: holder, bedId: daisyB1, startsOn: "2026-01-01", endsOn: "2026-03-31",
    }) as Record<string, unknown>;

    const challenger = insertConfirmedBooking({
      number: "KSM-BKG-CHAL", residentId: cyResidentId, sessionId: null, periodId: cyPeriodId,
      kind: "calendar_year", starts: "2026-01-01", ends: "2026-12-31", amount: 300000,
    });

    // Overlap while holder still active → reject
    await expect(svc.createAllocation(manager, {
      bookingId: challenger, bedId: daisyB1, startsOn: "2026-03-15", endsOn: "2026-06-30",
    })).rejects.toThrow("Unavailable bed");
    await expect(svc.createAllocation(manager, {
      bookingId: challenger, bedId: daisyB1, startsOn: "2026-03-31", endsOn: "2026-06-30",
    })).rejects.toThrow("Unavailable bed");

    // End holder spell, keep ends_on=Mar31 for historical overlap checks
    await svc.updateAllocationStatus(manager, Number(holderAlloc.id), "ended");
    run(db, `UPDATE allocations SET ends_on = '2026-03-31' WHERE id = ?`, [holderAlloc.id]);

    // Apr 1 after Mar 31 → ALLOW
    await expect(svc.createAllocation(manager, {
      bookingId: challenger, bedId: daisyB1, startsOn: "2026-04-01", endsOn: "2026-06-30",
    })).resolves.toMatchObject({ status: "active" });

    const activeChal = get<{ id: number }>(db, `SELECT id FROM allocations WHERE booking_id = ? AND status = 'active'`, [challenger])!;
    await svc.updateAllocationStatus(manager, Number(activeChal.id), "ended");
    run(db, `UPDATE allocations SET ends_on = '2026-06-30' WHERE id = ?`, [activeChal.id]);

    const probe = insertConfirmedBooking({
      number: "KSM-BKG-PROBE", residentId: stResidentId, sessionId: null, periodId: stPeriodId,
      kind: "short_term", starts: "2026-01-01", ends: "2026-06-30", amount: 150000,
    });
    // Historical ended holder Jan1–Mar31 still blocks inclusive Mar31 start
    await expect(svc.createAllocation(manager, {
      bookingId: probe, bedId: daisyB1, startsOn: "2026-03-31", endsOn: "2026-06-30",
    })).rejects.toThrow("Unavailable bed");
    await expect(svc.createAllocation(manager, {
      bookingId: probe, bedId: daisyB1, startsOn: "2025-12-01", endsOn: "2026-01-01",
    })).rejects.toThrow(/Unavailable bed|Allocation starts before agreement/);
  });

  it("rejects open-ended bed conflict", async () => {
    const openBooking = insertConfirmedBooking({
      number: "KSM-BKG-OPEN2", residentId: cyResidentId, sessionId: null, periodId: cyPeriodId,
      kind: "calendar_year", starts: "2026-01-01", ends: "2026-12-31", amount: 300000,
    });
    run(db, `UPDATE bookings SET ends_on = NULL WHERE id = ?`, [openBooking]);
    await svc.createAllocation(manager, {
      bookingId: openBooking, bedId: daisyB1, startsOn: "2026-01-01", endsOn: null,
    });

    const probe = insertConfirmedBooking({
      number: "KSM-BKG-OPEN3", residentId: stResidentId, sessionId: null, periodId: stPeriodId,
      kind: "short_term", starts: "2026-01-01", ends: "2026-06-30", amount: 150000,
    });
    await expect(svc.createAllocation(manager, {
      bookingId: probe, bedId: daisyB1, startsOn: "2026-04-01", endsOn: "2026-06-30",
    })).rejects.toThrow("Unavailable bed");
  });

  it("rejects overlapping resident occupancy on a different bed", async () => {
    const a = insertConfirmedBooking({
      number: "KSM-BKG-OPEN", residentId: acResidentId, sessionId, periodId: acPeriodId,
      kind: "academic_calendar", starts: "2026-01-01", ends: "2027-06-30", amount: 250000,
    });
    const firstAlloc = await svc.createAllocation(manager, {
      bookingId: a, bedId: daisyB2, startsOn: "2026-01-01", endsOn: "2026-03-31",
    }) as Record<string, unknown>;

    await expect(svc.createAllocation(manager, {
      bookingId: a, bedId: daisyB1, startsOn: "2026-02-01", endsOn: "2026-02-28",
    })).rejects.toThrow("Resident already allocated");

    await svc.updateAllocationStatus(manager, Number(firstAlloc.id), "ended");
    run(db, `UPDATE allocations SET ends_on = '2026-03-31' WHERE id = ?`, [firstAlloc.id]);
    await expect(svc.createAllocation(manager, {
      bookingId: a, bedId: daisyB1, startsOn: "2026-04-01", endsOn: "2027-06-30",
    })).resolves.toMatchObject({ status: "active" });
  });

  it("rejects bed outside approved room and archived beds", async () => {
    const id = insertConfirmedBooking({
      number: "KSM-BKG-ROOM", residentId: acResidentId, sessionId, periodId: acPeriodId,
      kind: "academic_calendar", starts: "2026-09-01", ends: "2027-06-30", amount: 250000,
    });
    await expect(svc.createAllocation(manager, {
      bookingId: id, bedId: roseB1, startsOn: "2026-09-01", endsOn: "2027-06-30",
    })).rejects.toThrow("Bed must belong to the approved booking room");

    const archived = Number(get<{ id: number }>(db, `SELECT id FROM beds WHERE bed_code = 'ARCHIVED-B'`)!.id);
    await expect(svc.createAllocation(manager, {
      bookingId: id, bedId: archived, startsOn: "2026-09-01", endsOn: "2027-06-30",
    })).rejects.toThrow("Inactive bed");
  });

  it("rejects allocation dates outside agreement window", async () => {
    const id = insertConfirmedBooking({
      number: "KSM-BKG-DATES", residentId: cyResidentId, sessionId: null, periodId: cyPeriodId,
      kind: "calendar_year", starts: "2026-01-01", ends: "2026-12-31", amount: 300000,
    });
    await expect(svc.createAllocation(manager, {
      bookingId: id, bedId: daisyB1, startsOn: "2025-12-01", endsOn: "2026-06-30",
    })).rejects.toThrow("Allocation starts before agreement period");
    await expect(svc.createAllocation(manager, {
      bookingId: id, bedId: daisyB1, startsOn: "2026-01-01", endsOn: "2027-01-31",
    })).rejects.toThrow("Allocation ends after agreement period");
    await expect(svc.createAllocation(manager, {
      bookingId: id, bedId: daisyB1, startsOn: "2026-06-01", endsOn: "2026-05-01",
    })).rejects.toThrow(/starts_on must be <= ends_on/);
  });

  it("transfers CY/ST without session and preserves history; destination overlap rejected", async () => {
    const cyId = insertConfirmedBooking({
      number: "KSM-BKG-XFER", residentId: cyResidentId, sessionId: null, periodId: cyPeriodId,
      kind: "calendar_year", starts: "2026-01-01", ends: "2026-12-31", amount: 300000,
    });
    const first = await svc.createAllocation(manager, {
      bookingId: cyId, bedId: daisyB1, startsOn: "2026-01-01", endsOn: "2026-12-31",
    }) as Record<string, unknown>;

    const moved = await svc.transferAllocation(manager, Number(first.id), {
      destinationBedId: daisyB2, startsOn: "2026-04-01",
    }) as Record<string, unknown>;
    expect(moved).toMatchObject({ status: "active", bed_id: daisyB2, academic_session_id: null });
    const prior = get<Record<string, unknown>>(db, `SELECT * FROM allocations WHERE id = ?`, [first.id])!;
    expect(prior.status).toBe("transferred");
    expect(prior.ends_on).toBe("2026-03-31");

    // Destination occupied by ST
    const stId = insertConfirmedBooking({
      number: "KSM-BKG-DEST", residentId: stResidentId, sessionId: null, periodId: stPeriodId,
      kind: "short_term", starts: "2026-01-01", ends: "2026-06-30", amount: 150000,
    });
    await svc.createAllocation(manager, {
      bookingId: stId, bedId: daisyB1, startsOn: "2026-04-01", endsOn: "2026-06-30",
    });
    await expect(svc.transferAllocation(manager, Number(moved.id), {
      destinationBedId: daisyB1, startsOn: "2026-05-01",
    })).rejects.toThrow("Unavailable bed");

    // Cross-room flexible rejected
    await expect(svc.transferAllocation(manager, Number(moved.id), {
      destinationBedId: roseB1, startsOn: "2026-07-01",
    })).rejects.toThrow(/cross-room transfer/);
  });

  it("availabilityForAgreement is date-based without room_rates for Path B", async () => {
    const cyId = insertConfirmedBooking({
      number: "KSM-BKG-AVAIL", residentId: cyResidentId, sessionId: null, periodId: cyPeriodId,
      kind: "calendar_year", starts: "2026-01-01", ends: "2026-12-31", amount: 300000,
    });
    // Occupy B1 for Q1
    const stId = insertConfirmedBooking({
      number: "KSM-BKG-OCC", residentId: stResidentId, sessionId: null, periodId: stPeriodId,
      kind: "short_term", starts: "2026-01-01", ends: "2026-03-31", amount: 150000,
    });
    await svc.createAllocation(manager, {
      bookingId: stId, bedId: daisyB1, startsOn: "2026-01-01", endsOn: "2026-03-31",
    });

    const q1 = await svc.availabilityForAgreement(cyId, "2026-01-01", "2026-03-31") as Array<Record<string, unknown>>;
    expect(q1.map((b) => b.bed_code)).toEqual(["DAISY-B2"]);
    expect(q1.every((b) => b.room_code === "DAISY")).toBe(true);

    const q2 = await svc.availabilityForAgreement(cyId, "2026-04-01", "2026-06-30") as Array<Record<string, unknown>>;
    expect(q2.map((b) => b.bed_code).sort()).toEqual(["DAISY-B1", "DAISY-B2"]);
  });

  it("general occupancy includes CY/ST; session-scoped excludes them", async () => {
    const cyId = insertConfirmedBooking({
      number: "KSM-BKG-REP", residentId: cyResidentId, sessionId: null, periodId: cyPeriodId,
      kind: "calendar_year", starts: "2026-01-01", ends: "2026-12-31", amount: 300000,
    });
    await svc.createAllocation(manager, {
      bookingId: cyId, bedId: daisyB1, startsOn: "2026-01-01", endsOn: "2026-12-31",
    });
    const allOcc = await svc.occupancyReport(null) as Record<string, unknown>;
    expect(Number(allOcc.occupied_beds)).toBeGreaterThanOrEqual(1);
    const sessionOcc = await svc.occupancyReport(sessionId) as Record<string, unknown>;
    expect(Number(sessionOcc.occupied_beds)).toBe(0);
  });
});
