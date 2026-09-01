import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { AdminService } from "./admin.service";
import { requireRole } from "../middleware/auth.middleware";
import type { AuthUser } from "../auth/context";

const manager: AuthUser = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts: AuthUser = { ...manager, role: "accounts" };
const superAdmin: AuthUser = { ...manager, role: "super_admin" };
const otherSuperAdmin: AuthUser = { ...superAdmin, id: 2, staffId: 2 };

class FakeRepo {
  rows: Record<string, Record<string, unknown>[]> = {
    academic_sessions: [{ id: 1, code: "2026", status: "active" }],
    institutions: [],
    rooms: [{ id: 1, room_code: "R1", capacity: 2 }],
    beds: [],
    room_rates: [],
    residents: [],
    users: [
      { id: 1, email: "root@test", username: "root", phone: null, display_name: "Root Admin", user_type: "staff", status: "active", password_hash: "old" },
      { id: 2, email: "other@test", username: "other", phone: null, display_name: "Other Admin", user_type: "staff", status: "active", password_hash: "old" },
      { id: 3, email: "manager@test", username: "manager", phone: null, display_name: "Manager", user_type: "staff", status: "active", password_hash: "old" }
    ],
    staff: [
      { id: 1, user_id: 1, role_id: 1, staff_code: "ADM-1", job_title: "Owner", status: "active" },
      { id: 2, user_id: 2, role_id: 1, staff_code: "ADM-2", job_title: "Owner", status: "active" },
      { id: 3, user_id: 3, role_id: 2, staff_code: "MGR-1", job_title: "Manager", status: "active" }
    ],
    roles: [
      { id: 1, code: "super_admin", name: "Super Admin" },
      { id: 2, code: "manager", name: "Manager" },
      { id: 3, code: "reception", name: "Reception" },
      { id: 4, code: "accounts", name: "Accounts" },
      { id: 5, code: "maintenance", name: "Maintenance" },
      { id: 6, code: "resident", name: "Resident" }
    ],
    sessions: [
      { id: 1, user_id: 3, status: "active" },
      { id: 2, user_id: 2, status: "active" }
    ],
    allocations: []
  };
  audits: string[] = [];
  nextResidentCode = 1;

  async list(table: string) { return { results: this.rows[table] ?? [] }; }
  async get(table: string, id: number) { return (this.rows[table] ?? []).find((r) => r.id === id) ?? null; }
  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
    if (sql.includes("SELECT id, code FROM roles WHERE id")) return (this.rows.roles.find((role) => role.id === binds[0]) ?? null) as T | null;
    if (sql.includes("COUNT(*) AS count") && sql.includes("r.code = 'super_admin'")) {
      return { count: this.rows.staff.filter((staff) => {
        const user = this.rows.users.find((item) => item.id === staff.user_id);
        const role = this.rows.roles.find((item) => item.id === staff.role_id);
        return staff.id !== binds[0] && staff.status === "active" && user?.status === "active" && role?.code === "super_admin";
      }).length } as T;
    }
    if (sql.includes("FROM staff s") && sql.includes("JOIN users u") && sql.includes("WHERE s.id")) {
      return this.joinedStaff(Number(binds[0])) as T | null;
    }
    if (sql.includes("capacity")) return { capacity: 2, active_beds: this.rows.beds.filter((b) => b.status !== "archived").length } as T;
    if (sql.includes("FROM allocations WHERE bed_id")) return (this.rows.allocations.find((a) => a.bed_id === binds[0] && a.status === "active") ?? null) as T | null;
    if (sql.includes("FROM allocations a") && sql.includes("JOIN beds b")) {
      return (this.rows.allocations.find((allocation) => {
        const bed = this.rows.beds.find((item) => item.id === allocation.bed_id);
        return bed?.room_id === binds[0] && allocation.status === "active";
      }) ?? null) as T | null;
    }
    if (sql.includes("total_residents")) return { total_residents: 1, active_residents: 1, total_rooms: 1, total_active_beds: 2, occupied_beds: 1, available_beds: 1, active_academic_session: "2026", active_staff_count: 1 } as T;
    return null;
  }
  async all<T>(sql?: string) {
    if (sql?.includes("FROM staff s") && sql.includes("JOIN users u")) return { results: this.rows.staff.map((row) => this.joinedStaff(Number(row.id))).filter(Boolean) as T[] };
    return { results: [] as T[] };
  }
  joinedStaff(id: number) {
    const staff = this.rows.staff.find((row) => row.id === id);
    if (!staff) return null;
    const user = this.rows.users.find((row) => row.id === staff.user_id);
    const role = this.rows.roles.find((row) => row.id === staff.role_id);
    if (!user || !role) return null;
    return {
      ...staff,
      staff_status: staff.status,
      display_name: user.display_name,
      username: user.username,
      email: user.email,
      phone: user.phone,
      user_status: user.status,
      user_created_at: user.created_at,
      role_code: role.code,
      role_name: role.name
    };
  }
  async allocateResidentCode() {
    return `KSM-RES-${String(this.nextResidentCode++).padStart(4, "0")}`;
  }
  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO academic_sessions")) this.rows.academic_sessions.push({ id: 2, code: binds[0], status: binds[4] });
    if (sql.startsWith("INSERT INTO institutions")) this.rows.institutions.push({ id: 1, code: binds[0], name: binds[1], status: binds[2] });
    if (sql.startsWith("INSERT INTO rooms")) this.rows.rooms.push({ id: 2, room_code: binds[0], capacity: binds[3] });
    if (sql.startsWith("INSERT INTO beds")) this.rows.beds.push({ id: this.rows.beds.length + 1, room_id: binds[0], bed_code: binds[1], label: binds[2], status: binds[3] });
    if (sql.startsWith("INSERT INTO room_rates")) {
      if (this.rows.room_rates.some((r) => r.room_id === binds[0] && r.academic_session_id === binds[1] && r.status === "active" && binds[5] === "active")) throw new Error("UNIQUE constraint failed");
      this.rows.room_rates.push({ id: 1, room_id: binds[0], academic_session_id: binds[1], rate_code: binds[2], amount_minor: binds[3], currency: binds[4], status: binds[5] });
    }
    if (sql.startsWith("INSERT INTO users")) {
      if (this.rows.users.some((user) => (binds[0] && user.email === binds[0]) || (binds[1] && user.username === binds[1]))) throw new Error("UNIQUE constraint failed: users.email");
      const id = Math.max(...this.rows.users.map((user) => Number(user.id)), 0) + 1;
      this.rows.users.push({ id, email: binds[0], username: binds[1], phone: binds[2], display_name: binds[3], user_type: "staff", status: "active", password_hash: binds[4] });
      return { meta: { last_row_id: id } };
    }
    if (sql.startsWith("INSERT INTO residents")) {
      if (this.rows.residents.some((r) => r.resident_code === binds[2])) throw new Error("UNIQUE constraint failed: residents.resident_code");
      if (this.rows.residents.some((r) => r.institution_id === binds[1] && r.student_id === binds[3])) throw new Error("UNIQUE constraint failed");
      const id = this.rows.residents.length + 2;
      this.rows.residents.push({ id, user_id: binds[0], institution_id: binds[1], resident_code: binds[2], student_id: binds[3] });
      return { meta: { last_row_id: id } };
    }
    if (sql.startsWith("INSERT INTO staff")) {
      if (this.rows.staff.some((staff) => staff.staff_code === binds[2])) throw new Error("UNIQUE constraint failed: staff.staff_code");
      const id = Math.max(...this.rows.staff.map((staff) => Number(staff.id)), 0) + 1;
      this.rows.staff.push({ id, user_id: binds[0], role_id: binds[1], staff_code: binds[2], job_title: binds[3], status: "active" });
      return { meta: { last_row_id: id } };
    }
    if (sql.startsWith("DELETE FROM users")) {
      this.rows.users = this.rows.users.filter((user) => user.id !== binds[0]);
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE staff SET role_id")) {
      const staff = this.rows.staff.find((item) => item.id === binds[1]);
      if (staff) staff.role_id = binds[0];
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE staff SET status")) {
      const staff = this.rows.staff.find((item) => item.id === binds[2]);
      if (staff) staff.status = binds[0];
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE users SET status")) {
      const user = this.rows.users.find((item) => item.id === binds[2]);
      if (user) user.status = binds[0];
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE users SET password_hash")) {
      const user = this.rows.users.find((item) => item.id === binds[1]);
      if (user) user.password_hash = binds[0];
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE sessions SET status = 'revoked'")) {
      this.rows.sessions.filter((session) => session.user_id === binds[1] && session.status === "active").forEach((session) => { session.status = "revoked"; session.revocation_reason = binds[0]; });
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE beds SET status")) {
      const bed = this.rows.beds.find((item) => item.id === binds[1]);
      if (bed) bed.status = binds[0];
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE rooms SET status")) {
      const room = this.rows.rooms.find((item) => item.id === binds[1]);
      if (room) room.status = binds[0];
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE")) return { meta: { last_row_id: 0 } };
    if (sql.startsWith("INSERT INTO audit_logs")) this.audits.push(String(binds[2]));
    return { meta: { last_row_id: 2 } };
  }
  async audit(_actorUserId: number, _actorStaffId: number | null, action: string) { this.audits.push(action); }
}

function service(repo = new FakeRepo()) {
  return { service: new AdminService(repo as never), repo };
}

class CollisionRepo extends FakeRepo {
  codes = ["KSM-RES-0001", "KSM-RES-0001", "KSM-RES-0002"];

  override async allocateResidentCode() {
    return this.codes.shift() ?? super.allocateResidentCode();
  }
}

describe("admin service", () => {
  it("creates academic sessions", async () => {
    const { service: svc, repo } = service();
    await svc.createAcademicSession(manager, { code: "2027", name: "2027", startsOn: "2027-01-01", endsOn: "2027-12-31" });
    expect(repo.rows.academic_sessions).toHaveLength(2);
  });

  it("activates a session through status updates", async () => {
    const { service: svc, repo } = service();
    await svc.updateStatus(manager, "academic_sessions", 1, "active");
    expect(repo.audits).toContain("admin.academic_sessions.status");
  });

  it("creates institutions and rooms", async () => {
    const { service: svc, repo } = service();
    await svc.createInstitution(manager, { code: "ug", name: "University of Ghana" });
    await svc.createRoom(manager, { roomCode: "R2", capacity: 2 });
    expect(repo.rows.institutions).toHaveLength(1);
    expect(repo.rows.rooms).toHaveLength(2);
  });

  it("creates multiple beds and rejects creation beyond capacity", async () => {
    const { service: svc } = service();
    await svc.createBed(manager, { roomId: 1, bedCode: "R1-A", label: "A" });
    await svc.createBed(manager, { roomId: 1, bedCode: "R1-B", label: "B" });
    await expect(svc.createBed(manager, { roomId: 1, bedCode: "R1-C", label: "C" })).rejects.toThrow("Room capacity exceeded");
  });

  it("allows an unoccupied available bed to move to maintenance and return to service", async () => {
    const { service: svc, repo } = service();
    await svc.createBed(manager, { roomId: 1, bedCode: "R1-A", label: "A" });

    await svc.updateStatus(manager, "beds", 1, "maintenance");
    expect(repo.rows.beds[0].status).toBe("maintenance");

    await svc.updateStatus(manager, "beds", 1, "available");
    expect(repo.rows.beds[0].status).toBe("available");
  });

  it("rejects occupied bed transitions to unavailable statuses without changing allocations", async () => {
    const { service: svc, repo } = service();
    await svc.createBed(manager, { roomId: 1, bedCode: "R1-A", label: "A" });
    repo.rows.allocations.push({ id: 1, bed_id: 1, status: "active" });
    const before = JSON.stringify(repo.rows.allocations);

    await expect(svc.updateStatus(manager, "beds", 1, "maintenance")).rejects.toThrow("This bed is currently occupied");
    await expect(svc.updateStatus(manager, "beds", 1, "inactive")).rejects.toThrow("This bed is currently occupied");
    await expect(svc.updateStatus(manager, "beds", 1, "archived")).rejects.toThrow("This bed is currently occupied");

    expect(repo.rows.beds[0].status).toBe("available");
    expect(JSON.stringify(repo.rows.allocations)).toBe(before);
  });

  it("rejects taking a room with active allocations out of service without changing allocations", async () => {
    const { service: svc, repo } = service();
    await svc.createBed(manager, { roomId: 1, bedCode: "R1-A", label: "A" });
    repo.rows.allocations.push({ id: 1, bed_id: 1, status: "active" });
    const before = JSON.stringify(repo.rows.allocations);

    await expect(svc.updateStatus(manager, "rooms", 1, "maintenance")).rejects.toThrow("This room currently has active allocations");
    await expect(svc.updateStatus(manager, "rooms", 1, "inactive")).rejects.toThrow("This room currently has active allocations");
    await expect(svc.updateStatus(manager, "rooms", 1, "archived")).rejects.toThrow("This room currently has active allocations");

    expect(repo.rows.rooms[0].status).toBeUndefined();
    expect(JSON.stringify(repo.rows.allocations)).toBe(before);
  });

  it("creates room rates and rejects duplicate active room/session rate", async () => {
    const { service: svc } = service();
    await svc.createRoomRate(manager, { roomId: 1, academicSessionId: 1, rateCode: "R1-2026", amountMinor: 250000 });
    await expect(svc.createRoomRate(manager, { roomId: 1, academicSessionId: 1, rateCode: "R1-2026-B", amountMinor: 260000 })).rejects.toThrow("UNIQUE");
  });

  it("creates residents with generated resident code and rejects duplicate institution/student", async () => {
    const { service: svc } = service();
    const resident = await svc.createResident(manager, { displayName: "Resident", institutionId: 1, studentId: "S1", firstName: "A", lastName: "B" });
    expect((resident as Record<string, unknown>)?.resident_code).toBe("KSM-RES-0001");
    await expect(svc.createResident(manager, { displayName: "Resident 2", institutionId: 1, studentId: "S1", firstName: "A", lastName: "C" })).rejects.toThrow("UNIQUE");
  });

  it("generates formatted unique resident codes independent of primary keys", async () => {
    const { service: svc, repo } = service();
    const first = await svc.createResident(manager, { displayName: "Resident", institutionId: 1, studentId: "S1", firstName: "A", lastName: "B" });
    const second = await svc.createResident(manager, { displayName: "Resident 2", institutionId: 1, studentId: "S2", firstName: "C", lastName: "D" });

    expect((first as Record<string, unknown>)?.resident_code).toMatch(/^KSM-RES-\d{4}$/);
    expect((second as Record<string, unknown>)?.resident_code).toBe("KSM-RES-0002");
    expect(new Set(repo.rows.residents.map((resident) => resident.resident_code)).size).toBe(2);
    expect((first as Record<string, unknown>)?.resident_code).not.toBe(String((first as Record<string, unknown>)?.id));
  });

  it("retries resident-code collisions instead of silently duplicating codes", async () => {
    const repo = new CollisionRepo();
    const svc = new AdminService(repo as never);
    await svc.createResident(manager, { displayName: "Resident", institutionId: 1, studentId: "S1", firstName: "A", lastName: "B" });
    const second = await svc.createResident(manager, { displayName: "Resident 2", institutionId: 1, studentId: "S2", firstName: "C", lastName: "D" });

    expect((second as Record<string, unknown>)?.resident_code).toBe("KSM-RES-0002");
    expect(new Set(repo.rows.residents.map((resident) => resident.resident_code)).size).toBe(repo.rows.residents.length);
  });

  it("creates staff member and assigns role", async () => {
    const { service: svc, repo } = service();
    const result = await svc.createStaff(superAdmin, { email: "new@test", username: "new", displayName: "New", roleId: 3, staffCode: "S1", password: "Password123!" });
    expect(repo.rows.staff).toHaveLength(4);
    expect(result.initialPassword).toBe("Password123!");
    expect(result.staff).toMatchObject({ staff_code: "S1", display_name: "New", role_code: "reception" });
    expect(repo.rows.users.find((user) => user.email === "new@test")?.password_hash).not.toBe("Password123!");
    expect(JSON.stringify(result.staff)).not.toContain("password_hash");
  });

  it("lists joined staff records without exposing password hashes", async () => {
    const { service: svc, repo } = service();
    const result = await svc.listStaff(25, 0, "manager");
    expect(result.results).toHaveLength(3);
    expect(result.results[2]).toMatchObject({ staff_code: "MGR-1", display_name: "Manager", username: "manager", role_code: "manager", staff_status: "active", user_status: "active" });
    expect(JSON.stringify(result.results)).not.toContain("password_hash");
    expect(repo.audits).not.toContain("admin.staff.list");
  });

  it("rejects invalid staff roles and duplicate staff identity fields", async () => {
    const { service: svc } = service();
    await expect(svc.createStaff(superAdmin, { email: "new@test", username: "new", displayName: "New", roleId: 6, staffCode: "S1", password: "Password123!" })).rejects.toThrow("Invalid staff role");
    await expect(svc.createStaff(superAdmin, { email: "manager@test", username: "new", displayName: "New", roleId: 2, staffCode: "S1", password: "Password123!" })).rejects.toThrow("UNIQUE");
    await expect(svc.createStaff(superAdmin, { email: "new@test", username: "new", displayName: "New", roleId: 2, staffCode: "MGR-1", password: "Password123!" })).rejects.toThrow("UNIQUE");
  });

  it("prevents non-super-admin staff management and super-admin role changes", async () => {
    const { service: svc } = service();
    await expect(svc.createStaff(manager, { email: "new@test", username: "new", displayName: "New", roleId: 1, staffCode: "S1", password: "Password123!" })).rejects.toThrow("Only super admins can manage super admin accounts");
    await expect(svc.changeStaffRole(manager, 3, 3)).rejects.toThrow("Only super admins can manage staff accounts");
    await svc.changeStaffRole(superAdmin, 3, 3);
    await expect(svc.changeStaffRole(superAdmin, 2, 2)).resolves.toMatchObject({ role_code: "manager" });
  });

  it("protects the last active super admin and self-deactivation", async () => {
    const repo = new FakeRepo();
    repo.rows.staff = repo.rows.staff.filter((staff) => staff.id !== 2);
    repo.rows.users = repo.rows.users.filter((user) => user.id !== 2);
    const svc = new AdminService(repo as never);
    await expect(svc.changeStaffRole(superAdmin, 1, 2)).rejects.toThrow("At least one other active Super Admin is required");
    await expect(svc.changeStaffStatus(superAdmin, 1, "inactive")).rejects.toThrow("At least one other active Super Admin is required");

    const { service: svc2 } = service();
    await expect(svc2.changeStaffStatus(superAdmin, 1, "inactive")).rejects.toThrow("Cannot deactivate your own staff record");
    await expect(svc2.changeStaffAccountStatus(superAdmin, 1, "inactive")).rejects.toThrow("Cannot deactivate your own account");
  });

  it("revokes active sessions on staff role status account and password changes", async () => {
    const { service: svc, repo } = service();
    await svc.changeStaffRole(superAdmin, 3, 3);
    expect(repo.rows.sessions.find((session) => session.user_id === 3)?.status).toBe("revoked");
    repo.rows.sessions.push({ id: 3, user_id: 3, status: "active" });
    await svc.changeStaffStatus(superAdmin, 3, "inactive");
    expect(repo.rows.sessions.find((session) => session.id === 3)?.status).toBe("revoked");
    repo.rows.sessions.push({ id: 4, user_id: 3, status: "active" });
    await svc.changeStaffAccountStatus(superAdmin, 3, "suspended");
    expect(repo.rows.sessions.find((session) => session.id === 4)?.revocation_reason).toBe("account_suspended");
    repo.rows.sessions.push({ id: 5, user_id: 3, status: "active" });
    const reset = await svc.resetStaffPassword(superAdmin, 3);
    expect(reset.temporaryPassword).toBeTruthy();
    expect(repo.rows.users.find((user) => user.id === 3)?.password_hash).not.toBe("old");
    expect(repo.rows.sessions.find((session) => session.id === 5)?.revocation_reason).toBe("password_reset");
    expect(repo.audits).toContain("admin.staff.password_reset");
  });

  it("returns dashboard summary counts", async () => {
    const { service: svc } = service();
    await expect(svc.dashboard()).resolves.toMatchObject({ total_residents: 1, available_beds: 1 });
  });
});

describe("admin authorization", () => {
  it("rejects insufficient role", async () => {
    const app = new Hono<{ Variables: { authUser: AuthUser } }>();
    app.use("*", async (c, next) => { c.set("authUser", accounts); return next(); });
    app.get("/restricted", requireRole("super_admin"), (c) => c.json({ ok: true }));
    expect((await app.request("/restricted")).status).toBe(403);
  });

  it("allows authorized role", async () => {
    const app = new Hono<{ Variables: { authUser: AuthUser } }>();
    app.use("*", async (c, next) => { c.set("authUser", superAdmin); return next(); });
    app.get("/restricted", requireRole("super_admin"), (c) => c.json({ ok: true }));
    expect((await app.request("/restricted")).status).toBe(200);
  });
});
