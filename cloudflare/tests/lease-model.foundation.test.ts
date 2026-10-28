import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import {
  all,
  expectReject,
  get,
  listMigrationFiles,
  openMigratedDatabase,
  run,
} from "./apply-migrations";
import {
  isLeaseKind,
  isRateCardOccupancyCapacity,
  LEASE_KINDS,
  RATE_CARD_OCCUPANCY_CAPACITIES,
} from "../src/types/lease-model";

function seedMinimalBookingGraph(db: Database) {
  run(
    db,
    `INSERT INTO users (email, phone, display_name, user_type, status)
     VALUES ('foundation.resident@example.com', '+233000001001', 'Foundation Resident', 'resident', 'active')`,
  );
  run(db, `INSERT INTO institutions (code, name, status) VALUES ('FOUND-UNI', 'Foundation University', 'active')`);
  run(
    db,
    `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, gender, status)
     SELECT id, (SELECT id FROM institutions WHERE code = 'FOUND-UNI'), 'FOUND-STU-1', 'Foundation', 'Resident', 'female', 'applicant'
     FROM users WHERE email = 'foundation.resident@example.com'`,
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

describe("Stage 2L-B schema foundation", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openMigratedDatabase();
  });

  it("applies migrations 0013–0015 after immutable 0001–0012", () => {
    const files = listMigrationFiles();
    expect(files.slice(0, 12)).toEqual([
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
    ]);
    expect(files).toContain("0013_lease_periods_and_kinds.sql");
    expect(files).toContain("0014_rate_cards.sql");
    expect(files).toContain("0015_booking_agreement_terms.sql");

    const tables = all<{ name: string }>(
      db,
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('lease_periods', 'rate_cards') ORDER BY name`,
    ).map((row) => row.name);
    expect(tables).toEqual(["lease_periods", "rate_cards"]);

    const bookingCols = all<{ name: string }>(db, `PRAGMA table_info(bookings)`).map((row) => row.name);
    for (const col of [
      "lease_period_id",
      "lease_kind",
      "starts_on",
      "ends_on",
      "maintenance_fee_minor",
      "payment_requirement_type",
      "payment_fixed_amount_minor",
      "payment_percentage_basis_points",
      "partial_payment_authorized",
      "prior_booking_id",
      "override_reason",
      "total_amount_minor",
    ]) {
      expect(bookingCols).toContain(col);
    }
  });

  describe("lease_periods", () => {
    it("accepts academic_calendar, calendar_year, and short_term", () => {
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('academic_calendar', 'AC-2026', 'Academic 2026/27', '2026-09-01', '2027-06-30', 'draft')`,
      );
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('calendar_year', 'CY-2027', 'Calendar Year 2027', '2027-01-01', '2027-12-31', 'draft')`,
      );
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('short_term', 'ST-2026-Q4', 'Short-Term Q4 2026', '2026-10-01', '2026-12-31', 'draft')`,
      );

      const kinds = all<{ kind: string }>(db, `SELECT kind FROM lease_periods ORDER BY code`).map((r) => r.kind);
      expect(kinds).toEqual(["academic_calendar", "calendar_year", "short_term"]);
      expect(LEASE_KINDS.every(isLeaseKind)).toBe(true);
    });

    it("rejects invalid kind and invalid date range", () => {
      const kindErr = expectReject(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('semester', 'BAD-KIND', 'Bad', '2026-01-01', '2026-06-30', 'draft')`,
      );
      expect(kindErr.toLowerCase()).toMatch(/constraint|check/i);

      const dateErr = expectReject(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('short_term', 'BAD-DATES', 'Bad Dates', '2026-12-31', '2026-10-01', 'draft')`,
      );
      expect(dateErr.toLowerCase()).toMatch(/constraint|check/i);
    });

    it("allows concurrent different lease-period kinds without fake academic_sessions", () => {
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES
           ('calendar_year', 'CY-A', 'CY A', '2026-01-01', '2026-12-31', 'active'),
           ('short_term', 'ST-A', 'ST A', '2026-03-01', '2026-05-31', 'active')`,
      );
      const count = get<{ c: number }>(db, `SELECT COUNT(*) AS c FROM lease_periods`);
      expect(Number(count?.c)).toBe(2);
      expect(
        get<{ c: number }>(db, `SELECT COUNT(*) AS c FROM academic_sessions`)?.c ?? 0,
      ).toBe(0);
    });

    it("links academic_calendar periods to academic_sessions optionally and rejects CY/ST links", () => {
      seedMinimalBookingGraph(db);
      const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);

      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
         VALUES ('academic_calendar', 'AC-LINK', 'Linked AC', '2026-09-01', '2027-06-30', 'draft', ?)`,
        [sessionId],
      );

      const cyErr = expectReject(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
         VALUES ('calendar_year', 'CY-LINK', 'Bad Link', '2027-01-01', '2027-12-31', 'draft', ?)`,
        [sessionId],
      );
      expect(cyErr.toLowerCase()).toMatch(/constraint|check/i);
    });
  });

  describe("rate_cards", () => {
    beforeEach(() => {
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('academic_calendar', 'AC-RATES', 'Academic Rates', '2026-09-01', '2027-06-30', 'active')`,
      );
    });

    it("accepts occupancy 1, 2, and 4 with integer minor units", () => {
      const periodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'AC-RATES'`)!.id);
      for (const [capacity, amount, code] of [
        [1, 900000, "AC-1P"],
        [2, 600000, "AC-2P"],
        [4, 450000, "AC-4P"],
      ] as const) {
        expect(isRateCardOccupancyCapacity(capacity)).toBe(true);
        run(
          db,
          `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status)
           VALUES (?, ?, ?, ?, 'GHS', 'active')`,
          [periodId, capacity, code, amount],
        );
      }
      expect(RATE_CARD_OCCUPANCY_CAPACITIES).toEqual([1, 2, 4]);
      const rows = all<{ occupancy_capacity: number; amount_minor: number }>(
        db,
        `SELECT occupancy_capacity, amount_minor FROM rate_cards ORDER BY occupancy_capacity`,
      );
      expect(rows.map((r) => [Number(r.occupancy_capacity), Number(r.amount_minor)])).toEqual([
        [1, 900000],
        [2, 600000],
        [4, 450000],
      ]);
    });

    it("rejects unsupported occupancy and non-positive amounts", () => {
      const periodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'AC-RATES'`)!.id);
      const occErr = expectReject(
        db,
        `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, status)
         VALUES (?, 3, 'AC-3P', 500000, 'active')`,
        [periodId],
      );
      expect(occErr.toLowerCase()).toMatch(/constraint|check/i);

      const amtErr = expectReject(
        db,
        `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, status)
         VALUES (?, 1, 'AC-ZERO', 0, 'active')`,
        [periodId],
      );
      expect(amtErr.toLowerCase()).toMatch(/constraint|check/i);
    });

    it("enforces one active rate card per period/occupancy and keeps cards independent of booking snapshots", () => {
      seedMinimalBookingGraph(db);
      const periodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'AC-RATES'`)!.id);
      run(
        db,
        `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, status)
         VALUES (?, 1, 'AC-1P-A', 900000, 'active')`,
        [periodId],
      );
      const dupErr = expectReject(
        db,
        `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, status)
         VALUES (?, 1, 'AC-1P-B', 950000, 'active')`,
        [periodId],
      );
      expect(dupErr.toLowerCase()).toMatch(/unique|constraint/i);

      // Draft duplicate occupancy is allowed (not active).
      run(
        db,
        `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, status)
         VALUES (?, 1, 'AC-1P-DRAFT', 880000, 'draft')`,
        [periodId],
      );

      const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
      const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
      run(
        db,
        `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
         VALUES (?, ?, 'KSM-BKG-FOUND-1', 'pending', 900000, 'GHS')`,
        [residentId, sessionId],
      );

      run(db, `UPDATE rate_cards SET amount_minor = 999999, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rate_code = 'AC-1P-A'`);
      const booking = get<{ total_amount_minor: number }>(
        db,
        `SELECT total_amount_minor FROM bookings WHERE booking_number = 'KSM-BKG-FOUND-1'`,
      );
      expect(Number(booking?.total_amount_minor)).toBe(900000);
    });

    it("stores optional short-term package_months on rate cards", () => {
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('short_term', 'ST-PKG', 'ST Package', '2026-10-01', '2026-12-31', 'active')`,
      );
      const periodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'ST-PKG'`)!.id);
      run(
        db,
        `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, package_months, status)
         VALUES (?, 1, 'ST-3M', 350000, 3, 'active')`,
        [periodId],
      );
      expect(Number(get<{ package_months: number }>(db, `SELECT package_months FROM rate_cards WHERE rate_code = 'ST-3M'`)?.package_months)).toBe(3);
    });
  });

  describe("booking agreement foundation", () => {
    beforeEach(() => {
      seedMinimalBookingGraph(db);
      run(
        db,
        `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
         VALUES ('academic_calendar', 'AC-BOOK', 'Academic Book', '2026-09-01', '2027-06-30', 'active')`,
      );
    });

    it("keeps existing booking creation compatible with nullable agreement columns", () => {
      const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
      const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
      run(
        db,
        `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
         VALUES (?, ?, 'KSM-BKG-COMPAT-1', 'pending', 250000, 'GHS')`,
        [residentId, sessionId],
      );
      const row = get<Record<string, unknown>>(
        db,
        `SELECT total_amount_minor, lease_period_id, lease_kind, starts_on, ends_on, maintenance_fee_minor,
                payment_requirement_type, partial_payment_authorized, prior_booking_id, override_reason
         FROM bookings WHERE booking_number = 'KSM-BKG-COMPAT-1'`,
      );
      expect(Number(row?.total_amount_minor)).toBe(250000);
      expect(row?.lease_period_id).toBeNull();
      expect(row?.lease_kind).toBeNull();
      expect(row?.starts_on).toBeNull();
      expect(row?.ends_on).toBeNull();
      expect(row?.maintenance_fee_minor).toBeNull();
      expect(row?.payment_requirement_type).toBeNull();
      expect(Number(row?.partial_payment_authorized)).toBe(0);
      expect(row?.prior_booking_id).toBeNull();
      expect(row?.override_reason).toBeNull();
    });

    it("snapshots lease period, dates, maintenance fee, partial-pay fields, and renewal lineage", () => {
      const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
      const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
      const periodId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'AC-BOOK'`)!.id);

      run(
        db,
        `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
         VALUES (?, ?, 'KSM-BKG-PRIOR-1', 'completed', 600000, 'GHS')`,
        [residentId, sessionId],
      );
      const priorId = Number(get<{ id: number }>(db, `SELECT id FROM bookings WHERE booking_number = 'KSM-BKG-PRIOR-1'`)!.id);

      // Unique active booking per resident/session — prior is completed, so new pending is OK.
      run(
        db,
        `INSERT INTO bookings (
           resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
           lease_period_id, lease_kind, starts_on, ends_on, maintenance_fee_minor,
           payment_requirement_type, payment_fixed_amount_minor, payment_percentage_basis_points,
           partial_payment_authorized, prior_booking_id, override_reason
         ) VALUES (?, ?, 'KSM-BKG-AGREE-1', 'pending', 600000, 'GHS',
           ?, 'academic_calendar', '2026-09-01', '2027-06-30', 50000,
           'fixed', 300000, NULL, 1, ?, 'Manager authorized half-upfront')`,
        [residentId, sessionId, periodId, priorId],
      );

      const row = get<Record<string, unknown>>(
        db,
        `SELECT * FROM bookings WHERE booking_number = 'KSM-BKG-AGREE-1'`,
      );
      expect(Number(row?.lease_period_id)).toBe(periodId);
      expect(row?.lease_kind).toBe("academic_calendar");
      expect(row?.starts_on).toBe("2026-09-01");
      expect(row?.ends_on).toBe("2027-06-30");
      expect(Number(row?.maintenance_fee_minor)).toBe(50000);
      expect(row?.payment_requirement_type).toBe("fixed");
      expect(Number(row?.payment_fixed_amount_minor)).toBe(300000);
      expect(Number(row?.partial_payment_authorized)).toBe(1);
      expect(Number(row?.prior_booking_id)).toBe(priorId);
      expect(row?.override_reason).toBe("Manager authorized half-upfront");
      expect(Number(row?.total_amount_minor)).toBe(600000);
    });

    it("rejects invalid agreement date ranges while leaving total_amount_minor historically stable", () => {
      const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
      const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
      run(
        db,
        `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency, starts_on, ends_on)
         VALUES (?, ?, 'KSM-BKG-DATES-1', 'pending', 400000, 'GHS', '2026-09-01', '2027-06-30')`,
        [residentId, sessionId],
      );

      const dateErr = expectReject(
        db,
        `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency, starts_on, ends_on)
         VALUES (?, ?, 'KSM-BKG-DATES-BAD', 'pending', 400000, 'GHS', '2027-06-30', '2026-09-01')`,
        [residentId, sessionId],
      );
      expect(dateErr).toMatch(/starts_on must be <= ends_on/i);

      expect(Number(get<{ total_amount_minor: number }>(db, `SELECT total_amount_minor FROM bookings WHERE booking_number = 'KSM-BKG-DATES-1'`)?.total_amount_minor)).toBe(400000);
    });
  });
});


describe("Stage 2L-G session-optional booking agreements", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openMigratedDatabase();
    seedMinimalBookingGraph(db);
  });

  it("includes migration 0018 and makes academic_session_id nullable", () => {
    const files = listMigrationFiles();
    expect(files).toContain("0018_session_optional_booking_agreements.sql");
    const col = all<{ name: string; notnull: number }>(
      db,
      `PRAGMA table_info(bookings)`,
    ).find((c) => c.name === "academic_session_id");
    expect(col).toBeTruthy();
    expect(Number(col?.notnull)).toBe(0);
  });

  it("preserves legacy booking with session and null lease fields after 0018", () => {
    const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
    const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
    run(
      db,
      `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
       VALUES (?, ?, 'KSM-BKG-LEGACY-G', 'pending', 250000, 'GHS')`,
      [residentId, sessionId],
    );
    const row = get<Record<string, unknown>>(
      db,
      `SELECT academic_session_id, lease_period_id, lease_kind, total_amount_minor FROM bookings WHERE booking_number = 'KSM-BKG-LEGACY-G'`,
    );
    expect(Number(row?.academic_session_id)).toBe(sessionId);
    expect(row?.lease_period_id).toBeNull();
    expect(row?.lease_kind).toBeNull();
    expect(Number(row?.total_amount_minor)).toBe(250000);
  });

  it("allows Calendar Year / Short-Term bookings with null academic_session_id", () => {
    const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
    run(
      db,
      `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
       VALUES ('calendar_year', 'CY-G', 'CY 2027', '2027-01-01', '2027-12-31', 'active')`,
    );
    run(
      db,
      `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
       VALUES ('short_term', 'ST-G', 'ST Q1', '2027-01-01', '2027-03-31', 'active')`,
    );
    const cyId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'CY-G'`)!.id);
    const stId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'ST-G'`)!.id);

    run(
      db,
      `INSERT INTO bookings (
         resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
         lease_period_id, lease_kind, starts_on, ends_on, maintenance_fee_minor
       ) VALUES (?, NULL, 'KSM-BKG-CY-G', 'pending', 900000, 'GHS', ?, 'calendar_year', '2027-01-01', '2027-12-31', 10000)`,
      [residentId, cyId],
    );
    run(
      db,
      `INSERT INTO bookings (
         resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
         lease_period_id, lease_kind, starts_on, ends_on, maintenance_fee_minor
       ) VALUES (?, NULL, 'KSM-BKG-ST-G', 'pending', 350000, 'GHS', ?, 'short_term', '2027-01-01', '2027-03-31', 5000)`,
      [residentId, stId],
    );

    const cy = get<Record<string, unknown>>(db, `SELECT * FROM bookings WHERE booking_number = 'KSM-BKG-CY-G'`);
    const st = get<Record<string, unknown>>(db, `SELECT * FROM bookings WHERE booking_number = 'KSM-BKG-ST-G'`);
    expect(cy?.academic_session_id).toBeNull();
    expect(cy?.lease_kind).toBe("calendar_year");
    expect(st?.academic_session_id).toBeNull();
    expect(st?.lease_kind).toBe("short_term");
  });

  it("rejects CY/ST booking that attaches an academic session", () => {
    const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
    const sessionId = Number(get<{ id: number }>(db, `SELECT id FROM academic_sessions`)!.id);
    run(
      db,
      `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
       VALUES ('short_term', 'ST-BAD', 'ST Bad', '2027-01-01', '2027-03-31', 'active')`,
    );
    const stId = Number(get<{ id: number }>(db, `SELECT id FROM lease_periods WHERE code = 'ST-BAD'`)!.id);
    const err = expectReject(
      db,
      `INSERT INTO bookings (
         resident_id, academic_session_id, booking_number, status, total_amount_minor, currency,
         lease_period_id, lease_kind, starts_on, ends_on
       ) VALUES (?, ?, 'KSM-BKG-ST-BAD', 'pending', 350000, 'GHS', ?, 'short_term', '2027-01-01', '2027-03-31')`,
      [residentId, sessionId, stId],
    );
    expect(err).toMatch(/CHECK|constraint/i);
  });

  it("rejects booking with neither session nor lease period", () => {
    const residentId = Number(get<{ id: number }>(db, `SELECT id FROM residents`)!.id);
    const err = expectReject(
      db,
      `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
       VALUES (?, NULL, 'KSM-BKG-EMPTY', 'pending', 100000, 'GHS')`,
      [residentId],
    );
    expect(err).toMatch(/CHECK|constraint/i);
  });
});
