import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import app from "../src/index";
import { all, get, openMigratedDatabase, run } from "./apply-migrations";
import { createSqlJsD1 } from "./sqljs-d1";
import { AdminRepository } from "../src/repositories/admin.repository";
import { AdminService } from "../src/services/admin.service";
import { GENDER_CORRECTION_REASONS, GENDER_ERROR_CODES } from "../src/services/gender-eligibility";
import { hasPermission } from "../src/auth/permissions";
import { sha256Hex } from "../src/auth/crypto";
import type { AuthUser } from "../src/auth/context";
import type { Env } from "../src/types/bindings";

/**
 * Authorized, audited gender corrections (real migrated schema 0001+, sql.js, synthetic data only).
 */

const TOKENS = { manager: "syn-session-manager-0123456789abcdef", reception: "syn-session-reception-0123456789abcdef", accounts: "syn-session-accounts-0123456789abcdef" } as const;
const SYN_LAST_NAME = "Correctiontest";
const SYN_GHANA_CARD = "GHA-123456789-0";

describe("resident gender correction (real schema)", () => {
  let db: Database;
  let svc: AdminService;
  let manager: AuthUser;
  const room: Record<string, number> = {};
  const bed: Record<string, number> = {};
  let sessionId: number;
  let seq = 0;

  const one = (sql: string, params: Array<string | number | null> = []) => Number(get<{ id: number }>(db, sql, params)!.id);
  const audits = () => all<{ action: string; entity_type: string; entity_id: number; metadata_json: string | null }>(db, "SELECT action, entity_type, entity_id, metadata_json FROM audit_logs ORDER BY id");
  const env = () => ({ APP_NAME: "kissmet-test", APP_ENV: "local", DB: createSqlJsD1(db), DOCUMENTS: {} } as unknown as Env);
  async function api(token: string, method: string, path: string, body?: unknown) {
    const r = await app.request(`http://worker.test${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env());
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  }

  function resident(gender: string | null) {
    seq += 1;
    const email = `gc-${seq}@example.test`;
    run(db, "INSERT INTO users (email, phone, display_name, user_type, status) VALUES (?, ?, ?, 'resident', 'active')", [email, `+2332002${String(seq).padStart(5, "0")}`, `Synthetic ${seq}`]);
    run(db, "INSERT INTO residents (user_id, first_name, last_name, gender, status, resident_kind, ghana_card_number) SELECT id, 'Syn', ?, ?, 'resident', 'non_student', ? FROM users WHERE email = ?", [`${SYN_LAST_NAME}${seq}`, gender, SYN_GHANA_CARD.replace("123", String(100 + seq)), email]);
    return one("SELECT id FROM residents WHERE last_name = ?", [`${SYN_LAST_NAME}${seq}`]);
  }

  function booking(residentId: number, roomCode: string, status: "pending" | "confirmed") {
    seq += 1;
    run(db, "INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency, priced_room_id) VALUES (?, ?, ?, ?, 100000, 'GHS', ?)", [residentId, sessionId, `SYN-BKG-${seq}`, status, room[roomCode]]);
    return one("SELECT id FROM bookings WHERE booking_number = ?", [`SYN-BKG-${seq}`]);
  }

  function allocation(bookingId: number, residentId: number, bedCode: string) {
    run(db, "INSERT INTO allocations (booking_id, resident_id, academic_session_id, bed_id, status, starts_on) VALUES (?, ?, ?, ?, 'active', '2026-09-01')", [bookingId, residentId, sessionId, bed[bedCode]]);
    return one("SELECT id FROM allocations WHERE booking_id = ?", [bookingId]);
  }

  beforeEach(async () => {
    db = await openMigratedDatabase();
    svc = new AdminService(new AdminRepository(createSqlJsD1(db)));
    seq = 0;
    let n = 0;
    for (const role of ["manager", "reception", "accounts"] as const) {
      n += 1;
      run(db, "INSERT INTO roles (code, name, is_system) VALUES (?, ?, 1)", [role, role]);
      run(db, "INSERT INTO users (email, phone, display_name, user_type, status) VALUES (?, ?, ?, 'staff', 'active')", [`${role}@example.test`, `+23320000098${n}`, role]);
      run(db, "INSERT INTO staff (user_id, role_id, staff_code, status) SELECT u.id, r.id, ?, 'active' FROM users u CROSS JOIN roles r WHERE u.email = ? AND r.code = ?", [`SYN-STF-${n}`, `${role}@example.test`, role]);
      const userId = one("SELECT id FROM users WHERE email = ?", [`${role}@example.test`]);
      run(db, "INSERT INTO sessions (user_id, session_token_hash, status, expires_at) VALUES (?, ?, 'active', '2099-01-01T00:00:00.000Z')", [userId, await sha256Hex(TOKENS[role])]);
    }
    const mUser = one("SELECT id FROM users WHERE email = 'manager@example.test'");
    manager = { id: mUser, userType: "staff", displayName: "manager", email: "manager@example.test", role: "manager", staffId: one("SELECT id FROM staff WHERE user_id = ?", [mUser]), residentId: null, sessionId: 1 };
    run(db, "INSERT INTO academic_sessions (code, name, starts_on, ends_on, status) VALUES ('SYN-2026', 'Synthetic 2026', '2026-09-01', '2027-06-30', 'active')");
    sessionId = one("SELECT id FROM academic_sessions");
    for (const [code, policy] of [["FEM", "female"], ["MAL", "male"], ["MIX", "any"]] as const) {
      run(db, "INSERT INTO rooms (room_code, room_name, floor, capacity, gender_policy, status) VALUES (?, ?, '1', 4, ?, 'available')", [code, code, policy]);
      room[code] = one("SELECT id FROM rooms WHERE room_code = ?", [code]);
      for (const b of ["A", "B", "C"]) {
        run(db, "INSERT INTO beds (room_id, bed_code, label, status) VALUES (?, ?, ?, 'available')", [room[code], `${code}-${b}`, b]);
        bed[`${code}-${b}`] = one("SELECT id FROM beds WHERE bed_code = ?", [`${code}-${b}`]);
      }
    }
  });

  it("permission: only super_admin and manager hold resident:gender_correct", () => {
    expect(hasPermission("super_admin", "resident:gender_correct")).toBe(true);
    expect(hasPermission("manager", "resident:gender_correct")).toBe(true);
    for (const role of ["reception", "accounts", "maintenance", "resident"] as const) expect(hasPermission(role, "resident:gender_correct")).toBe(false);
  });

  it("corrects a missing gender with no placements; audit holds codes only (no names, identifiers or free text)", async () => {
    const r = resident(null);
    const result = await svc.correctResidentGender(manager, r, { gender: "female", reasonCode: "identity_document_verified" });
    expect(result).toMatchObject({ applied: true, conflicts: [] });
    expect(get(db, "SELECT gender FROM residents WHERE id = ?", [r])).toEqual({ gender: "female" });
    const a = audits().filter((x) => x.action === "admin.resident.gender_corrected");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ entity_type: "resident", entity_id: r });
    expect(JSON.parse(a[0].metadata_json!)).toEqual({ previousGender: null, newGender: "female", reasonCode: "identity_document_verified", conflictCount: 0, conflictingAllocationIds: [], conflictingBookingIds: [] });
    const allAudit = JSON.stringify(audits());
    expect(allAudit).not.toContain(SYN_LAST_NAME);
    expect(allAudit).not.toContain("GHA-");
    expect(allAudit).not.toContain("+233");
  });

  it("validates gender, reason, resident and no-op corrections without changing anything", async () => {
    const r = resident("male");
    await expect(svc.correctResidentGender(manager, r, { gender: "FEMALE", reasonCode: "data_entry_error" })).rejects.toThrow(/Invalid gender/);
    await expect(svc.correctResidentGender(manager, r, { gender: "female", reasonCode: "because" })).rejects.toThrow(/Invalid gender correction reason/);
    await expect(svc.correctResidentGender(manager, r, { gender: "female", reasonCode: undefined })).rejects.toThrow(/reason/);
    await expect(svc.correctResidentGender(manager, 99999, { gender: "female", reasonCode: "data_entry_error" })).rejects.toThrow(/Resident not found/);
    await expect(svc.correctResidentGender(manager, r, { gender: "male", reasonCode: "data_entry_error" })).rejects.toThrow(/already recorded/);
    expect(get(db, "SELECT gender FROM residents WHERE id = ?", [r])).toEqual({ gender: "male" });
    expect(audits().filter((x) => x.action.startsWith("admin.resident.gender"))).toHaveLength(0);
    expect([...GENDER_CORRECTION_REASONS]).toEqual(["data_entry_error", "resident_request", "identity_document_verified", "other"]);
  });

  it("holds a correction that would leave an active allocation / booking in an ineligible single-gender room", async () => {
    const r = resident("female");
    const bConfirmed = booking(r, "FEM", "confirmed");
    const alloc = allocation(bConfirmed, r, "FEM-A");
    const result = await svc.correctResidentGender(manager, r, { gender: "not_specified", reasonCode: "resident_request" });
    expect(result.applied).toBe(false);
    expect(result).toMatchObject({ requiresAcknowledgement: true });
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "allocation", allocationId: alloc, bookingId: bConfirmed, roomCode: "FEM", code: GENDER_ERROR_CODES.notEligible }),
      expect.objectContaining({ kind: "booking", bookingId: bConfirmed, bookingStatus: "confirmed", roomCode: "FEM" }),
    ]));
    // Nothing changed; the hold is audited with a count only.
    expect(get(db, "SELECT gender FROM residents WHERE id = ?", [r])).toEqual({ gender: "female" });
    const held = audits().filter((x) => x.action === "admin.resident.gender_correction_held");
    expect(JSON.parse(held[0].metadata_json!)).toEqual({ reasonCode: "resident_request", conflictCount: 2 });
    expect(await svc.genderPlacementConflicts()).toEqual([]);
  });

  it("acknowledged correction applies, flags each conflicting placement, never moves it, and keeps it listed until resolved", async () => {
    const r = resident("female");
    const b = booking(r, "FEM", "confirmed");
    const alloc = allocation(b, r, "FEM-A");
    const pendingOther = resident("female");
    const bPending = booking(pendingOther, "FEM", "pending");
    const result = await svc.correctResidentGender(manager, r, { gender: "male", reasonCode: "data_entry_error", acknowledgeConflicts: true });
    expect(result.applied).toBe(true);
    expect(result.conflicts.map((c) => c.code)).toEqual([GENDER_ERROR_CODES.mismatch, GENDER_ERROR_CODES.mismatch]);
    // Placements untouched (staff must transfer/end them explicitly).
    expect(get(db, "SELECT status, bed_id FROM allocations WHERE id = ?", [alloc])).toEqual({ status: "active", bed_id: bed["FEM-A"] });
    expect(get(db, "SELECT status FROM bookings WHERE id = ?", [b])).toEqual({ status: "confirmed" });
    const flags = audits().filter((x) => x.action === "admin.resident.gender_placement_conflict");
    expect(flags.map((f) => [f.entity_type, f.entity_id])).toEqual([["allocation", alloc], ["booking", b]]);
    expect(JSON.parse(flags[0].metadata_json!)).toEqual({ residentId: r, roomId: room.FEM, code: GENDER_ERROR_CODES.mismatch, cause: "gender_correction" });
    const corrected = JSON.parse(audits().find((x) => x.action === "admin.resident.gender_corrected")!.metadata_json!);
    expect(corrected).toMatchObject({ previousGender: "female", newGender: "male", conflictCount: 2, conflictingAllocationIds: [alloc], conflictingBookingIds: [b] });

    // Live conflicts list shows only the corrected resident's placements (the other pending booking is fine).
    const live = await svc.genderPlacementConflicts();
    expect(live.map((c) => [c.kind, c.residentId])).toEqual([["allocation", r], ["booking", r]]);
    expect(live.some((c) => c.bookingId === bPending)).toBe(false);
    expect(JSON.stringify(live)).not.toContain(SYN_LAST_NAME);

    // The existing workflow guard now blocks further restricted placements for this resident...
    await expect(svc.correctResidentGender(manager, r, { gender: "male", reasonCode: "other" })).rejects.toThrow(/already recorded/);
    // ...and resolving the placement (ending the stay / cancelling the booking) clears the list.
    run(db, "UPDATE allocations SET status = 'ended', released_at = '2026-10-01T00:00:00.000Z' WHERE id = ?", [alloc]);
    run(db, "UPDATE bookings SET status = 'cancelled' WHERE id = ?", [b]);
    expect(await svc.genderPlacementConflicts()).toEqual([]);
  });

  it("mixed-room placements never conflict; correcting into eligibility needs no acknowledgement", async () => {
    const r = resident("female");
    const b = booking(r, "MIX", "confirmed");
    allocation(b, r, "MIX-A");
    expect((await svc.correctResidentGender(manager, r, { gender: "other", reasonCode: "resident_request" })).applied).toBe(true);
    const r2 = resident(null);
    const b2 = booking(r2, "MAL", "pending"); // legacy wrong placement
    expect((await svc.genderPlacementConflicts()).map((c) => c.bookingId)).toEqual([b2]);
    expect((await svc.correctResidentGender(manager, r2, { gender: "male", reasonCode: "identity_document_verified" })).applied).toBe(true);
    expect(await svc.genderPlacementConflicts()).toEqual([]);
  });

  describe("HTTP (real auth middleware + RBAC)", () => {
    it("manager: 409 with conflicts, then 200 with acknowledgement", async () => {
      const r = resident("female");
      const b = booking(r, "FEM", "pending");
      const held = await api(TOKENS.manager, "POST", `/admin/residents/${r}/gender-correction`, { gender: "not_specified", reasonCode: "resident_request" });
      expect(held.status).toBe(409);
      expect(held.json.error.code).toBe("GENDER_CORRECTION_CONFLICTS");
      expect(held.json.data.conflicts).toEqual([expect.objectContaining({ kind: "booking", bookingId: b })]);
      const okRes = await api(TOKENS.manager, "POST", `/admin/residents/${r}/gender-correction`, { gender: "not_specified", reasonCode: "resident_request", acknowledgeConflicts: true });
      expect(okRes.status).toBe(200);
      expect(okRes.json.data).toMatchObject({ applied: true, resident: { id: r, gender: "not_specified" } });
      // Ghana Card number is never returned raw.
      expect(JSON.stringify(okRes.json)).not.toMatch(/GHA-\d{9}-\d/);
      expect(okRes.json.data.resident.ghana_card_number).toBeUndefined();
      const list = await api(TOKENS.manager, "GET", "/admin/gender-placement-conflicts");
      expect(list.status).toBe(200);
      expect(list.json.data).toEqual([expect.objectContaining({ bookingId: b, code: GENDER_ERROR_CODES.notEligible })]);
    });

    it("acknowledgeConflicts must be literal true", async () => {
      const r = resident("female");
      booking(r, "FEM", "pending");
      const res = await api(TOKENS.manager, "POST", `/admin/residents/${r}/gender-correction`, { gender: "male", reasonCode: "data_entry_error", acknowledgeConflicts: "true" });
      expect(res.status).toBe(409);
    });

    it("reception (resident:write) and accounts cannot correct gender; accounts cannot list conflicts", async () => {
      const r = resident(null);
      for (const token of [TOKENS.reception, TOKENS.accounts]) {
        const res = await api(token, "POST", `/admin/residents/${r}/gender-correction`, { gender: "female", reasonCode: "data_entry_error" });
        expect(res.status).toBe(403);
      }
      expect((await api(TOKENS.accounts, "GET", "/admin/gender-placement-conflicts")).status).toBe(403);
      expect((await api(TOKENS.reception, "GET", "/admin/gender-placement-conflicts")).status).toBe(200);
      expect(get(db, "SELECT gender FROM residents WHERE id = ?", [r])).toEqual({ gender: null });
    });

    it("validation errors are 400/404 with safe messages; unauthenticated is 401", async () => {
      const r = resident("male");
      expect((await api(TOKENS.manager, "POST", `/admin/residents/${r}/gender-correction`, { gender: "x", reasonCode: "data_entry_error" })).status).toBe(400);
      expect((await api(TOKENS.manager, "POST", `/admin/residents/99999/gender-correction`, { gender: "female", reasonCode: "data_entry_error" })).status).toBe(404);
      const r401 = await app.request(`http://worker.test/admin/residents/${r}/gender-correction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, env());
      expect(r401.status).toBe(401);
    });
  });
});
