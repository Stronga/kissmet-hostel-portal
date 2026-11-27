import type { AuthUser } from "../auth/context";
import { hasPermission, type RoleCode } from "../auth/permissions";
import type { AdminRepository } from "../repositories/admin.repository";

export const TASK_CATEGORIES = [
  "application",
  "enquiry",
  "booking",
  "allocation",
  "payment",
  "receipt",
  "refund",
  "maintenance",
  "internet"
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type TaskSubjectType = "application" | "booking" | "allocation" | "payment" | "refund" | "maintenance" | "internet";
export type TaskStatus = "open" | "completed" | "unavailable";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type ActivityView = "action_required" | "all" | "completed";

const CATEGORY_ROLES: Record<TaskCategory, RoleCode[]> = {
  application: ["reception", "manager", "super_admin"],
  enquiry: ["reception", "manager", "super_admin"],
  booking: ["reception", "manager", "super_admin"],
  allocation: ["reception", "manager", "super_admin"],
  payment: ["accounts", "manager", "super_admin"],
  receipt: ["accounts", "manager", "super_admin"],
  refund: ["accounts", "manager", "super_admin"],
  maintenance: ["maintenance", "manager", "super_admin"],
  internet: ["manager", "super_admin"]
};

const CATEGORY_PERMISSION: Record<TaskCategory, string> = {
  application: "application:read",
  enquiry: "application:read",
  booking: "booking:read",
  allocation: "allocation:read",
  payment: "payment:read",
  receipt: "receipt:read",
  refund: "refund:read",
  maintenance: "maintenance:read",
  internet: "internet:read"
};

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export function categoryVisible(role: RoleCode | null, category: TaskCategory): boolean {
  if (!role || role === "resident") return false;
  return CATEGORY_ROLES[category].includes(role) && hasPermission(role, CATEGORY_PERMISSION[category]);
}

export function visibleCategories(role: RoleCode | null): TaskCategory[] {
  return TASK_CATEGORIES.filter((category) => categoryVisible(role, category));
}

type TaskDraft = {
  dedupeKey: string;
  category: TaskCategory;
  kind: string;
  subjectType: TaskSubjectType;
  subjectId: number;
  title: string;
  detail: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  href: string;
  unavailableReason?: string | null;
};

export class StaffTaskService {
  constructor(private readonly repo: AdminRepository) {}

  /** Idempotent upsert. Concurrent retries collapse on dedupe_key. */
  async upsert(task: TaskDraft) {
    await this.repo.run(
      `INSERT INTO staff_tasks (
         dedupe_key, category, kind, subject_type, subject_id, title, detail, priority, status, href,
         created_at, updated_at, completed_at, unavailable_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW}, ${NOW},
         CASE WHEN ? = 'completed' THEN ${NOW} ELSE NULL END, ?)
       ON CONFLICT(dedupe_key) DO UPDATE SET
         category = excluded.category,
         kind = excluded.kind,
         subject_type = excluded.subject_type,
         subject_id = excluded.subject_id,
         title = excluded.title,
         detail = excluded.detail,
         priority = excluded.priority,
         status = excluded.status,
         href = excluded.href,
         updated_at = ${NOW},
         completed_at = CASE
           WHEN excluded.status = 'open' THEN NULL
           WHEN excluded.status = 'completed' THEN COALESCE(staff_tasks.completed_at, ${NOW})
           ELSE staff_tasks.completed_at
         END,
         unavailable_reason = excluded.unavailable_reason`,
      task.dedupeKey,
      task.category,
      task.kind,
      task.subjectType,
      task.subjectId,
      task.title,
      task.detail,
      task.priority,
      task.status,
      task.href,
      task.status,
      task.unavailableReason ?? null
    );
  }

  async syncMany(subjects: Array<{ type: TaskSubjectType; id: number }>) {
    const seen = new Set<string>();
    for (const subject of subjects) {
      if (!Number.isInteger(subject.id) || subject.id <= 0) continue;
      const key = `${subject.type}:${subject.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.syncSubject(subject.type, subject.id);
    }
  }

  async syncSubject(type: TaskSubjectType, id: number) {
    if (type === "allocation") {
      const allocation = await this.repo.first<{ booking_id: number }>("SELECT booking_id FROM allocations WHERE id = ?", id);
      if (allocation) await this.syncSubject("booking", Number(allocation.booking_id));
      return;
    }
    const desired = await this.desiredFor(type, id);
    if (desired === null) {
      await this.repo.run(
        `UPDATE staff_tasks
         SET status = 'unavailable',
             unavailable_reason = 'Record no longer available',
             updated_at = ${NOW}
         WHERE subject_type = ? AND subject_id = ? AND status <> 'unavailable'`,
        type,
        id
      );
      return;
    }
    for (const task of desired) await this.upsert(task);
    await this.completeOpenExcept(type, id, desired.map((task) => task.dedupeKey));
    if (type === "booking") {
      const booking = await this.repo.first<{ application_id: number | null }>("SELECT application_id FROM bookings WHERE id = ?", id);
      if (booking?.application_id) await this.syncSubject("application", Number(booking.application_id));
    }
    if (type === "payment") {
      const payment = await this.repo.first<{ booking_id: number | null }>("SELECT booking_id FROM payments WHERE id = ?", id);
      if (payment?.booking_id) await this.syncSubject("booking", Number(payment.booking_id));
    }
  }

  private async completeOpenExcept(type: TaskSubjectType, id: number, keep: string[]) {
    const placeholders = keep.map(() => "?").join(", ");
    await this.repo.run(
      `UPDATE staff_tasks
       SET status = 'completed',
           completed_at = COALESCE(completed_at, ${NOW}),
           updated_at = ${NOW},
           unavailable_reason = NULL
       WHERE subject_type = ? AND subject_id = ? AND status = 'open'
         ${keep.length ? `AND dedupe_key NOT IN (${placeholders})` : ""}`,
      type,
      id,
      ...keep
    );
  }

  /**
   * Backfill and refresh every actionable subject. Safe to run repeatedly.
   * Does not read audit_logs.
   */
  async reconcile() {
    await this.upsertSet(applicationReviewSql());
    await this.upsertSet(agreementSql());
    await this.upsertSet(allocationSql());
    await this.upsertSet(paymentAttentionSql());
    await this.upsertSet(paymentVerifySql());
    await this.upsertSet(refundApprovalSql());
    await this.upsertSet(maintenanceSql());
    await this.upsertSet(internetSql());
    await this.markMissingUnavailable();
    await this.completeStale();
  }

  private async upsertSet(sql: string) {
    await this.repo.run(
      `INSERT INTO staff_tasks (
         dedupe_key, category, kind, subject_type, subject_id, title, detail, priority, status, href,
         created_at, updated_at, completed_at, unavailable_reason
       )
       ${sql}
       ON CONFLICT(dedupe_key) DO UPDATE SET
         title = excluded.title,
         detail = excluded.detail,
         priority = excluded.priority,
         status = 'open',
         href = excluded.href,
         updated_at = ${NOW},
         completed_at = NULL,
         unavailable_reason = NULL`
    );
  }

  private async markMissingUnavailable() {
    const pairs: Array<[TaskSubjectType, string]> = [
      ["application", "applications"],
      ["booking", "bookings"],
      ["payment", "payments"],
      ["refund", "refunds"],
      ["maintenance", "maintenance_requests"],
      ["internet", "resident_internet_accounts"]
    ];
    for (const [type, table] of pairs) {
      await this.repo.run(
        `UPDATE staff_tasks
         SET status = 'unavailable',
             unavailable_reason = 'Record no longer available',
             updated_at = ${NOW}
         WHERE subject_type = ? AND status <> 'unavailable'
           AND NOT EXISTS (SELECT 1 FROM ${table} s WHERE s.id = staff_tasks.subject_id)`,
        type
      );
    }
  }

  private async completeStale() {
    const closers: Array<[string, string]> = [
      ["application_review", `NOT EXISTS (SELECT 1 FROM applications a WHERE a.id = staff_tasks.subject_id AND a.status IN ('submitted', 'under_review'))`],
      ["agreement_preparation", `NOT EXISTS (
         SELECT 1 FROM applications a
         WHERE a.id = staff_tasks.subject_id AND a.status = 'approved'
           AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.application_id = a.id AND b.status IN ('pending', 'confirmed', 'completed'))
       )`],
      ["booking_allocation", `NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.id = staff_tasks.subject_id AND b.status = 'confirmed'
           AND NOT EXISTS (SELECT 1 FROM allocations al WHERE al.booking_id = b.id AND al.status = 'active')
       )`],
      ["payment_attention", `NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.id = staff_tasks.subject_id AND b.payment_attention_required = 1 AND b.status IN ('pending', 'confirmed')
       )`],
      ["payment_verification", `NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = staff_tasks.subject_id AND p.status IN ('pending', 'submitted'))`],
      ["refund_approval", `NOT EXISTS (SELECT 1 FROM refunds r WHERE r.id = staff_tasks.subject_id AND r.status = 'requested')`],
      ["maintenance_work", `NOT EXISTS (SELECT 1 FROM maintenance_requests m WHERE m.id = staff_tasks.subject_id AND m.status IN ('open', 'assigned', 'in_progress'))`],
      ["internet_sync", `NOT EXISTS (SELECT 1 FROM resident_internet_accounts ia WHERE ia.id = staff_tasks.subject_id AND ia.sync_status = 'failed')`]
    ];
    for (const [kind, predicate] of closers) {
      await this.repo.run(
        `UPDATE staff_tasks
         SET status = 'completed',
             completed_at = COALESCE(completed_at, ${NOW}),
             updated_at = ${NOW}
         WHERE kind = ? AND status = 'open' AND ${predicate}`,
        kind
      );
    }
  }

  async list(actor: AuthUser, view: ActivityView, limit: number, offset: number) {
    const categories = visibleCategories(actor.role);
    if (!categories.length || !actor.staffId) {
      return { results: [], total: 0, unreadCount: 0 };
    }
    const placeholders = categories.map(() => "?").join(", ");
    const viewSql = view === "action_required"
      ? "AND t.status = 'open'"
      : view === "completed"
        ? "AND t.status = 'completed'"
        : "";
    const binds = [...categories];
    const totalRow = await this.repo.first<{ total: number }>(
      `SELECT COUNT(*) AS total FROM staff_tasks t WHERE t.category IN (${placeholders}) ${viewSql}`,
      ...binds
    );
    const rows = await this.repo.all<Record<string, unknown>>(
      `SELECT t.*,
              CASE WHEN r.read_at IS NULL THEN 1 ELSE 0 END AS unread
       FROM staff_tasks t
       LEFT JOIN staff_task_reads r ON r.task_id = t.id AND r.staff_id = ?
       WHERE t.category IN (${placeholders}) ${viewSql}
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                t.updated_at DESC, t.id DESC
       LIMIT ? OFFSET ?`,
      actor.staffId,
      ...binds,
      limit,
      offset
    );
    const unreadRow = await this.repo.first<{ total: number }>(
      `SELECT COUNT(*) AS total
       FROM staff_tasks t
       LEFT JOIN staff_task_reads r ON r.task_id = t.id AND r.staff_id = ?
       WHERE t.category IN (${placeholders}) AND r.read_at IS NULL`,
      actor.staffId,
      ...binds
    );
    return {
      results: (rows.results ?? []).map(presentTask),
      total: Number(totalRow?.total ?? 0),
      unreadCount: Number(unreadRow?.total ?? 0)
    };
  }

  async unreadCount(actor: AuthUser) {
    const page = await this.list(actor, "all", 1, 0);
    return page.unreadCount;
  }

  /**
   * Records that this staff member has seen the task.
   * Does not complete or dismiss the underlying work.
   */
  async markRead(actor: AuthUser, taskId: number) {
    if (!actor.staffId) throw new Error("Invalid staff session");
    const task = await this.repo.first<Record<string, unknown>>("SELECT * FROM staff_tasks WHERE id = ?", taskId);
    if (!task) throw new Error("Task not found");
    if (!categoryVisible(actor.role, String(task.category) as TaskCategory)) throw new Error("Forbidden");
    await this.repo.run(
      `INSERT INTO staff_task_reads (staff_id, task_id, read_at) VALUES (?, ?, ${NOW})
       ON CONFLICT(staff_id, task_id) DO UPDATE SET read_at = excluded.read_at`,
      actor.staffId,
      taskId
    );
    const page = await this.repo.first<Record<string, unknown>>(
      `SELECT t.*, 0 AS unread FROM staff_tasks t WHERE t.id = ?`,
      taskId
    );
    return page ? presentTask(page) : null;
  }

  private async desiredFor(type: TaskSubjectType, id: number): Promise<TaskDraft[] | null> {
    if (type === "application") return this.applicationTasks(id);
    if (type === "booking") return this.bookingTasks(id);
    if (type === "payment") return this.paymentTasks(id);
    if (type === "refund") return this.refundTasks(id);
    if (type === "maintenance") return this.maintenanceTasks(id);
    return this.internetTasks(id);
  }

  private async applicationTasks(id: number): Promise<TaskDraft[] | null> {
    const row = await this.repo.first<{ id: number; application_number: string; status: string }>(
      "SELECT id, application_number, status FROM applications WHERE id = ?",
      id
    );
    if (!row) return null;
    const tasks: TaskDraft[] = [];
    if (row.status === "submitted" || row.status === "under_review") {
      tasks.push({
        dedupeKey: `application:${row.id}:review`,
        category: "application",
        kind: "application_review",
        subjectType: "application",
        subjectId: row.id,
        title: `Application ${row.application_number} awaiting review`,
        detail: row.status === "under_review" ? "Under review" : "Submitted",
        priority: "normal",
        status: "open",
        href: `/applications?queue=awaiting_review&record=${row.id}`
      });
    }
    if (row.status === "approved") {
      const booking = await this.repo.first(
        "SELECT id FROM bookings WHERE application_id = ? AND status IN ('pending', 'confirmed', 'completed') LIMIT 1",
        row.id
      );
      if (!booking) {
        tasks.push({
          dedupeKey: `application:${row.id}:agreement`,
          category: "application",
          kind: "agreement_preparation",
          subjectType: "application",
          subjectId: row.id,
          title: `Agreement to prepare for ${row.application_number}`,
          detail: "Approved application has no booking yet",
          priority: "normal",
          status: "open",
          href: `/applications?queue=agreements&record=${row.id}`
        });
      }
    }
    return tasks;
  }

  private async bookingTasks(id: number): Promise<TaskDraft[] | null> {
    const row = await this.repo.first<{ id: number; booking_number: string; status: string; application_id: number | null; payment_attention_required: number | null }>(
      "SELECT id, booking_number, status, application_id, payment_attention_required FROM bookings WHERE id = ?",
      id
    );
    if (!row) return null;
    const tasks: TaskDraft[] = [];
    if (row.status === "confirmed") {
      const allocation = await this.repo.first(
        "SELECT id FROM allocations WHERE booking_id = ? AND status = 'active' LIMIT 1",
        row.id
      );
      if (!allocation) {
        tasks.push({
          dedupeKey: `booking:${row.id}:allocation`,
          category: "allocation",
          kind: "booking_allocation",
          subjectType: "booking",
          subjectId: row.id,
          title: `Booking ${row.booking_number} awaiting allocation`,
          detail: "Confirmed booking has no active bed allocation",
          priority: "high",
          status: "open",
          href: `/bookings?queue=awaiting_allocation&record=${row.id}`
        });
      }
    }
    if ((row.status === "pending" || row.status === "confirmed") && Number(row.payment_attention_required) === 1) {
      tasks.push({
        dedupeKey: `booking:${row.id}:payment_attention`,
        category: "booking",
        kind: "payment_attention",
        subjectType: "booking",
        subjectId: row.id,
        title: `Booking ${row.booking_number} needs payment attention`,
        detail: "Payment attention flag is set",
        priority: "high",
        status: "open",
        href: `/bookings?queue=payment_attention&record=${row.id}`
      });
    }
    return tasks;
  }

  private async paymentTasks(id: number): Promise<TaskDraft[] | null> {
    const row = await this.repo.first<{ id: number; payment_reference: string; status: string; booking_id: number | null }>(
      "SELECT id, payment_reference, status, booking_id FROM payments WHERE id = ?",
      id
    );
    if (!row) return null;
    const tasks: TaskDraft[] = [];
    if (row.status === "pending" || row.status === "submitted") {
      tasks.push({
        dedupeKey: `payment:${row.id}:verify`,
        category: "payment",
        kind: "payment_verification",
        subjectType: "payment",
        subjectId: row.id,
        title: `Payment ${row.payment_reference} awaiting verification`,
        detail: row.status === "submitted" ? "Submitted" : "Pending",
        priority: "normal",
        status: "open",
        href: `/payments?queue=awaiting_verification&record=${row.id}`
      });
    }
    return tasks;
  }

  private async refundTasks(id: number): Promise<TaskDraft[] | null> {
    const row = await this.repo.first<{ id: number; refund_number: string; status: string }>(
      "SELECT id, refund_number, status FROM refunds WHERE id = ?",
      id
    );
    if (!row) return null;
    if (row.status !== "requested") return [];
    return [{
      dedupeKey: `refund:${row.id}:approval`,
      category: "refund",
      kind: "refund_approval",
      subjectType: "refund",
      subjectId: row.id,
      title: `Refund ${row.refund_number} awaiting approval`,
      detail: "Requested",
      priority: "high",
      status: "open",
      href: `/refunds?status=requested&record=${row.id}`
    }];
  }

  private async maintenanceTasks(id: number): Promise<TaskDraft[] | null> {
    const row = await this.repo.first<{ id: number; request_number: string; status: string; priority: string; title: string }>(
      "SELECT id, request_number, status, priority, title FROM maintenance_requests WHERE id = ?",
      id
    );
    if (!row) return null;
    if (!["open", "assigned", "in_progress"].includes(row.status)) return [];
    const priority: TaskPriority = row.priority === "urgent" || row.priority === "high" || row.priority === "low" ? row.priority : "normal";
    return [{
      dedupeKey: `maintenance:${row.id}:work`,
      category: "maintenance",
      kind: "maintenance_work",
      subjectType: "maintenance",
      subjectId: row.id,
      title: row.priority === "urgent"
        ? `Urgent maintenance ${row.request_number}`
        : `Maintenance ${row.request_number}`,
      detail: row.title,
      priority,
      status: "open",
      href: `/maintenance?record=${row.id}${row.priority === "urgent" ? "&priority=urgent&status=open" : ""}`
    }];
  }

  private async internetTasks(id: number): Promise<TaskDraft[] | null> {
    const row = await this.repo.first<{ id: number; router_username: string; sync_status: string; last_sync_error: string | null }>(
      "SELECT id, router_username, sync_status, last_sync_error FROM resident_internet_accounts WHERE id = ?",
      id
    );
    if (!row) return null;
    if (row.sync_status !== "failed") return [];
    return [{
      dedupeKey: `internet:${row.id}:sync`,
      category: "internet",
      kind: "internet_sync",
      subjectType: "internet",
      subjectId: row.id,
      title: `Internet provisioning failed for ${row.router_username}`,
      detail: row.last_sync_error ? "Sync failed" : "Sync failed",
      priority: "high",
      status: "open",
      href: `/internet-access?sync_status=failed&record=${row.id}`
    }];
  }
}

function presentTask(row: Record<string, unknown>) {
  const status = String(row.status);
  return {
    id: Number(row.id),
    category: String(row.category),
    kind: String(row.kind),
    subjectType: String(row.subject_type),
    subjectId: Number(row.subject_id),
    title: String(row.title),
    detail: row.detail == null ? null : String(row.detail),
    priority: String(row.priority),
    status,
    href: String(row.href),
    unread: Number(row.unread ?? 0) === 1,
    unresolved: status === "open",
    unavailableReason: row.unavailable_reason == null ? null : String(row.unavailable_reason),
    updatedAt: row.updated_at == null ? null : String(row.updated_at)
  };
}

function applicationReviewSql() {
  return `SELECT
    'application:' || a.id || ':review',
    'application', 'application_review', 'application', a.id,
    'Application ' || a.application_number || ' awaiting review',
    CASE a.status WHEN 'under_review' THEN 'Under review' ELSE 'Submitted' END,
    'normal', 'open',
    '/applications?queue=awaiting_review&record=' || a.id,
    ${NOW}, ${NOW}, NULL, NULL
  FROM applications a
  WHERE a.status IN ('submitted', 'under_review')`;
}

function agreementSql() {
  return `SELECT
    'application:' || a.id || ':agreement',
    'application', 'agreement_preparation', 'application', a.id,
    'Agreement to prepare for ' || a.application_number,
    'Approved application has no booking yet',
    'normal', 'open',
    '/applications?queue=agreements&record=' || a.id,
    ${NOW}, ${NOW}, NULL, NULL
  FROM applications a
  WHERE a.status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.application_id = a.id AND b.status IN ('pending', 'confirmed', 'completed')
    )`;
}

function allocationSql() {
  return `SELECT
    'booking:' || b.id || ':allocation',
    'allocation', 'booking_allocation', 'booking', b.id,
    'Booking ' || b.booking_number || ' awaiting allocation',
    'Confirmed booking has no active bed allocation',
    'high', 'open',
    '/bookings?queue=awaiting_allocation&record=' || b.id,
    ${NOW}, ${NOW}, NULL, NULL
  FROM bookings b
  WHERE b.status = 'confirmed'
    AND NOT EXISTS (SELECT 1 FROM allocations al WHERE al.booking_id = b.id AND al.status = 'active')`;
}

function paymentAttentionSql() {
  return `SELECT
    'booking:' || b.id || ':payment_attention',
    'booking', 'payment_attention', 'booking', b.id,
    'Booking ' || b.booking_number || ' needs payment attention',
    'Payment attention flag is set',
    'high', 'open',
    '/bookings?queue=payment_attention&record=' || b.id,
    ${NOW}, ${NOW}, NULL, NULL
  FROM bookings b
  WHERE b.payment_attention_required = 1 AND b.status IN ('pending', 'confirmed')`;
}

function paymentVerifySql() {
  return `SELECT
    'payment:' || p.id || ':verify',
    'payment', 'payment_verification', 'payment', p.id,
    'Payment ' || p.payment_reference || ' awaiting verification',
    CASE p.status WHEN 'submitted' THEN 'Submitted' ELSE 'Pending' END,
    'normal', 'open',
    '/payments?queue=awaiting_verification&record=' || p.id,
    ${NOW}, ${NOW}, NULL, NULL
  FROM payments p
  WHERE p.status IN ('pending', 'submitted')`;
}

function refundApprovalSql() {
  return `SELECT
    'refund:' || r.id || ':approval',
    'refund', 'refund_approval', 'refund', r.id,
    'Refund ' || r.refund_number || ' awaiting approval',
    'Requested',
    'high', 'open',
    '/refunds?status=requested&record=' || r.id,
    ${NOW}, ${NOW}, NULL, NULL
  FROM refunds r
  WHERE r.status = 'requested'`;
}

function maintenanceSql() {
  return `SELECT
    'maintenance:' || m.id || ':work',
    'maintenance', 'maintenance_work', 'maintenance', m.id,
    CASE WHEN m.priority = 'urgent'
      THEN 'Urgent maintenance ' || m.request_number
      ELSE 'Maintenance ' || m.request_number END,
    m.title,
    CASE m.priority WHEN 'urgent' THEN 'urgent' WHEN 'high' THEN 'high' WHEN 'low' THEN 'low' ELSE 'normal' END,
    'open',
    '/maintenance?record=' || m.id || CASE WHEN m.priority = 'urgent' THEN '&priority=urgent&status=open' ELSE '' END,
    ${NOW}, ${NOW}, NULL, NULL
  FROM maintenance_requests m
  WHERE m.status IN ('open', 'assigned', 'in_progress')`;
}

function internetSql() {
  return `SELECT
    'internet:' || ia.id || ':sync',
    'internet', 'internet_sync', 'internet', ia.id,
    'Internet provisioning failed for ' || ia.router_username,
    'Sync failed',
    'high', 'open',
    '/internet-access?sync_status=failed&record=' || ia.id,
    ${NOW}, ${NOW}, NULL, NULL
  FROM resident_internet_accounts ia
  WHERE ia.sync_status = 'failed'`;
}
