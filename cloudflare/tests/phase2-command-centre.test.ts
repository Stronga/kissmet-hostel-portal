import { describe, expect, it } from "vitest";
import type { AuthUser } from "../src/auth/context";
import { AdminRepository } from "../src/repositories/admin.repository";
import { CommandCentreService } from "../src/services/command-centre.service";
import { REFUND_SELF_APPROVAL_ERROR } from "../src/services/refund.service";
import { StaffTaskService } from "../src/services/staff-tasks.service";
import { all, createSqlJsD1, openMigratedDatabase, run } from "./apply-migrations";

function user(role: AuthUser["role"], staffId: number): AuthUser {
  return { id: staffId, userType: "staff", displayName: role, email: null, role, staffId, residentId: null, sessionId: 1 };
}

async function database() {
  const raw = await openMigratedDatabase();
  run(raw, `INSERT INTO roles (id, code, name, is_system) VALUES
    (1, 'super_admin', 'Super Admin', 1),
    (2, 'manager', 'Manager', 1),
    (3, 'reception', 'Reception', 1),
    (4, 'accounts', 'Accounts', 1),
    (5, 'maintenance', 'Maintenance', 1)`);
  run(raw, `INSERT INTO academic_sessions (id, code, name, starts_on, ends_on, status) VALUES
    (1, '2026', '2026/2027', '2026-09-01', '2027-06-30', 'active'),
    (2, '2027', '2027/2028', '2027-09-01', '2028-06-30', 'draft')`);
  run(raw, `INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status) VALUES
    ('short_term', 'ST-1', 'Short stay', '2027-01-01', '2027-03-31', 'active')`);
  run(raw, `INSERT INTO users (id, email, display_name, user_type, status) VALUES
    (1, 'mgr@test', 'Manager', 'staff', 'active'),
    (2, 'rec@test', 'Reception', 'staff', 'active'),
    (3, 'acc@test', 'Accounts', 'staff', 'active'),
    (4, 'mnt@test', 'Maintenance', 'staff', 'active'),
    (5, 'acc2@test', 'Accounts Two', 'staff', 'active')`);
  run(raw, `INSERT INTO staff (id, user_id, role_id, staff_code, status) VALUES
    (1, 1, 2, 'MGR', 'active'),
    (2, 2, 3, 'REC', 'active'),
    (3, 3, 4, 'ACC', 'active'),
    (4, 4, 5, 'MNT', 'active'),
    (5, 5, 4, 'ACC2', 'active')`);
  for (let i = 1; i <= 30; i += 1) {
    run(raw, `INSERT INTO users (id, email, display_name, user_type, status) VALUES (?, ?, 'Resident', 'resident', 'active')`, [100 + i, `r${i}@test`]);
    run(raw, `INSERT INTO residents (id, user_id, resident_code, first_name, last_name, status) VALUES (?, ?, ?, 'Ada', 'Resident', 'applicant')`, [i, 100 + i, `KSM-RES-${String(i).padStart(4, "0")}`]);
  }
  for (let i = 1; i <= 26; i += 1) {
    run(raw, `INSERT INTO applications (id, resident_id, academic_session_id, lease_kind, application_number, status, submitted_at) VALUES (?, ?, 1, 'academic_calendar', ?, 'submitted', '2026-11-01T00:00:00.000Z')`, [i, i, `KSM-APP-${String(i).padStart(4, "0")}`]);
  }
  run(raw, `INSERT INTO applications (id, resident_id, academic_session_id, lease_kind, application_number, status) VALUES (40, 27, 2, 'academic_calendar', 'KSM-APP-0040', 'draft')`);
  run(raw, `INSERT INTO applications (id, resident_id, academic_session_id, lease_kind, application_number, status) VALUES (41, 28, 2, 'academic_calendar', 'KSM-APP-0041', 'under_review')`);
  run(raw, `INSERT INTO lease_periods (id, kind, code, name, starts_on, ends_on, status) VALUES (2, 'calendar_year', 'CY-1', 'Calendar year', '2027-01-01', '2027-12-31', 'active')`);
  run(raw, `INSERT INTO applications (id, resident_id, academic_session_id, lease_period_id, lease_kind, application_number, status) VALUES (42, 29, NULL, 2, 'calendar_year', 'KSM-APP-0042', 'submitted')`);
  run(raw, `INSERT INTO applications (id, resident_id, academic_session_id, lease_kind, application_number, status) VALUES (43, 30, 1, 'academic_calendar', 'KSM-APP-0043', 'approved')`);
  run(raw, `INSERT INTO rooms (id, room_code, capacity, gender_policy, status) VALUES (1, 'ROOM-A', 2, 'any', 'available')`);
  run(raw, `INSERT INTO beds (id, room_id, bed_code, label, status) VALUES (1, 1, 'ROOM-A-1', 'A', 'available'), (2, 1, 'ROOM-A-2', 'B', 'available')`);
  run(raw, `INSERT INTO bookings (id, resident_id, academic_session_id, application_id, booking_number, status, total_amount_minor, currency) VALUES
    (1, 1, 1, 1, 'KSM-BKG-0001', 'confirmed', 100000, 'GHS')`);
  run(raw, `INSERT INTO payments (id, booking_id, resident_id, payment_reference, status, amount_minor, currency, method) VALUES
    (1, 1, 1, 'KSM-PAY-0001', 'pending', 10000, 'GHS', 'cash'),
    (2, 1, 1, 'KSM-PAY-0002', 'submitted', 20000, 'GHS', 'bank_transfer')`);
  run(raw, `INSERT INTO refunds (id, refund_number, payment_id, booking_id, resident_id, amount_minor, currency, status, reason, requested_by_staff_id) VALUES
    (1, 'KSM-RFD-0001', 2, 1, 1, 1000, 'GHS', 'requested', 'Overpayment', 3)`);
  run(raw, `INSERT INTO maintenance_requests (id, request_number, resident_id, category, priority, status, title) VALUES
    (1, 'KSM-MNT-0001', 1, 'plumbing', 'urgent', 'open', 'Leak'),
    (2, 'KSM-MNT-0002', 1, 'cleaning', 'normal', 'open', 'Corridor')`);
  run(raw, `INSERT INTO resident_internet_accounts (id, resident_id, router_username, sync_status, last_sync_error) VALUES
    (1, 2, 'KSM-RES-0002', 'failed', 'connector timeout')`);
  run(raw, `INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity_type, entity_id) VALUES (1, 1, 'admin.login', 'session', 1)`);
  return raw;
}

describe("Phase 2 command centre and staff tasks", () => {
  it("counts the full authorized set and defaults to all periods", async () => {
    const raw = await database();
    const svc = new CommandCentreService(new AdminRepository(createSqlJsD1(raw)));
    const allPeriods = await svc.commandCentre(user("manager", 1), { academicSessionId: null, leasePeriodId: null });
    expect(allPeriods.scope).toMatchObject({ mode: "all", label: "All periods" });
    expect(allPeriods.actionable.applicationsAwaitingReview).toBe(28);
    expect(allPeriods.actionable.draftApplications).toBe(1);
    expect(allPeriods.actionable.applicationsRequiringAttention).toBe(1);
    expect(allPeriods.actionable.agreementsAwaitingPreparation).toBe(1);
    expect(allPeriods.actionable.paymentsAwaitingVerification).toBe(2);
    expect(allPeriods.actionable.refundsAwaitingApproval).toBe(1);
    expect(allPeriods.actionable.bookingsAwaitingAllocation).toBe(1);
    expect(allPeriods.actionable.urgentMaintenance).toBe(1);
    expect(allPeriods.actionable.internetProvisioningFailures).toBe(1);
    expect(allPeriods.summary.totalResidents).toBe(30);
    expect(allPeriods.actionable.applicationsAwaitingReview).toBeGreaterThan(25);

    const session = await svc.commandCentre(user("manager", 1), { academicSessionId: 1, leasePeriodId: null });
    expect(session.scope.label).toBe("Academic session: 2026/2027");
    expect(session.actionable.applicationsAwaitingReview).toBe(26);
    expect(session.actionable.draftApplications).toBe(0);

    const period = await svc.commandCentre(user("manager", 1), { academicSessionId: null, leasePeriodId: 2 });
    expect(period.scope.label).toBe("Accommodation period: Calendar year");
    expect(period.actionable.applicationsAwaitingReview).toBe(1);
    expect(period.actionable.draftApplications).toBe(0);
  });

  it("filters lists on the server and returns a global total", async () => {
    const raw = await database();
    const svc = new CommandCentreService(new AdminRepository(createSqlJsD1(raw)));
    const page = await svc.listApplications({ academicSessionId: 1, leasePeriodId: null, queue: "awaiting_review", status: null, search: null, limit: 25, offset: 0 });
    expect(page.results).toHaveLength(25);
    expect(page.total).toBe(26);
    expect(page.counts.awaiting_review).toBe(26);
    const second = await svc.listApplications({ academicSessionId: null, leasePeriodId: 2, queue: null, status: null, search: null, limit: 25, offset: 0 });
    expect(second.total).toBe(1);
    expect(second.results[0]).toMatchObject({ application_number: "KSM-APP-0042" });
  });

  it("loads room and bed occupancy in one grouped read", async () => {
    const raw = await database();
    run(raw, `INSERT INTO allocations (booking_id, resident_id, academic_session_id, bed_id, status, starts_on) VALUES (1, 1, 1, 1, 'active', '2026-09-01')`);
    const svc = new CommandCentreService(new AdminRepository(createSqlJsD1(raw)));
    const report = await svc.occupancyRooms({ academicSessionId: null, leasePeriodId: null });
    expect(report.rooms).toHaveLength(1);
    expect(report.rooms[0].beds).toHaveLength(2);
    expect(report.rooms[0].occupiedBeds).toBe(1);
    expect(report.rooms[0].beds[0].occupant?.residentCode).toBe("KSM-RES-0001");
    expect(report.rooms[0].beds[1].occupant).toBeNull();
  });

  it("reconciles existing work, dedupes, and does not copy audit logs", async () => {
    const raw = await database();
    const tasks = new StaffTaskService(new AdminRepository(createSqlJsD1(raw)));
    await tasks.reconcile();
    await tasks.reconcile();
    const rows = all<{ dedupe_key: string; status: string; kind: string }>(raw, "SELECT dedupe_key, status, kind FROM staff_tasks ORDER BY dedupe_key");
    const review = rows.filter((row) => row.kind === "application_review");
    expect(review).toHaveLength(28);
    expect(new Set(review.map((row) => row.dedupe_key)).size).toBe(28);
    expect(rows.some((row) => row.kind === "agreement_preparation")).toBe(true);
    expect(rows.some((row) => String(row.dedupe_key).includes("audit"))).toBe(false);
    expect(rows.some((row) => row.kind === "payment_verification")).toBe(true);
    const before = rows.length;
    await Promise.all([tasks.syncSubject("application", 1), tasks.syncSubject("application", 1)]);
    expect(all(raw, "SELECT id FROM staff_tasks").length).toBe(before);
  });

  it("completes a task for every staff member without clearing another person's unread flag", async () => {
    const raw = await database();
    const db = createSqlJsD1(raw);
    const tasks = new StaffTaskService(new AdminRepository(db));
    await tasks.reconcile();
    const open = await tasks.list(user("manager", 1), "action_required", 50, 0);
    const target = open.results.find((row) => row.href.endsWith("record=1") && row.kind === "application_review");
    expect(target?.unresolved).toBe(true);
    expect(target?.unread).toBe(true);
    await tasks.markRead(user("manager", 1), target!.id);
    const afterRead = await tasks.list(user("manager", 1), "action_required", 50, 0);
    const readRow = afterRead.results.find((row) => row.id === target!.id);
    expect(readRow?.unread).toBe(false);
    expect(readRow?.unresolved).toBe(true);
    const other = await tasks.list(user("reception", 2), "action_required", 50, 0);
    expect(other.results.find((row) => row.id === target!.id)?.unread).toBe(true);

    run(raw, `UPDATE applications SET status = 'approved' WHERE id = 1`);
    await tasks.syncSubject("application", 1);
    const managerDone = await tasks.list(user("manager", 1), "completed", 100, 0);
    const receptionDone = await tasks.list(user("reception", 2), "completed", 100, 0);
    expect(managerDone.results.some((row) => row.id === target!.id && row.status === "completed")).toBe(true);
    expect(receptionDone.results.some((row) => row.id === target!.id && row.status === "completed")).toBe(true);
    expect(managerDone.results.find((row) => row.id === target!.id)?.unread).toBe(false);
    expect(receptionDone.results.find((row) => row.id === target!.id)?.unread).toBe(true);
  });

  it("limits the activity feed by role and keeps maker/checker on the workflow", async () => {
    const raw = await database();
    const db = createSqlJsD1(raw);
    const tasks = new StaffTaskService(new AdminRepository(db));
    const centre = new CommandCentreService(new AdminRepository(db));
    await tasks.reconcile();

    const reception = await tasks.list(user("reception", 2), "all", 100, 0);
    expect(reception.results.every((row) => ["application", "booking", "allocation"].includes(row.category))).toBe(true);
    expect(reception.results.some((row) => row.category === "refund" || row.category === "payment")).toBe(false);

    const accounts = await tasks.list(user("accounts", 3), "all", 100, 0);
    expect(accounts.results.every((row) => ["payment", "receipt", "refund"].includes(row.category))).toBe(true);
    expect(accounts.results.some((row) => row.category === "application")).toBe(false);

    const maintenance = await tasks.list(user("maintenance", 4), "action_required", 20, 0);
    expect(maintenance.results.every((row) => row.category === "maintenance")).toBe(true);
    expect(maintenance.total).toBe(2);

    const receptionCentre = await centre.commandCentre(user("reception", 2), { academicSessionId: null, leasePeriodId: null });
    expect(receptionCentre.actionable.paymentsAwaitingVerification).toBeUndefined();
    expect(receptionCentre.actionable.refundsAwaitingApproval).toBeUndefined();
    expect(receptionCentre.finance).toBeNull();
    expect(receptionCentre.actionable.applicationsAwaitingReview).toBe(28);

    const accountsCentre = await centre.commandCentre(user("accounts", 3), { academicSessionId: null, leasePeriodId: null });
    expect(accountsCentre.actionable.applicationsAwaitingReview).toBeUndefined();
    expect(accountsCentre.actionable.paymentsAwaitingVerification).toBe(2);
    expect(accountsCentre.summary.totalResidents).toBeUndefined();

    await expect(centre.workflow(user("maintenance", 4), "payment", 1)).rejects.toThrow(/Forbidden/);
    const blocked = await centre.workflow(user("accounts", 3), "refund", 1);
    expect(blocked.blockers).toContain(REFUND_SELF_APPROVAL_ERROR);
    expect(blocked.nextAction).toMatchObject({ permission: "refund:approve", blockedReason: REFUND_SELF_APPROVAL_ERROR });
    const allowed = await centre.workflow(user("accounts", 5), "refund", 1);
    expect(allowed.blockers).not.toContain(REFUND_SELF_APPROVAL_ERROR);
    expect(allowed.nextAction?.blockedReason).toBeNull();
  });

  it("degrades when the subject row has been removed and keeps a stable record link", async () => {
    const raw = await database();
    const db = createSqlJsD1(raw);
    const tasks = new StaffTaskService(new AdminRepository(db));
    const centre = new CommandCentreService(new AdminRepository(db));
    await tasks.syncSubject("maintenance", 1);
    const before = await tasks.list(user("maintenance", 4), "action_required", 10, 0);
    expect(before.results[0].href).toContain("record=1");
    run(raw, "DELETE FROM maintenance_requests WHERE id = 1");
    await tasks.syncSubject("maintenance", 1);
    const after = await tasks.list(user("manager", 1), "all", 20, 0);
    const gone = after.results.find((row) => row.kind === "maintenance_work" && row.subjectId === 1);
    expect(gone?.status).toBe("unavailable");
    expect(gone?.unresolved).toBe(false);
    const workflow = await centre.workflow(user("manager", 1), "maintenance", 1);
    expect(workflow.available).toBe(false);
    expect(workflow.unavailableReason).toMatch(/no longer available/i);
  });

  it("projects application guidance from the backend transition, including the agreement blocker", async () => {
    const raw = await database();
    const centre = new CommandCentreService(new AdminRepository(createSqlJsD1(raw)));
    const submitted = await centre.workflow(user("reception", 2), "application", 2);
    expect(submitted.steps.map((step) => step.state)).toEqual(["complete", "current", "upcoming", "upcoming"]);
    expect(submitted.nextAction).toMatchObject({ label: "Start review", permission: "application:write" });
    expect(submitted.dependencies?.[0]).toMatch(/corrections_required/);
    const approved = await centre.workflow(user("manager", 1), "application", 43);
    expect(approved.nextAction).toMatchObject({ label: "Prepare agreement", permission: "booking:write" });
    const booking = await centre.workflow(user("manager", 1), "booking", 1);
    expect(booking.steps.some((step) => step.id === "allocated" && step.state === "current")).toBe(true);
    expect(booking.nextAction).toMatchObject({ permission: "allocation:write" });
  });
});
