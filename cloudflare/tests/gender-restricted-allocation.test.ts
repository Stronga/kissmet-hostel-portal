import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import { all, get, openMigratedDatabase, run } from "./apply-migrations";
import { createSqlJsD1 } from "./sqljs-d1";
import { AdminRepository } from "../src/repositories/admin.repository";
import { AdminService } from "../src/services/admin.service";
import {
  GENDER_ERROR_CODES,
  assertGenderEligible,
  evaluateGenderEligibility,
  restrictedRoomGender,
} from "../src/services/gender-eligibility";
import { routeError } from "../src/http/safe-error";
import type { AuthUser } from "../src/auth/context";

const NOT_ELIGIBLE = GENDER_ERROR_CODES.notEligible;
const MISMATCH = GENDER_ERROR_CODES.mismatch;

const manager: AuthUser = {
  id: 1, userType: "staff", displayName: "Manager", email: "manager@example.com",
  role: "manager", staffId: 1, residentId: null, sessionId: 1,
};

type Gender = "female" | "male" | "other" | "not_specified" | null;
const RESIDENTS: Array<{ key: string; gender: Gender }> = [
  { key: "fem", gender: "female" },
  { key: "mal", gender: "male" },
  { key: "nul", gender: null },
  { key: "uns", gender: "not_specified" },
  { key: "oth", gender: "other" },
];

describe("gender eligibility helper (unit)", () => {
  it("allows every gender (including missing) in mixed rooms", () => {
    for (const g of ["female", "male", "other", "not_specified", null, undefined, ""]) {
      expect(evaluateGenderEligibility("any", g)).toEqual({ eligible: true });
    }
  });
  it("allows only matching recorded gender in single-gender rooms", () => {
    expect(evaluateGenderEligibility("female", "female")).toEqual({ eligible: true });
    expect(evaluateGenderEligibility("male", "male")).toEqual({ eligible: true });
    expect(evaluateGenderEligibility("female", "male")).toEqual({ eligible: false, code: MISMATCH });
    expect(evaluateGenderEligibility("male", "female")).toEqual({ eligible: false, code: MISMATCH });
  });
  it("blocks missing, not_specified and other from single-gender rooms", () => {
    for (const policy of ["female", "male"]) {
      for (const g of [null, undefined, "", "not_specified", "other", "FEMALE", "unknown"]) {
        expect(evaluateGenderEligibility(policy, g)).toEqual({ eligible: false, code: NOT_ELIGIBLE });
      }
    }
  });
  it("fails closed on unknown room policies", () => {
    expect(evaluateGenderEligibility(null, "female").eligible).toBe(false);
    expect(evaluateGenderEligibility("women", "female").eligible).toBe(false);
  });
  it("normalises only female/male as restricted-room genders", () => {
    expect(restrictedRoomGender("female")).toBe("female");
    expect(restrictedRoomGender("male")).toBe("male");
    expect(restrictedRoomGender("other")).toBeNull();
    expect(restrictedRoomGender("not_specified")).toBeNull();
    expect(restrictedRoomGender(null)).toBeNull();
  });
  it("maps errors to a stable API code with a PII-free message", () => {
    try {
      assertGenderEligible("female", "not_specified");
      throw new Error("expected throw");
    } catch (e) {
      const { body, status } = routeError(e);
      expect(status).toBe(400);
      expect(body.error).toMatchObject({ code: NOT_ELIGIBLE });
      expect(body.error.message).toMatch(/^Gender/);
      expect(body.error.message).not.toMatch(/not_specified/);
    }
    try {
      assertGenderEligible("male", "female");
    } catch (e) {
      const { body } = routeError(e);
      expect(body.error).toMatchObject({ code: MISMATCH });
      expect(body.error.message).not.toMatch(/\bfemale\b/);
    }
  });
  it("never surfaces non-domain error codes", () => {
    const e = Object.assign(new Error("Booking not found"), { code: "SQLITE_CONSTRAINT" });
    expect(routeError(e).body.error).toMatchObject({ code: "bad_request" });
  });
});

describe("gender-restricted allocation across workflows (real schema, sql.js)", () => {
  let db: Database;
  let svc: AdminService;
  const id: Record<string, number> = {};
  const res: Record<string, number> = {};
  let sessionId: number;
  let acPeriodId: number;
  let seq = 0;

  function one(sql: string, params: Array<string | number | null> = []) {
    return Number(get<{ id: number }>(db, sql, params)!.id);
  }

  beforeEach(async () => {
    db = await openMigratedDatabase();
    svc = new AdminService(new AdminRepository(createSqlJsD1(db)));
    seq = 0;
    run(db, `INSERT INTO roles (code, name, is_system) VALUES ('manager', 'Manager', 1)`);
    run(db, `INSERT INTO users (email, phone, display_name, user_type, status) VALUES ('manager@example.com', '+233200000099', 'Manager', 'staff', 'active')`);
    run(db, `INSERT INTO staff (id, user_id, role_id, staff_code, status) SELECT 1, u.id, r.id, 'KSM-STF-0001', 'active' FROM users u CROSS JOIN roles r`);
    run(db, `INSERT INTO academic_sessions (code, name, starts_on, ends_on, status) VALUES ('SYN-2026', 'Synthetic 2026', '2026-09-01', '2027-06-30', 'active')`);
    sessionId = one(`SELECT id FROM academic_sessions`);
    run(db, `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id) VALUES ('academic_calendar', 'SYN-AC', 'Synthetic AC', '2026-09-01', '2027-06-30', 'active', ?)`, [sessionId]);
    acPeriodId = one(`SELECT id FROM lease_periods`);
    run(db, `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status) VALUES (?, 2, 'SYN-2', 100000, 'GHS', 'active')`, [acPeriodId]);
    for (const [code, policy] of [["FEM", "female"], ["MAL", "male"], ["MIX", "any"]] as const) {
      run(db, `INSERT INTO rooms (room_code, room_name, floor, capacity, gender_policy, status) VALUES (?, ?, '1', 2, ?, 'available')`, [code, code, policy]);
      id[code] = one(`SELECT id FROM rooms WHERE room_code = ?`, [code]);
      for (const b of ["A", "B"]) {
        run(db, `INSERT INTO beds (room_id, bed_code, label, status) VALUES (?, ?, ?, 'available')`, [id[code], `${code}-${b}`, b]);
        id[`${code}-${b}`] = one(`SELECT id FROM beds WHERE bed_code = ?`, [`${code}-${b}`]);
      }
      run(db, `INSERT INTO room_rates (room_id, academic_session_id, rate_code, amount_minor, currency, status) VALUES (?, ?, ?, 100000, 'GHS', 'active')`, [id[code], sessionId, `${code}-R`]);
    }
    RESIDENTS.forEach((r, i) => {
      run(db, `INSERT INTO users (email, phone, display_name, user_type, status) VALUES (?, ?, ?, 'resident', 'active')`, [`${r.key}@example.test`, `+23320000010${i}`, `Synthetic ${r.key}`]);
      run(db, `INSERT INTO residents (user_id, first_name, last_name, gender, status, resident_kind, ghana_card_number) SELECT id, 'Syn', ?, ?, 'resident', 'non_student', ? FROM users WHERE email = ?`, [r.key, r.gender, `GHA-00000000${i}-0`, `${r.key}@example.test`]);
      res[r.key] = one(`SELECT id FROM residents WHERE last_name = ?`, [r.key]);
    });
  });

  const GENDER_OF: Record<string, Gender> = Object.fromEntries(RESIDENTS.map((r) => [r.key, r.gender]));

  /** A fresh synthetic resident per workflow (schema allows one active booking per resident+period). */
  function freshResident(key: string) {
    seq += 1;
    const email = `${key}-${seq}@example.test`;
    run(db, `INSERT INTO users (email, phone, display_name, user_type, status) VALUES (?, ?, ?, 'resident', 'active')`, [email, `+2332001${String(seq).padStart(5, "0")}`, `Synthetic ${key} ${seq}`]);
    run(db, `INSERT INTO residents (user_id, first_name, last_name, gender, status, resident_kind, ghana_card_number) SELECT id, 'Syn', ?, ?, 'resident', 'non_student', ? FROM users WHERE email = ?`, [`${key}-${seq}`, GENDER_OF[key], `GHA-1${String(seq).padStart(8, "0")}-0`, email]);
    return one(`SELECT id FROM residents WHERE last_name = ?`, [`${key}-${seq}`]);
  }

  function approvedApplication(key: string) {
    const residentId = freshResident(key);
    seq += 1;
    run(db, `INSERT INTO applications (resident_id, academic_session_id, lease_period_id, lease_kind, application_number, status) VALUES (?, ?, ?, 'academic_calendar', ?, 'approved')`, [residentId, sessionId, acPeriodId, `SYN-APP-${seq}`]);
    return one(`SELECT id FROM applications WHERE application_number = ?`, [`SYN-APP-${seq}`]);
  }

  /** Inserts a booking directly (simulates legacy data that predates the rule). */
  function booking(key: string, roomCode: string, status: "pending" | "confirmed" | "completed" = "confirmed") {
    const residentId = freshResident(key);
    seq += 1;
    run(db, `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency, priced_room_id, lease_period_id, lease_kind, starts_on, ends_on)
      VALUES (?, ?, ?, ?, 100000, 'GHS', ?, ?, 'academic_calendar', '2026-09-01', '2027-06-30')`, [residentId, sessionId, `SYN-BKG-${seq}`, status, id[roomCode], acPeriodId]);
    return one(`SELECT id FROM bookings WHERE booking_number = ?`, [`SYN-BKG-${seq}`]);
  }

  function allocation(bookingId: number, bedCode: string) {
    const b = get<{ resident_id: number }>(db, `SELECT resident_id FROM bookings WHERE id = ?`, [bookingId])!;
    run(db, `INSERT INTO allocations (booking_id, resident_id, academic_session_id, bed_id, status, starts_on, ends_on) VALUES (?, ?, ?, ?, 'active', '2026-09-01', '2027-06-30')`, [bookingId, b.resident_id, sessionId, id[bedCode]]);
    return one(`SELECT id FROM allocations WHERE booking_id = ? AND status = 'active'`, [bookingId]);
  }

  function auditText() {
    return all<{ action: string; metadata_json: string | null }>(db, `SELECT action, metadata_json FROM audit_logs`);
  }

  it("legacy createBooking: blocks missing/not_specified/other and mismatches from single-gender rooms; mixed unaffected", async () => {
    for (const key of ["nul", "uns", "oth"]) {
      for (const room of ["FEM", "MAL"]) {
        await expect(svc.createBooking(manager, { applicationId: approvedApplication(key), roomId: id[room] })).rejects.toMatchObject({ code: NOT_ELIGIBLE });
      }
    }
    await expect(svc.createBooking(manager, { applicationId: approvedApplication("mal"), roomId: id.FEM })).rejects.toMatchObject({ code: MISMATCH });
    await expect(svc.createBooking(manager, { applicationId: approvedApplication("fem"), roomId: id.MAL })).rejects.toMatchObject({ code: MISMATCH });
    expect(get(db, `SELECT COUNT(*) AS n FROM bookings`)).toMatchObject({ n: 0 });
    await expect(svc.createBooking(manager, { applicationId: approvedApplication("uns"), roomId: id.MIX })).resolves.toMatchObject({ status: "pending" });
    await expect(svc.createBooking(manager, { applicationId: approvedApplication("fem"), roomId: id.FEM })).resolves.toMatchObject({ status: "pending" });
  });

  it("rate-card (Path B) booking applies the same rule", async () => {
    await expect(svc.createBookingFromRateCard(manager, { applicationId: approvedApplication("oth"), roomId: id.FEM, leasePeriodId: acPeriodId })).rejects.toMatchObject({ code: NOT_ELIGIBLE });
    await expect(svc.createBookingFromRateCard(manager, { applicationId: approvedApplication("nul"), roomId: id.MAL, leasePeriodId: acPeriodId })).rejects.toMatchObject({ code: NOT_ELIGIBLE });
    await expect(svc.createBookingFromRateCard(manager, { applicationId: approvedApplication("fem"), roomId: id.MAL, leasePeriodId: acPeriodId })).rejects.toMatchObject({ code: MISMATCH });
    expect(get(db, `SELECT COUNT(*) AS n FROM bookings`)).toMatchObject({ n: 0 });
    await expect(svc.createBookingFromRateCard(manager, { applicationId: approvedApplication("oth"), roomId: id.MIX, leasePeriodId: acPeriodId })).resolves.toMatchObject({ agreement: { booking_number: expect.any(String) } });
    await expect(svc.createBookingFromRateCard(manager, { applicationId: approvedApplication("mal"), roomId: id.MAL, leasePeriodId: acPeriodId })).resolves.toMatchObject({ agreement: { booking_number: expect.any(String) } });
  });

  it("booking approval (pending → confirmed) re-checks eligibility for pre-existing bookings", async () => {
    const bad = booking("uns", "FEM", "pending");
    await expect(svc.updateBookingStatus(manager, bad, "confirmed")).rejects.toMatchObject({ code: NOT_ELIGIBLE });
    expect(get(db, `SELECT status FROM bookings WHERE id = ?`, [bad])).toMatchObject({ status: "pending" });
    // Eligible booking passes the gender gate (and then hits the normal payment gate).
    const ok = booking("fem", "FEM", "pending");
    await expect(svc.updateBookingStatus(manager, ok, "confirmed")).rejects.toThrow(/Payment confirmation requirement/);
    // Cancelling an ineligible booking is still allowed (cleanup path).
    await expect(svc.updateBookingStatus(manager, bad, "cancelled")).resolves.toMatchObject({ status: "cancelled" });
  });

  it("createAllocation blocks ineligible residents and mismatches; mixed rooms unaffected", async () => {
    const nul = booking("nul", "FEM");
    await expect(svc.createAllocation(manager, { bookingId: nul, bedId: id["FEM-A"], startsOn: "2026-09-01" })).rejects.toMatchObject({ code: NOT_ELIGIBLE });
    const oth = booking("oth", "MAL");
    await expect(svc.createAllocation(manager, { bookingId: oth, bedId: id["MAL-A"], startsOn: "2026-09-01" })).rejects.toMatchObject({ code: NOT_ELIGIBLE });
    const mal = booking("mal", "FEM");
    await expect(svc.createAllocation(manager, { bookingId: mal, bedId: id["FEM-A"], startsOn: "2026-09-01" })).rejects.toMatchObject({ code: MISMATCH });
    expect(get(db, `SELECT COUNT(*) AS n FROM allocations`)).toMatchObject({ n: 0 });
    const uns = booking("uns", "MIX");
    await expect(svc.createAllocation(manager, { bookingId: uns, bedId: id["MIX-A"], startsOn: "2026-09-01" })).resolves.toMatchObject({ status: "active" });
    const fem = booking("fem", "FEM");
    await expect(svc.createAllocation(manager, { bookingId: fem, bedId: id["FEM-A"], startsOn: "2026-09-01" })).resolves.toMatchObject({ status: "active" });
  });

  it("same-room transfer re-validates (legacy ineligible occupant cannot be moved within a restricted room)", async () => {
    const b = booking("uns", "FEM");
    const a = allocation(b, "FEM-A");
    await expect(svc.transferAllocation(manager, a, { destinationBedId: id["FEM-B"], startsOn: "2026-10-01" })).rejects.toMatchObject({ code: NOT_ELIGIBLE });
    expect(get(db, `SELECT status, bed_id FROM allocations WHERE id = ?`, [a])).toMatchObject({ status: "active", bed_id: id["FEM-A"] });
    const ok = booking("uns", "MIX");
    const okAlloc = allocation(ok, "MIX-A");
    await expect(svc.transferAllocation(manager, okAlloc, { destinationBedId: id["MIX-B"], startsOn: "2026-10-01" })).resolves.toMatchObject({ status: "active", bed_id: id["MIX-B"] });
  });

  it("Path B cross-room transfer blocks ineligible destinations before touching the agreement", async () => {
    const b = booking("oth", "MIX");
    const a = allocation(b, "MIX-A");
    await expect(svc.crossRoomTransferAllocation(manager, a, { destinationBedId: id["FEM-A"], startsOn: "2026-10-01", reason: "Synthetic move" })).rejects.toMatchObject({ code: NOT_ELIGIBLE });
    const f = booking("fem", "MIX");
    const fa = allocation(f, "MIX-B");
    await expect(svc.crossRoomTransferAllocation(manager, fa, { destinationBedId: id["MAL-A"], startsOn: "2026-10-01", reason: "Synthetic move" })).rejects.toMatchObject({ code: MISMATCH });
    expect(get(db, `SELECT priced_room_id FROM bookings WHERE id = ?`, [b])).toMatchObject({ priced_room_id: id.MIX });
    expect(get(db, `SELECT priced_room_id FROM bookings WHERE id = ?`, [f])).toMatchObject({ priced_room_id: id.MIX });
    expect(get(db, `SELECT COUNT(*) AS n FROM allocations WHERE status = 'active'`)).toMatchObject({ n: 2 });
    const moved = await svc.crossRoomTransferAllocation(manager, fa, { destinationBedId: id["FEM-A"], startsOn: "2026-10-01", reason: "Synthetic move" });
    expect(moved.allocation).toMatchObject({ status: "active", bed_id: id["FEM-A"] });
  });

  it("extension of a restricted-room agreement requires an eligible resident; mixed unaffected", async () => {
    const b = booking("nul", "MAL");
    allocation(b, "MAL-A");
    await expect(svc.extendBookingAgreement(manager, b, { endsOn: "2027-08-31", reason: "Synthetic extension" })).rejects.toMatchObject({ code: NOT_ELIGIBLE });
    expect(get(db, `SELECT ends_on FROM bookings WHERE id = ?`, [b])).toMatchObject({ ends_on: "2027-06-30" });
    // Even without extending the allocation, the agreement for a restricted room is not extended.
    await expect(svc.extendBookingAgreement(manager, b, { endsOn: "2027-08-31", reason: "Synthetic extension", extendAllocation: false })).rejects.toMatchObject({ code: NOT_ELIGIBLE });
    const m = booking("nul", "MIX");
    await expect(svc.extendBookingAgreement(manager, m, { endsOn: "2027-08-31", reason: "Synthetic extension" })).resolves.toMatchObject({ agreement: { ends_on: "2027-08-31" } });
  });

  it("renewal into a restricted room requires an eligible resident; mixed unaffected", async () => {
    run(db, `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id) VALUES ('calendar_year', 'SYN-CY', 'Synthetic CY', '2027-07-01', '2027-12-31', 'active', NULL)`);
    const cy = one(`SELECT id FROM lease_periods WHERE code = 'SYN-CY'`);
    run(db, `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status) VALUES (?, 2, 'SYN-CY-2', 120000, 'GHS', 'active')`, [cy]);
    const prior = booking("uns", "MIX", "completed");
    await expect(svc.renewBooking(manager, prior, { roomId: id.FEM, leasePeriodId: cy })).rejects.toMatchObject({ code: NOT_ELIGIBLE });
    const priorMal = booking("mal", "MAL", "completed");
    await expect(svc.renewBooking(manager, priorMal, { roomId: id.FEM, leasePeriodId: cy })).rejects.toMatchObject({ code: MISMATCH });
    await expect(svc.renewBooking(manager, prior, { roomId: id.MIX, leasePeriodId: cy })).resolves.toMatchObject({ agreement: { booking_number: expect.any(String) } });
    await expect(svc.renewBooking(manager, priorMal, { roomId: id.MAL, leasePeriodId: cy })).resolves.toMatchObject({ agreement: { booking_number: expect.any(String) } });
  });

  it("availability listings never offer ineligible beds", async () => {
    const rooms = async (residentKey?: string) => {
      const rows = await svc.availability(sessionId, residentKey ? res[residentKey] : null) as Array<{ room_code: string }>;
      return Array.from(new Set(rows.map((r) => r.room_code))).sort();
    };
    expect(await rooms()).toEqual(["FEM", "MAL", "MIX"]); // inventory view, no resident context
    expect(await rooms("fem")).toEqual(["FEM", "MIX"]);
    expect(await rooms("mal")).toEqual(["MAL", "MIX"]);
    for (const key of ["nul", "uns", "oth"]) expect(await rooms(key)).toEqual(["MIX"]);

    const legacy = booking("uns", "FEM");
    expect(await svc.availabilityForAgreement(legacy, "2026-09-01", "2027-06-30")).toEqual([]);
    const okB = booking("fem", "FEM");
    expect((await svc.availabilityForAgreement(okB, "2026-09-01", "2027-06-30")).length).toBe(2);
    const mixB = booking("oth", "MIX");
    expect((await svc.availabilityForAgreement(mixB, "2026-09-01", "2027-06-30")).length).toBe(2);
  });

  it("rejections write no audit rows and audits never contain gender values", async () => {
    await expect(svc.createBooking(manager, { applicationId: approvedApplication("oth"), roomId: id.FEM })).rejects.toBeTruthy();
    expect(auditText()).toEqual([]);
    await svc.createBooking(manager, { applicationId: approvedApplication("oth"), roomId: id.MIX });
    for (const row of auditText()) {
      expect(String(row.metadata_json)).not.toMatch(/gender|female|male|not_specified|other/i);
    }
  });
});
