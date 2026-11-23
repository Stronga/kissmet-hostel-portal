/**
 * Integration E2E for PRs #19–#28 combined (integration/2026-11-22-prs-19-27).
 * Full Worker app (real middleware, RBAC, password-rotation gate) over the real migrated schema
 * 0001–0021 in sql.js, with an in-memory R2 stand-in. LOCAL/TEST ONLY, synthetic data only:
 * no remote D1/R2, no SMS, no MikroTik/connector contact.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import app from "../src/index";
import { all, createSqlJsD1, get, listMigrationFiles, openMigratedDatabase, run } from "./apply-migrations";
import { hashPassword, sha256Hex } from "../src/auth/crypto";
import { resetRateLimitsForTests } from "../src/auth/rate-limit";
import { samplePdfFile, samplePngFile } from "./upload-samples";
import type { Env } from "../src/types/bindings";

class MemoryR2 {
  store = new Map<string, { data: Uint8Array; contentType?: string }>();
  async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }) {
    let data: Uint8Array;
    if (typeof value === "string") data = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer) data = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else data = new Uint8Array(await new Response(value).arrayBuffer());
    this.store.set(key, { data, contentType: options?.httpMetadata?.contentType });
    return {} as R2Object;
  }
  async get(key: string) {
    const stored = this.store.get(key);
    if (!stored) return null;
    return { body: new Blob([stored.data]).stream(), arrayBuffer: async () => stored.data.slice().buffer, httpMetadata: { contentType: stored.contentType } } as unknown as R2ObjectBody;
  }
}

/** Synthetic credentials for a throwaway in-memory database only. */
const BOOT_TEMP_PW = "Synthetic-Boot-Temp-01";
const ADMIN_NEW_PW = "Synthetic-Admin-Rotated-02";
const MANAGER_NEW_PW = "Synthetic-Manager-Rotated-03";
const RESIDENT_TOKEN = "syn-resident-session-0123456789abcdef";

let db: Database;
let r2: MemoryR2;
let ipSeq = 0;
const env = () => ({ APP_NAME: "kissmet-int", APP_ENV: "local", DB: createSqlJsD1(db), DOCUMENTS: r2 as unknown as R2Bucket } as unknown as Env);

async function call(method: string, path: string, token?: string, body?: unknown) {
  ipSeq += 1;
  const headers: Record<string, string> = { "CF-Connecting-IP": `203.0.113.${(ipSeq % 250) + 1}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await app.request(`http://worker.test${path}`, { method, headers, body: payload }, env());
  const type = res.headers.get("Content-Type") ?? "";
  const json = type.includes("application/json") ? await res.json() as Record<string, any> : null;
  return { status: res.status, json, headers: res.headers };
}
const login = (identifier: string, password: string) => call("POST", "/auth/staff/login", undefined, { identifier, password });
const one = (sql: string, params: Array<string | number | null> = []) => get<Record<string, any>>(db, sql, params)!;
const auditActions = () => all<{ action: string }>(db, "SELECT action FROM audit_logs ORDER BY id").map((a) => a.action);

// Shared state across the ordered workflow below.
const S: Record<string, any> = {};

describe("integration E2E — auth, booking, payment, refund, allocation, gender, documents (real schema)", () => {
  beforeAll(async () => {
    resetRateLimitsForTests();
    db = await openMigratedDatabase();
    r2 = new MemoryR2();
    for (const code of ["super_admin", "manager", "reception", "accounts", "maintenance"]) run(db, "INSERT INTO roles (code, name, is_system) VALUES (?, ?, 1)", [code, code]);
    // Bootstrap-equivalent super admin: temporary password + must_change_password = 1 (migration 0021).
    run(db, "INSERT INTO users (email, username, display_name, user_type, status, password_hash, must_change_password) VALUES ('root@example.test', 'syn.root', 'Root', 'staff', 'active', ?, 1)", [await hashPassword(BOOT_TEMP_PW)]);
    run(db, "INSERT INTO staff (user_id, role_id, staff_code, status) SELECT u.id, r.id, 'SYN-STF-0001', 'active' FROM users u CROSS JOIN roles r WHERE u.username = 'syn.root' AND r.code = 'super_admin'");
    run(db, "INSERT INTO institutions (code, name, status) VALUES ('SYNU', 'Synthetic University', 'active')");
    run(db, "INSERT INTO academic_sessions (code, name, starts_on, ends_on, status) VALUES ('SYN-26', 'Synthetic 2026/27', '2026-09-01', '2027-06-30', 'active')");
    run(db, "INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id) SELECT 'academic_calendar', 'SYN-AC', 'Synthetic AC', '2026-09-01', '2027-06-30', 'active', id FROM academic_sessions");
    run(db, "INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, status) SELECT id, 2, 'SYN-AC-2', 250000, 'GHS', 'active' FROM lease_periods");
    for (const [code, policy] of [["FEM", "female"], ["MIX", "any"]] as const) {
      run(db, "INSERT INTO rooms (room_code, room_name, floor, capacity, gender_policy, status) VALUES (?, ?, '1', 2, ?, 'available')", [code, code, policy]);
      for (const b of ["1", "2"]) run(db, "INSERT INTO beds (room_id, bed_code, label, status) SELECT id, ?, ?, 'available' FROM rooms WHERE room_code = ?", [`${code}-${b}`, b, code]);
    }
    S.fem = one("SELECT id FROM rooms WHERE room_code = 'FEM'").id;
    S.mix = one("SELECT id FROM rooms WHERE room_code = 'MIX'").id;
    S.fem1 = one("SELECT id FROM beds WHERE bed_code = 'FEM-1'").id;
    S.mix1 = one("SELECT id FROM beds WHERE bed_code = 'MIX-1'").id;
    S.session = one("SELECT id FROM academic_sessions").id;
    S.period = one("SELECT id FROM lease_periods").id;
    S.inst = one("SELECT id FROM institutions").id;
  });

  it("migration chain is exactly 0001–0021 and includes the shared rate-limit table", () => {
    const files = listMigrationFiles();
    expect(files).toHaveLength(21);
    expect(files[20]).toBe("0021_staff_password_rotation.sql");
    expect(one("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'auth_rate_limits'").n).toBe(1);
  });

  it("AUTH — bootstrap admin must rotate; change revokes other sessions; then admin routes open", async () => {
    const a = await login("syn.root", BOOT_TEMP_PW);
    const b = await login("syn.root", BOOT_TEMP_PW);
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ mustChangePassword: true });
    expect((await call("GET", "/admin/dashboard", a.json!.token)).json).toMatchObject({ error: { code: "PASSWORD_CHANGE_REQUIRED" } });
    const changed = await call("POST", "/auth/staff/change-password", a.json!.token, { currentPassword: BOOT_TEMP_PW, newPassword: ADMIN_NEW_PW });
    expect(changed).toMatchObject({ status: 200, json: { data: { mustChangePassword: false, revokedOtherSessions: 1 } } });
    expect((await call("GET", "/auth/me", b.json!.token)).status).toBe(401);
    expect((await call("GET", "/admin/dashboard", a.json!.token)).status).toBe(200);
    S.root = a.json!.token;
    // Shared D1 limiter recorded the attempt under a PII-free key.
    expect(all(db, "SELECT bucket_key FROM auth_rate_limits")).toEqual([{ bucket_key: expect.stringMatching(/^staff-password-change:user:\d+$/) }]);
  });

  it("AUTH — admin-created manager must rotate at first login; admin reset forces rotation again", async () => {
    const roleId = one("SELECT id FROM roles WHERE code = 'manager'").id;
    const created = await call("POST", "/admin/staff", S.root, { email: "mgr@example.test", username: "syn.manager", displayName: "Synthetic Manager", roleId, staffCode: "SYN-STF-0002" });
    expect(created.status).toBe(201);
    const initial = created.json!.data.initialPassword as string;
    S.managerStaffId = created.json!.data.staff.id ?? created.json!.data.staff.staff_id;
    const first = await login("syn.manager", initial);
    expect(first.json).toMatchObject({ mustChangePassword: true });
    expect((await call("GET", "/admin/residents", first.json!.token)).status).toBe(403);
    expect((await call("POST", "/auth/staff/change-password", first.json!.token, { currentPassword: initial, newPassword: MANAGER_NEW_PW })).status).toBe(200);
    S.manager = first.json!.token;
    expect((await call("GET", "/admin/residents", S.manager)).status).toBe(200);
    // Reset by super admin → existing sessions revoked; the temporary password only opens the rotation gate.
    const reset = await call("POST", `/admin/staff/${S.managerStaffId}/reset-password`, S.root);
    expect(reset.status).toBe(200);
    expect((await call("GET", "/admin/residents", S.manager)).status).toBe(401);
    const temp = reset.json!.data.temporaryPassword as string;
    const again = await login("syn.manager", temp);
    expect(again.json).toMatchObject({ mustChangePassword: true });
    expect((await call("GET", "/admin/residents", again.json!.token)).json).toMatchObject({ error: { code: "PASSWORD_CHANGE_REQUIRED" } });
    expect((await call("POST", "/auth/staff/change-password", again.json!.token, { currentPassword: temp, newPassword: MANAGER_NEW_PW + "x" })).status).toBe(200);
    S.manager = again.json!.token;
    expect((await call("GET", "/admin/residents", S.manager)).status).toBe(200);
    expect(JSON.stringify(all(db, "SELECT metadata_json FROM audit_logs"))).not.toContain(temp);
  });

  it("BOOKING + GENDER — unrecorded gender is blocked from the female-only room until an audited correction", async () => {
    const res = await call("POST", "/admin/residents", S.manager, { displayName: "Synthetic Resident", firstName: "Syn", lastName: "Resident", institutionId: S.inst, studentId: "SYN-0001", phone: "+233200099001", status: "resident" });
    expect(res.status).toBe(201);
    S.resident = res.json!.data.id;
    const appRes = await call("POST", "/admin/applications", S.manager, { residentId: S.resident, academicSessionId: S.session, leasePeriodId: S.period });
    expect(appRes.status).toBe(201);
    S.application = appRes.json!.data.id;
    for (const status of ["submitted", "under_review", "approved"]) expect((await call("PATCH", `/admin/applications/${S.application}/status`, S.manager, { status })).status).toBe(200);
    const blocked = await call("POST", "/admin/bookings/from-rate-card", S.manager, { applicationId: S.application, roomId: S.fem, leasePeriodId: S.period });
    expect(blocked.status).toBe(400);
    expect(blocked.json!.error.code).toBe("GENDER_NOT_ELIGIBLE_FOR_RESTRICTED_ROOM");
    // Availability for this resident offers mixed-room beds only.
    const avail = await call("GET", `/admin/availability?academicSessionId=${S.session}&residentId=${S.resident}`, S.manager);
    expect(avail.status).toBe(200);
    expect(JSON.stringify(avail.json)).not.toContain("FEM-");
    // Reception (resident:write) cannot correct gender; manager can, audited.
    const fixed = await call("POST", `/admin/residents/${S.resident}/gender-correction`, S.manager, { gender: "female", reasonCode: "identity_document_verified" });
    expect(fixed.status).toBe(200);
    expect(auditActions()).toContain("admin.resident.gender_corrected");
    const booking = await call("POST", "/admin/bookings/from-rate-card", S.manager, { applicationId: S.application, roomId: S.fem, leasePeriodId: S.period, maintenanceFeeMinor: 0 });
    expect(booking.status).toBe(201);
    S.booking = booking.json!.data.booking.id;
  });

  it("PAYMENT + ALLOCATION — verify, confirm, allocate, receipt; archiving the verified payment is refused", async () => {
    const pay = await call("POST", "/admin/payments", S.manager, { bookingId: S.booking, residentId: S.resident, amountMinor: 250000, method: "mobile_money" });
    expect(pay.status).toBe(201);
    S.payment = pay.json!.data.id;
    expect((await call("PATCH", `/admin/payments/${S.payment}/status`, S.manager, { status: "submitted" })).status).toBe(200);
    expect((await call("POST", `/admin/payments/${S.payment}/verify`, S.manager, {})).status).toBe(200);
    expect((await call("PATCH", `/admin/bookings/${S.booking}/status`, S.manager, { status: "confirmed" })).status).toBe(200);
    const alloc = await call("POST", "/admin/allocations", S.manager, { bookingId: S.booking, bedId: S.fem1, startsOn: "2026-09-01", endsOn: "2027-06-30" });
    expect(alloc.status).toBe(201);
    S.allocation = alloc.json!.data.id;
    const receipt = await call("POST", `/admin/payments/${S.payment}/receipt`, S.manager, {});
    expect([200, 201]).toContain(receipt.status);
    S.receipt = receipt.json!.data.id;
    const archive = await call("PATCH", `/admin/payments/${S.payment}/status`, S.manager, { status: "archived" });
    expect(archive.status).toBe(400);
    expect(archive.json!.error.message).toMatch(/refund it or end the booking/);
    expect(one("SELECT status FROM payments WHERE id = ?", [S.payment]).status).toBe("verified");
    expect(one("SELECT verified_paid FROM (SELECT COALESCE(SUM(amount_minor),0) AS verified_paid FROM payments WHERE status = 'verified')").verified_paid).toBe(250000);
  });

  it("GENDER CORRECTION — conflicting correction is held, then applied with acknowledgement and listed until resolved", async () => {
    const held = await call("POST", `/admin/residents/${S.resident}/gender-correction`, S.manager, { gender: "not_specified", reasonCode: "resident_request" });
    expect(held.status).toBe(409);
    expect(held.json!.data.conflicts.map((c: any) => c.kind).sort()).toEqual(["allocation", "booking"]);
    expect(one("SELECT gender FROM residents WHERE id = ?", [S.resident]).gender).toBe("female");
    const applied = await call("POST", `/admin/residents/${S.resident}/gender-correction`, S.manager, { gender: "not_specified", reasonCode: "resident_request", acknowledgeConflicts: true });
    expect(applied.status).toBe(200);
    const list = await call("GET", "/admin/gender-placement-conflicts", S.manager);
    expect(list.json!.data).toHaveLength(2);
    // Allocation still active (never moved automatically); restore the verified gender to clear the list.
    expect(one("SELECT status FROM allocations WHERE id = ?", [S.allocation]).status).toBe("active");
    expect((await call("POST", `/admin/residents/${S.resident}/gender-correction`, S.manager, { gender: "female", reasonCode: "identity_document_verified" })).status).toBe(200);
    expect((await call("GET", "/admin/gender-placement-conflicts", S.manager)).json!.data).toEqual([]);
  });

  it("REFUND — single path: status route refuses, reason required, receipt voided, booking flagged, no double refund", async () => {
    expect((await call("PATCH", `/admin/payments/${S.payment}/status`, S.manager, { status: "refunded" })).status).toBe(400);
    expect((await call("POST", `/admin/payments/${S.payment}/refund`, S.manager, {})).status).toBe(400);
    const refund = await call("POST", `/admin/payments/${S.payment}/refund`, S.manager, { reason: "Synthetic withdrawal" });
    expect(refund.status).toBe(200);
    expect(refund.json!.data.voidedReceiptId).toBe(S.receipt);
    expect(one("SELECT status FROM receipts WHERE id = ?", [S.receipt]).status).toBe("voided");
    expect(one("SELECT payment_attention_required AS f FROM bookings WHERE id = ?", [S.booking]).f).toBe(1);
    expect((await call("POST", `/admin/payments/${S.payment}/refund`, S.manager, { reason: "again" })).status).toBe(400);
    // Refunded payment may now be archived.
    expect((await call("PATCH", `/admin/payments/${S.payment}/status`, S.manager, { status: "archived" })).status).toBe(200);
    const finance = await call("GET", "/admin/dashboard/finance", S.manager);
    expect(finance.status).toBe(200);
  });

  it("ALLOCATION — transfer to a mixed-room bed and end the stay", async () => {
    const transfer = await call("POST", `/admin/allocations/${S.allocation}/transfer`, S.manager, { destinationBedId: S.mix1, startsOn: "2026-10-01", endsOn: "2027-06-30" });
    // Rate-card agreement bookings move rooms only through the Path B cross-room transfer (repricing + audit).
    expect(transfer.status).toBe(400);
    const cross = await call("POST", `/admin/allocations/${S.allocation}/cross-room-transfer`, S.manager, { destinationBedId: S.mix1, startsOn: "2026-10-01", endsOn: "2027-06-30", reason: "Synthetic integration move" });
    expect(cross.status, JSON.stringify(cross.json)).toBe(201);
    const active = all<{ id: number; bed_id: number }>(db, "SELECT id, bed_id FROM allocations WHERE resident_id = ? AND status = 'active'", [S.resident]);
    expect(active).toEqual([{ id: expect.any(Number), bed_id: S.mix1 }]);
    expect((await call("PATCH", `/admin/allocations/${active[0].id}/status`, S.manager, { status: "ended" })).status).toBe(200);
  });

  it("DOCUMENTS — resident upload (magic bytes), Ghana Card hidden from reception, proxied download with safe headers, audited", async () => {
    const userId = one("SELECT user_id FROM residents WHERE id = ?", [S.resident]).user_id;
    run(db, "INSERT INTO sessions (user_id, session_token_hash, status, expires_at) VALUES (?, ?, 'active', '2099-01-01T00:00:00.000Z')", [userId, await sha256Hex(RESIDENT_TOKEN)]);
    const fake = new FormData();
    fake.append("file", new File(["not really a pdf"], "card.pdf", { type: "application/pdf" }));
    expect((await call("POST", "/resident/me/documents/ghana-card", RESIDENT_TOKEN, fake)).status).toBe(400);
    const good = new FormData();
    good.append("file", samplePngFile("card.png"));
    const up = await call("POST", "/resident/me/documents/ghana-card", RESIDENT_TOKEN, good);
    expect(up.status).toBe(201);
    const docId = up.json!.data.id;
    const student = new FormData();
    student.append("file", samplePdfFile("student.pdf"));
    expect((await call("POST", "/resident/me/documents/student-card", RESIDENT_TOKEN, student)).status).toBe(201);
    // R2 key is opaque (no resident id / filename).
    for (const key of r2.store.keys()) { expect(key).not.toContain("card"); expect(key).not.toContain(String(S.resident) + "/"); }
    // Reception: create + rotate, then list excludes Ghana Card.
    const roleId = one("SELECT id FROM roles WHERE code = 'reception'").id;
    const rc = await call("POST", "/admin/staff", S.root, { email: "rcp@example.test", username: "syn.reception", displayName: "Synthetic Reception", roleId, staffCode: "SYN-STF-0003" });
    const rl = await login("syn.reception", rc.json!.data.initialPassword);
    await call("POST", "/auth/staff/change-password", rl.json!.token, { currentPassword: rc.json!.data.initialPassword, newPassword: "Synthetic-Reception-Rotated-04" });
    const recList = await call("GET", "/admin/documents", rl.json!.token);
    expect(recList.status).toBe(200);
    expect(JSON.stringify(recList.json)).not.toContain("ghana_card\"");
    expect((await call("GET", `/admin/documents/${docId}/content`, rl.json!.token)).status).toBeGreaterThanOrEqual(403);
    // Reception cannot correct gender either.
    expect((await call("POST", `/admin/residents/${S.resident}/gender-correction`, rl.json!.token, { gender: "male", reasonCode: "other" })).status).toBe(403);
    const dl = await app.request(`http://worker.test/admin/documents/${docId}/content`, { headers: { Authorization: `Bearer ${S.manager}` } }, env());
    expect(dl.status).toBe(200);
    expect(dl.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(dl.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(auditActions().some((a) => a.endsWith("identity_document.content_accessed"))).toBe(true);
    expect(auditActions().some((a) => a.endsWith("identity_document.listed"))).toBe(true);
  });

  it("CONNECTOR boundary — Worker connector heartbeat rejects unauthenticated calls; staff tokens are not connector credentials", async () => {
    const anon = await call("POST", "/connector/heartbeat", undefined, { connectorId: "x" });
    expect([400, 401, 403, 503]).toContain(anon.status);
    const staffTok = await call("POST", "/connector/heartbeat", S.root, { connectorId: "x" });
    expect([400, 401, 403, 503]).toContain(staffTok.status);
    expect(one("SELECT COUNT(*) AS n FROM connector_heartbeats").n).toBe(0);
  });

  it("audit trail holds no raw passwords, Ghana Card numbers or phone numbers", () => {
    const dump = JSON.stringify(all(db, "SELECT action, metadata_json FROM audit_logs"));
    for (const secret of [BOOT_TEMP_PW, ADMIN_NEW_PW, MANAGER_NEW_PW, "+233200099001", "Synthetic withdrawal"]) expect(dump).not.toContain(secret);
  });
});
