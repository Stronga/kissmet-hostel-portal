import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import app from "../src/index";
import type { Env } from "../src/types/bindings";
import { all, get, listMigrationFiles, openMigratedDatabase, readMigrationSql, run } from "./apply-migrations";
import { createSqlJsD1 } from "./sqljs-d1";
import { hashPassword } from "../src/auth/crypto";
import { resetRateLimitsForTests } from "../src/auth/rate-limit";
import { PASSWORD_MIN_LENGTH, assertPasswordStrong, passwordProblems } from "../src/auth/password-policy";
import { PASSWORD_CHANGE_ALLOWED_PATHS } from "../src/middleware/auth.middleware";

/** Synthetic credentials for a throwaway in-memory database only. */
const ADMIN_PW = "Synthetic-Admin-Pass-01";
const TEMP_PW = "Synthetic-Temp-Pass-02";
const NEW_PW = "Brand-New-Secret-Phrase-03";

describe("password policy (unit)", () => {
  it("accepts strong passwords and long passphrases", () => {
    expect(passwordProblems("Tr0ub4dor&3-xyz")).toEqual([]);
    expect(passwordProblems("correct horse battery staple")).toEqual([]);
    expect(() => assertPasswordStrong(NEW_PW, { username: "ops.manager", email: "ops@example.test" })).not.toThrow();
  });
  it("rejects short, low-variety, common, repeated and identity-containing passwords", () => {
    expect(passwordProblems("Short1!")).toContain(`at least ${PASSWORD_MIN_LENGTH} characters`);
    expect(passwordProblems("alllowercaseletters").length).toBeGreaterThan(0);
    // Decorated common passwords are still common (normalised before the list check).
    expect(passwordProblems("Password123!")).toEqual(expect.arrayContaining(["not a common password"]));
    expect(passwordProblems("password123")).toEqual(expect.arrayContaining(["not a common password"]));
    expect(passwordProblems("aaaaaaaaaaaaaaaaaaaaaaaa")).toEqual(expect.arrayContaining(["not a single repeated character"]));
    expect(passwordProblems("Ops.Manager-2026!", { username: "ops.manager" })).toEqual(expect.arrayContaining(["must not contain your username or email"]));
    expect(passwordProblems("x".repeat(257) + "A1!").length).toBeGreaterThan(0);
  });
  it("never echoes the password in the error", () => {
    try { assertPasswordStrong("weakpass"); } catch (e) { expect(String((e as Error).message)).not.toContain("weakpass"); expect((e as { code: string }).code).toBe("PASSWORD_TOO_WEAK"); }
  });
});

describe("migration 0021 (staff password rotation)", () => {
  it("is additive: users gains must_change_password (default 0, 0/1 only) and password_changed_at", async () => {
    expect(listMigrationFiles()).toContain("0021_staff_password_rotation.sql");
    const db = await openMigratedDatabase("0020_connector_heartbeats.sql");
    run(db, `INSERT INTO users (email, display_name, user_type, status) VALUES ('pre@example.test', 'Pre', 'staff', 'active')`);
    db.run(readMigrationSql("0021_staff_password_rotation.sql"));
    expect(get(db, `SELECT must_change_password AS m, password_changed_at AS p, email FROM users`)).toEqual({ m: 0, p: null, email: "pre@example.test" });
    expect(() => run(db, `UPDATE users SET must_change_password = 2`)).toThrow(/CHECK/);
  });
});

describe("staff password change & mandatory rotation (real schema, full app)", () => {
  let db: Database;
  let env: Env;
  let ipSeq = 0;
  let adminUserId: number;
  let staffUserId: number;
  let staffId: number;

  async function req(method: string, path: string, token?: string, body?: unknown) {
    const headers: Record<string, string> = { "CF-Connecting-IP": `198.51.100.${ipSeq}` };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await app.request(`http://worker.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function login(identifier: string, password: string) {
    return req("POST", "/auth/staff/login", undefined, { identifier, password });
  }

  beforeEach(async () => {
    resetRateLimitsForTests();
    ipSeq += 1;
    db = await openMigratedDatabase();
    env = { APP_NAME: "kissmet-test", APP_ENV: "local", DB: createSqlJsD1(db), DOCUMENTS: {} } as unknown as Env;
    run(db, `INSERT INTO roles (code, name, is_system) VALUES ('super_admin', 'Super Admin', 1), ('manager', 'Manager', 1)`);
    run(db, `INSERT INTO users (email, username, display_name, user_type, status, password_hash) VALUES ('root@example.test', 'root.admin', 'Root', 'staff', 'active', ?)`, [await hashPassword(ADMIN_PW)]);
    adminUserId = Number(get<{ id: number }>(db, `SELECT id FROM users WHERE username = 'root.admin'`)!.id);
    run(db, `INSERT INTO staff (user_id, role_id, staff_code, status) SELECT ?, id, 'SYN-STF-1', 'active' FROM roles WHERE code = 'super_admin'`, [adminUserId]);
    run(db, `INSERT INTO users (email, username, display_name, user_type, status, password_hash, must_change_password) VALUES ('ops@example.test', 'ops.manager', 'Ops', 'staff', 'active', ?, 1)`, [await hashPassword(TEMP_PW)]);
    staffUserId = Number(get<{ id: number }>(db, `SELECT id FROM users WHERE username = 'ops.manager'`)!.id);
    run(db, `INSERT INTO staff (user_id, role_id, staff_code, status) SELECT ?, id, 'SYN-STF-2', 'active' FROM roles WHERE code = 'manager'`, [staffUserId]);
    staffId = Number(get<{ id: number }>(db, `SELECT id FROM staff WHERE user_id = ?`, [staffUserId])!.id);
  });

  it("login reports mustChangePassword and every other staff route is blocked until changed", async () => {
    const l = await login("ops.manager", TEMP_PW);
    expect(l.status).toBe(200);
    expect(l.body).toMatchObject({ mustChangePassword: true, user: { mustChangePassword: true } });
    const token = l.body.token as string;

    const me = await req("GET", "/auth/me", token);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ mustChangePassword: true });

    const adminGets = (app.routes as Array<{ method: string; path: string }>)
      .filter((r) => r.method === "GET" && r.path.startsWith("/admin"))
      .map((r) => r.path.replace(/:[A-Za-z_]+(\{[^}]*\})?/g, "1"));
    expect(adminGets.length).toBeGreaterThan(20);
    for (const path of new Set(adminGets)) {
      const r = await req("GET", path, token);
      expect(r.status, path).toBe(403);
      expect(r.body.error, path).toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
    }
    for (const [method, path] of [["POST", "/admin/rooms"], ["PATCH", "/admin/bookings/1/status"], ["GET", "/admin/rooms/"], ["GET", "/admin/rooms%0A"]] as const) {
      const r = await req(method, path, token, method === "GET" ? undefined : {});
      expect(r.status, path).toBe(403);
    }
    expect([...PASSWORD_CHANGE_ALLOWED_PATHS].sort()).toEqual(["/auth/logout", "/auth/me", "/auth/staff/change-password"]);
    // Logout remains available.
    expect((await req("POST", "/auth/logout", token)).status).toBe(200);
  });

  it("validates current password, strength and reuse with stable codes", async () => {
    const token = (await login("ops.manager", TEMP_PW)).body.token as string;
    const wrong = await req("POST", "/auth/staff/change-password", token, { currentPassword: "Not-The-Temp-Pass-9", newPassword: NEW_PW });
    expect(wrong).toMatchObject({ status: 400, body: { error: { code: "PASSWORD_CURRENT_INVALID" } } });
    const weak = await req("POST", "/auth/staff/change-password", token, { currentPassword: TEMP_PW, newPassword: "short" });
    expect(weak).toMatchObject({ status: 400, body: { error: { code: "PASSWORD_TOO_WEAK" } } });
    expect(weak.body.error.requirements.length).toBeGreaterThan(0);
    const reused = await req("POST", "/auth/staff/change-password", token, { currentPassword: TEMP_PW, newPassword: TEMP_PW });
    expect(reused).toMatchObject({ status: 400, body: { error: { code: "PASSWORD_REUSED" } } });
    expect(get(db, `SELECT must_change_password AS m FROM users WHERE id = ?`, [staffUserId])).toEqual({ m: 1 });
    const bad = await req("POST", "/auth/staff/change-password", token, "not-an-object");
    expect(bad.status).toBe(400);
  });

  it("successful change clears the flag, keeps the current session and revokes all other sessions", async () => {
    const other1 = (await login("ops.manager", TEMP_PW)).body.token as string;
    const other2 = (await login("ops.manager", TEMP_PW)).body.token as string;
    const current = (await login("ops.manager", TEMP_PW)).body.token as string;
    const ok = await req("POST", "/auth/staff/change-password", current, { currentPassword: TEMP_PW, newPassword: NEW_PW });
    expect(ok).toMatchObject({ status: 200, body: { ok: true, data: { mustChangePassword: false, revokedOtherSessions: 2 } } });

    const row = get<{ m: number; p: string | null }>(db, `SELECT must_change_password AS m, password_changed_at AS p FROM users WHERE id = ?`, [staffUserId])!;
    expect(row.m).toBe(0);
    expect(row.p).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(all(db, `SELECT status, revocation_reason FROM sessions WHERE user_id = ? ORDER BY id`, [staffUserId])).toEqual([
      { status: "revoked", revocation_reason: "password_changed" },
      { status: "revoked", revocation_reason: "password_changed" },
      { status: "active", revocation_reason: null },
    ]);
    expect((await req("GET", "/admin/dashboard", current)).status).toBe(200);
    expect((await req("GET", "/auth/me", other1)).status).toBe(401);
    expect((await req("GET", "/admin/dashboard", other2)).status).toBe(401);

    expect((await login("ops.manager", TEMP_PW)).status).toBe(401);
    const fresh = await login("ops.manager", NEW_PW);
    expect(fresh).toMatchObject({ status: 200, body: { mustChangePassword: false } });

    // Audit trail without password material.
    const audits = all<{ action: string; metadata_json: string | null }>(db, `SELECT action, metadata_json FROM audit_logs ORDER BY id`);
    expect(audits.map((a) => a.action)).toContain("auth.staff.password_changed");
    const changed = audits.find((a) => a.action === "auth.staff.password_changed")!;
    expect(JSON.parse(String(changed.metadata_json))).toEqual({ wasForced: true, revokedOtherSessions: 2 });
    const dump = JSON.stringify(audits);
    for (const secret of [TEMP_PW, NEW_PW, "pbkdf2"]) expect(dump).not.toContain(secret);
  });

  it("voluntary change works for unflagged staff too (self-service)", async () => {
    const token = (await login("root.admin", ADMIN_PW)).body.token as string;
    expect((await req("GET", "/admin/dashboard", token)).status).toBe(200);
    const ok = await req("POST", "/auth/staff/change-password", token, { currentPassword: ADMIN_PW, newPassword: NEW_PW });
    expect(ok).toMatchObject({ status: 200, body: { data: { mustChangePassword: false, revokedOtherSessions: 0 } } });
    const audit = get<{ metadata_json: string }>(db, `SELECT metadata_json FROM audit_logs WHERE action = 'auth.staff.password_changed'`)!;
    expect(JSON.parse(audit.metadata_json)).toEqual({ wasForced: false, revokedOtherSessions: 0 });
  });

  it("administrative reset and admin-created accounts require rotation at next login", async () => {
    const admin = (await login("root.admin", ADMIN_PW)).body.token as string;
    // Clear the fixture flag first so the reset is what sets it.
    run(db, `UPDATE users SET must_change_password = 0 WHERE id = ?`, [staffUserId]);
    const staffSession = (await login("ops.manager", TEMP_PW)).body.token as string;
    const reset = await req("POST", `/admin/staff/${staffId}/reset-password`, admin);
    expect(reset.status).toBe(200);
    const temporary = reset.body.data.temporaryPassword as string;
    expect(get(db, `SELECT must_change_password AS m FROM users WHERE id = ?`, [staffUserId])).toEqual({ m: 1 });
    expect((await req("GET", "/auth/me", staffSession)).status).toBe(401); // reset revokes sessions
    const relog = await login("ops.manager", temporary);
    expect(relog.body.mustChangePassword).toBe(true);
    expect((await req("GET", "/admin/dashboard", relog.body.token)).status).toBe(403);

    const created = await req("POST", "/admin/staff", admin, { email: "new@example.test", username: "new.staffer", displayName: "New", roleId: 2, staffCode: "SYN-STF-3" });
    expect(created.status).toBe(201);
    expect(get(db, `SELECT must_change_password AS m FROM users WHERE username = 'new.staffer'`)).toEqual({ m: 1 });
    // The reset response never includes hashes; audit metadata never includes the temporary password.
    expect(JSON.stringify(all(db, `SELECT metadata_json FROM audit_logs`))).not.toContain(temporary);
  });

  it("rate-limits repeated change attempts per user", async () => {
    const token = (await login("ops.manager", TEMP_PW)).body.token as string;
    for (let i = 0; i < 5; i += 1) {
      const r = await req("POST", "/auth/staff/change-password", token, { currentPassword: "Wrong-Guess-Pass-1", newPassword: NEW_PW });
      expect(r.status).toBe(400);
    }
    const limited = await req("POST", "/auth/staff/change-password", token, { currentPassword: TEMP_PW, newPassword: NEW_PW });
    expect(limited).toMatchObject({ status: 429, body: { error: { code: "PASSWORD_CHANGE_RATE_LIMITED" } } });
  });

  it("requires authentication and a staff session", async () => {
    expect((await req("POST", "/auth/staff/change-password", undefined, { currentPassword: TEMP_PW, newPassword: NEW_PW })).status).toBe(401);
  });
});
