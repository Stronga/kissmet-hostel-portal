import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { AdminService } from "./admin.service";
import { requireRole } from "../middleware/auth.middleware";
import type { AuthUser } from "../auth/context";

const manager: AuthUser = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts: AuthUser = { ...manager, role: "accounts" };
const superAdmin: AuthUser = { ...manager, role: "super_admin" };

class FakeRepo {
  rows: Record<string, Record<string, unknown>[]> = {
    academic_sessions: [{ id: 1, code: "2026", status: "active" }],
    institutions: [],
    rooms: [{ id: 1, room_code: "R1", capacity: 2 }],
    beds: [],
    room_rates: [],
    residents: [],
    staff: [],
    roles: [{ id: 1, code: "manager" }],
    allocations: []
  };
  audits: string[] = [];
  nextResidentCode = 1;

  async list(table: string) { return { results: this.rows[table] ?? [] }; }
  async get(table: string, id: number) { return (this.rows[table] ?? []).find((r) => r.id === id) ?? null; }
  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
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
  async all<T>() { return { results: [] as T[] }; }
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
    if (sql.startsWith("INSERT INTO users")) return { meta: { last_row_id: 10 } };
    if (sql.startsWith("INSERT INTO residents")) {
      if (this.rows.residents.some((r) => r.resident_code === binds[2])) throw new Error("UNIQUE constraint failed: residents.resident_code");
      if (this.rows.residents.some((r) => r.institution_id === binds[1] && r.student_id === binds[3])) throw new Error("UNIQUE constraint failed");
      const id = this.rows.residents.length + 2;
      this.rows.residents.push({ id, user_id: binds[0], institution_id: binds[1], resident_code: binds[2], student_id: binds[3] });
      return { meta: { last_row_id: id } };
    }
    if (sql.startsWith("INSERT INTO staff")) this.rows.staff.push({ id: 1, user_id: binds[0], role_id: binds[1], staff_code: binds[2], status: "active" });
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
    const result = await svc.createStaff(superAdmin, { email: "new@test", username: "new", displayName: "New", roleId: 1, staffCode: "S1", password: "Password123!" });
    expect(repo.rows.staff).toHaveLength(1);
    expect(result.initialPassword).toBe("Password123!");
  });

  it("deactivates staff", async () => {
    const { service: svc, repo } = service();
    await svc.updateStatus(superAdmin, "staff", 1, "inactive");
    expect(repo.audits).toContain("admin.staff.status");
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
