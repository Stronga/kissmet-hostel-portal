import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { AdminService } from "./admin.service";
import { requirePermission } from "../middleware/auth.middleware";
import type { AuthUser } from "../auth/context";

const manager: AuthUser = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts: AuthUser = { ...manager, role: "accounts" };

class OpsRepo {
  rows: Record<string, Record<string, unknown>[]> = {
    maintenance_requests: [],
    staff: [{ id: 1, status: "active", role_code: "maintenance" }],
    announcements: [],
    audit_logs: [],
    beds: [{ id: 1, room_id: 1, status: "available" }, { id: 2, room_id: 1, status: "available" }, { id: 3, room_id: 2, status: "maintenance" }],
    rooms: [{ id: 1, room_code: "R1", capacity: 2, gender_policy: "female", status: "available" }, { id: 2, room_code: "R2", capacity: 1, gender_policy: "any", status: "available" }],
    room_rates: [{ room_id: 1, academic_session_id: 1, amount_minor: 250000, status: "active" }],
    allocations: [{ id: 1, bed_id: 1, academic_session_id: 1, status: "active" }],
    applications: [{ id: 1, academic_session_id: 1, status: "submitted" }, { id: 2, academic_session_id: 1, status: "approved" }],
    bookings: [{ id: 1, academic_session_id: 1, status: "confirmed", total_amount_minor: 250000, payment_attention_required: 1 }, { id: 2, academic_session_id: 1, status: "pending", total_amount_minor: 250000 }],
    payments: [{ id: 1, booking_id: 1, status: "verified", amount_minor: 250000 }, { id: 2, booking_id: 2, status: "verified", amount_minor: 100000 }, { id: 3, booking_id: 2, status: "refunded", amount_minor: 50000 }]
  };
  audits: string[] = [];
  seq = 1;

  async get(table: string, id: number) { return (this.rows[table] ?? []).find((r) => r.id === id) ?? null; }
  async list(table: string) { return { results: this.rows[table] ?? [] }; }
  async all<T>(sql: string, ...binds: unknown[]) {
    if (sql.includes("FROM audit_logs")) return { results: this.rows.audit_logs as T[] };
    if (sql.includes("FROM rooms r")) {
      return { results: this.rows.rooms.map((room) => ({ room_code: room.room_code, configured_capacity: room.capacity, active_bed_count: this.rows.beds.filter((b) => b.room_id === room.id && b.status === "available").length, occupied_bed_count: this.rows.allocations.filter((a) => a.status === "active" && a.academic_session_id === binds[0]).length, gender_policy: room.gender_policy, room_status: room.status, active_rate_minor: this.rows.room_rates.find((r) => r.room_id === room.id)?.amount_minor })) as T[] };
    }
    return { results: [] as T[] };
  }
  async first<T>(sql: string): Promise<T | null> {
    if (sql.includes("FROM staff")) return this.rows.staff[0] as T;
    if (sql.includes("total_usable_beds")) return { total_usable_beds: 2, occupied_beds: 1, available_beds: 1 } as T;
    if (sql.includes("expected_booking_revenue")) return { expected_booking_revenue: 500000, verified_payments: 350000, outstanding_booking_balances: 150000, refunded_totals: 50000, fully_paid_bookings: 1, partially_paid_bookings: 1, unpaid_bookings: 0, bookings_requiring_payment_attention: 1 } as T;
    if (sql.includes("draft_applications")) return { submitted_applications: 1, approved_applications: 1, pending_bookings: 1, confirmed_bookings: 1 } as T;
    if (sql.includes("FROM maintenance_requests WHERE status = 'open'")) return { open: 1, assigned: 0, in_progress: 0, resolved: 0, closed: 0, urgent: 1 } as T;
    return null;
  }
  async allocateMaintenanceRequestNumber() { return `KSM-MNT-${String(this.seq++).padStart(4, "0")}`; }
  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO maintenance_requests")) {
      const id = this.rows.maintenance_requests.length + 1;
      this.rows.maintenance_requests.push({ id, request_number: binds[0], resident_id: binds[1], room_id: binds[2], bed_id: binds[3], category: binds[4], priority: binds[5], status: "open", title: binds[6] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE maintenance_requests")) {
      const id = Number(binds.at(-1));
      const row = this.rows.maintenance_requests.find((r) => r.id === id);
      if (row) row.status = sql.includes("assigned_to_staff_id") ? "assigned" : binds[0];
    }
    if (sql.startsWith("INSERT INTO announcements")) {
      const id = this.rows.announcements.length + 1;
      this.rows.announcements.push({ id, title: binds[0], body: binds[1], audience: binds[2], status: "draft" });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE announcements")) {
      const id = Number(binds.at(-1));
      const row = this.rows.announcements.find((r) => r.id === id);
      if (row) row.status = sql.includes("status = ?") ? binds[0] : row.status;
    }
    return { meta: { last_row_id: 1, changes: 1 } };
  }
  async audit(_u: number | null, _s: number | null, action: string, entity: string, id: number | null) {
    this.audits.push(action);
    this.rows.audit_logs.push({ id: this.rows.audit_logs.length + 1, action, entity_type: entity, entity_id: id });
  }
}

function service(repo = new OpsRepo()) {
  return { svc: new AdminService(repo as never), repo };
}

describe("operations and reporting", () => {
  it("assigns and progresses maintenance through valid lifecycle", async () => {
    const { svc, repo } = service();
    const created = await svc.createMaintenance(manager, { residentId: 1, category: "plumbing", priority: "urgent", title: "Leak" }) as Record<string, unknown>;
    expect(created.request_number).toBe("KSM-MNT-0001");
    await svc.assignMaintenance(manager, 1, 1);
    await svc.updateMaintenanceStatus(manager, 1, "in_progress");
    await svc.updateMaintenanceStatus(manager, 1, "resolved");
    await svc.updateMaintenanceStatus(manager, 1, "closed");
    expect(repo.rows.maintenance_requests[0].status).toBe("closed");
    expect(repo.audits).toContain("admin.maintenance.closed");
  });

  it("rejects invalid maintenance transitions and unauthorized assignment permission", async () => {
    const { svc } = service();
    await svc.createMaintenance(manager, { category: "cleaning", title: "Clean" });
    await expect(svc.updateMaintenanceStatus(manager, 1, "closed")).rejects.toThrow("Invalid workflow transition");
    const app = new Hono<{ Variables: { authUser: AuthUser } }>();
    app.use("*", async (c, next) => { c.set("authUser", accounts); return next(); });
    app.post("/assign", requirePermission("maintenance:assign"), (c) => c.json({ ok: true }));
    expect((await app.request("/assign", { method: "POST" })).status).toBe(403);
  });

  it("creates updates and publishes announcements with audit events", async () => {
    const { svc, repo } = service();
    await svc.createAnnouncement(manager, { title: "Notice", body: "Body", audience: "residents" });
    await svc.updateAnnouncement(manager, 1, { title: "Updated" });
    await svc.updateAnnouncementStatus(manager, 1, "published");
    await expect(svc.updateAnnouncementStatus(manager, 1, "draft" as never)).rejects.toThrow("Invalid workflow transition");
    expect(repo.rows.announcements[0].status).toBe("published");
    expect(repo.audits).toContain("admin.announcement.published");
  });

  it("returns occupancy financial application booking and maintenance reports", async () => {
    const { svc } = service();
    await expect(svc.occupancyReport(1)).resolves.toMatchObject({ total_usable_beds: 2, occupied_beds: 1, available_beds: 1, occupancy_percentage: 50 });
    await expect(svc.financialReport()).resolves.toMatchObject({ verified_payments: 350000, refunded_totals: 50000, partially_paid_bookings: 1, bookings_requiring_payment_attention: 1 });
    await expect(svc.applicationBookingReport(1)).resolves.toMatchObject({ submitted_applications: 1, approved_applications: 1, pending_bookings: 1, confirmed_bookings: 1 });
    await expect(svc.maintenanceReport()).resolves.toMatchObject({ open: 1, urgent: 1 });
  });

  it("allows authorized audit-log access and rejects unauthorized role", async () => {
    const { svc, repo } = service();
    await expect(svc.auditLogs(manager, { action: null, entityType: null }, 25, 0)).resolves.toMatchObject({ results: expect.any(Array) });
    expect(repo.audits).toContain("admin.audit_logs.accessed");
    const app = new Hono<{ Variables: { authUser: AuthUser } }>();
    app.use("*", async (c, next) => { c.set("authUser", accounts); return next(); });
    app.get("/audit", requirePermission("audit:read"), (c) => c.json({ ok: true }));
    expect((await app.request("/audit")).status).toBe(403);
  });
});
