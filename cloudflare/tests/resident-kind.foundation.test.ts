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

function seedGraph(db: Database) {
  run(
    db,
    `INSERT INTO users (email, phone, display_name, user_type, status)
     VALUES ('stu@example.com', '+233000002001', 'Student One', 'resident', 'active')`,
  );
  run(
    db,
    `INSERT INTO users (email, phone, display_name, user_type, status)
     VALUES ('non@example.com', '+233000002002', 'Non Student', 'resident', 'active')`,
  );
  run(db, `INSERT INTO institutions (code, name, status) VALUES ('UG', 'University of Ghana', 'active')`);
  run(
    db,
    `INSERT INTO academic_sessions (code, name, starts_on, ends_on, status)
     VALUES ('2026-2027', '2026/2027', '2026-09-01', '2027-06-30', 'active')`,
  );
  run(
    db,
    `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id)
     VALUES ('academic_calendar', 'AC-2026', 'Academic 2026', '2026-09-01', '2027-06-30', 'active', 1)`,
  );
  run(
    db,
    `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
     VALUES ('calendar_year', 'CY-2026', 'Calendar 2026', '2026-01-01', '2026-12-31', 'active')`,
  );
  run(
    db,
    `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status)
     VALUES ('short_term', 'ST-2026-Q1', 'Short Term Q1', '2026-01-01', '2026-03-31', 'active')`,
  );
}

describe("Stage 2L-F resident_kind and application flexibility schema", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openMigratedDatabase();
    seedGraph(db);
  });

  it("applies 0016 after immutable 0001–0015", () => {
    const files = listMigrationFiles();
    expect(files.slice(0, 15)).toEqual([
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
    ]);
    expect(files).toContain("0016_resident_kind_and_application_flexibility.sql");
    expect(files).toContain("0017_ghana_card_number_and_identity_realignment.sql");
    const cols = all<{ name: string }>(db, `PRAGMA table_info(residents)`).map((r) => r.name);
    expect(cols).toContain("resident_kind");
    const appCols = all<{ name: string }>(db, `PRAGMA table_info(applications)`).map((r) => r.name);
    expect(appCols).toEqual(expect.arrayContaining(["lease_period_id", "lease_kind", "academic_session_id"]));
    const sessionCol = all<{ name: string; notnull: number }>(db, `PRAGMA table_info(applications)`).find(
      (c) => c.name === "academic_session_id",
    );
    expect(sessionCol?.notnull).toBe(0);
  });

  it("accepts student and non_student residents with pair rules", () => {
    run(
      db,
      `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, status, resident_kind)
       VALUES (1, 1, 'STU-1', 'Student', 'One', 'applicant', 'student')`,
    );
    run(
      db,
      `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, status, resident_kind)
       VALUES (2, NULL, NULL, 'Non', 'Student', 'applicant', 'non_student')`,
    );
    expect(get<{ resident_kind: string }>(db, `SELECT resident_kind FROM residents WHERE student_id = 'STU-1'`)?.resident_kind).toBe("student");
    expect(get<{ resident_kind: string }>(db, `SELECT resident_kind FROM residents WHERE first_name = 'Non'`)?.resident_kind).toBe("non_student");

    // half-pair still rejected by legacy CHECK
    run(db, `INSERT INTO users (email, phone, display_name, user_type, status) VALUES ('half@example.com', '+233000002098', 'Half', 'resident', 'active')`);
    const msg = expectReject(
      db,
      `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, status, resident_kind)
       SELECT id, 1, NULL, 'Half', 'Pair', 'applicant', 'student' FROM users WHERE email = 'half@example.com'`,
    );
    expect(msg.toLowerCase()).toMatch(/check|constraint/);
  });

  it("allows CY/ST applications without academic_session and enforces uniqueness per lease period", () => {
    run(
      db,
      `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, status, resident_kind)
       VALUES (1, 1, 'STU-1', 'Student', 'One', 'applicant', 'student')`,
    );
    run(
      db,
      `INSERT INTO applications (resident_id, academic_session_id, lease_period_id, lease_kind, application_number, status)
       VALUES (1, NULL, 2, 'calendar_year', 'KSM-APP-0001', 'draft')`,
    );
    run(
      db,
      `INSERT INTO applications (resident_id, academic_session_id, lease_period_id, lease_kind, application_number, status)
       VALUES (1, NULL, 3, 'short_term', 'KSM-APP-0002', 'draft')`,
    );
    // duplicate active same lease period rejected
    const dup = expectReject(
      db,
      `INSERT INTO applications (resident_id, academic_session_id, lease_period_id, lease_kind, application_number, status)
       VALUES (1, NULL, 2, 'calendar_year', 'KSM-APP-0003', 'submitted')`,
    );
    expect(dup.toLowerCase()).toMatch(/unique/);

    // historical preserved: cancel then recreate allowed
    run(db, `UPDATE applications SET status = 'cancelled' WHERE application_number = 'KSM-APP-0001'`);
    run(
      db,
      `INSERT INTO applications (resident_id, academic_session_id, lease_period_id, lease_kind, application_number, status)
       VALUES (1, NULL, 2, 'calendar_year', 'KSM-APP-0004', 'draft')`,
    );
    expect(all(db, `SELECT application_number FROM applications WHERE resident_id = 1`).length).toBe(3);

    // CY/ST cannot carry academic_session_id
    const bad = expectReject(
      db,
      `INSERT INTO applications (resident_id, academic_session_id, lease_period_id, lease_kind, application_number, status)
       VALUES (1, 1, 3, 'short_term', 'KSM-APP-0005', 'draft')`,
    );
    expect(bad.toLowerCase()).toMatch(/check|constraint/);
  });

  it("accepts academic calendar applications with session and/or lease period", () => {
    run(
      db,
      `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, status, resident_kind)
       VALUES (1, 1, 'STU-1', 'Student', 'One', 'applicant', 'student')`,
    );
    run(
      db,
      `INSERT INTO applications (resident_id, academic_session_id, lease_period_id, lease_kind, application_number, status)
       VALUES (1, 1, 1, 'academic_calendar', 'KSM-APP-AC-1', 'draft')`,
    );
    const row = get<{ academic_session_id: number; lease_period_id: number }>(
      db,
      `SELECT academic_session_id, lease_period_id FROM applications WHERE application_number = 'KSM-APP-AC-1'`,
    );
    expect(row).toMatchObject({ academic_session_id: 1, lease_period_id: 1 });
  });
});


describe("Stage 2L-F-R Ghana Card number identity schema", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openMigratedDatabase();
    seedGraph(db);
  });

  it("adds ghana_card_number without editing 0016 and keeps student_id separate", () => {
    const cols = all<{ name: string }>(db, `PRAGMA table_info(residents)`).map((r) => r.name);
    expect(cols).toContain("ghana_card_number");
    expect(cols).toContain("resident_kind");
    expect(cols).toContain("student_id");

    run(
      db,
      `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, status, resident_kind, ghana_card_number)
       VALUES (1, 1, 'STU-1', 'Student', 'One', 'applicant', 'student', NULL)`,
    );
    run(
      db,
      `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, status, resident_kind, ghana_card_number)
       VALUES (2, NULL, NULL, 'Other', 'Person', 'applicant', 'non_student', 'GHA-123456789-0')`,
    );
    expect(get<{ student_id: string | null }>(db, `SELECT student_id FROM residents WHERE ghana_card_number = 'GHA-123456789-0'`)?.student_id).toBeNull();
    expect(get<{ ghana_card_number: string | null }>(db, `SELECT ghana_card_number FROM residents WHERE student_id = 'STU-1'`)?.ghana_card_number).toBeNull();

    run(db, `INSERT INTO users (email, phone, display_name, user_type, status) VALUES ('dup@example.com', '+233000002099', 'Dup', 'resident', 'active')`);
    const msg = expectReject(
      db,
      `INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, status, resident_kind, ghana_card_number)
       VALUES (3, NULL, NULL, 'Dup', 'Person', 'applicant', 'non_student', 'GHA-123456789-0')`,
    );
    expect(msg.toLowerCase()).toMatch(/unique|constraint/);
  });
});
