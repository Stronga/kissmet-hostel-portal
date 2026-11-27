import type { AuthUser } from "../auth/context";
import { hasPermission } from "../auth/permissions";
import type { AdminRepository } from "../repositories/admin.repository";
import { AdminService } from "./admin.service";
import { REFUND_SELF_APPROVAL_ERROR } from "./refund.service";
import { categoryVisible, type TaskCategory } from "./staff-tasks.service";

export type PeriodScope = { academicSessionId: number | null; leasePeriodId: number | null };

const APPLICATION_STATUSES = ["draft", "submitted", "under_review", "approved", "rejected", "cancelled", "archived"];
const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "expired", "completed", "archived"];
const PAYMENT_STATUSES = ["pending", "submitted", "verified", "rejected", "refunded", "cancelled", "archived"];
const PAYMENT_METHODS = ["cash", "bank_transfer", "mobile_money", "card", "other"];
const ALLOCATION_STATUSES = ["active", "ended", "cancelled", "transferred", "archived"];
const MAINTENANCE_STATUSES = ["open", "assigned", "in_progress", "resolved", "closed", "cancelled", "archived"];
const MAINTENANCE_PRIORITIES = ["low", "normal", "high", "urgent"];
const RECEIPT_STATUSES = ["issued", "voided", "archived"];

export function readScope(url: URL): PeriodScope {
  const sessionRaw = url.searchParams.get("academicSessionId");
  const periodRaw = url.searchParams.get("leasePeriodId");
  if (sessionRaw && periodRaw) throw new Error("Invalid scope: choose an academic session or an accommodation period, not both");
  const academicSessionId = sessionRaw == null || sessionRaw === "" ? null : Number(sessionRaw);
  const leasePeriodId = periodRaw == null || periodRaw === "" ? null : Number(periodRaw);
  if (academicSessionId != null && (!Number.isInteger(academicSessionId) || academicSessionId <= 0)) throw new Error("Invalid academic session");
  if (leasePeriodId != null && (!Number.isInteger(leasePeriodId) || leasePeriodId <= 0)) throw new Error("Invalid accommodation period");
  return { academicSessionId, leasePeriodId };
}

function oneOf(value: string | null, allowed: string[], label: string) {
  if (!value || value === "all") return null;
  if (!allowed.includes(value)) throw new Error(`Invalid ${label}`);
  return value;
}

export class CommandCentreService {
  constructor(private readonly repo: AdminRepository) {}

  async commandCentre(actor: AuthUser, scope: PeriodScope) {
    const label = await this.scopeLabel(scope);
    const role = actor.role;
    const actionable: Record<string, number> = {};
    const summary: Record<string, number | string | null> = {};

    if (categoryVisible(role, "application")) {
      const applications = await this.applicationCounts(scope);
      actionable.applicationsAwaitingReview = applications.awaiting_review;
      actionable.draftApplications = applications.drafts;
      actionable.applicationsRequiringAttention = applications.under_review;
      actionable.agreementsAwaitingPreparation = applications.agreements;
    }
    if (categoryVisible(role, "payment")) {
      actionable.paymentsAwaitingVerification = await this.scalar(this.paymentCountSql(scope, "p.status IN ('pending', 'submitted')"));
    }
    if (categoryVisible(role, "refund")) {
      actionable.refundsAwaitingApproval = await this.scalar(this.refundCountSql(scope, "r.status = 'requested'"));
    }
    if (categoryVisible(role, "allocation")) {
      actionable.bookingsAwaitingAllocation = await this.scalar(this.bookingCountSql(scope, `b.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM allocations al WHERE al.booking_id = b.id AND al.status = 'active')`));
    }
    if (categoryVisible(role, "booking")) {
      actionable.operationalIssues = await this.scalar(this.bookingCountSql(scope, "b.payment_attention_required = 1 AND b.status IN ('pending', 'confirmed')"));
    }
    if (categoryVisible(role, "maintenance")) {
      actionable.urgentMaintenance = await this.scalar(this.maintenanceCountSql(scope, "m.priority = 'urgent' AND m.status IN ('open', 'assigned', 'in_progress')"));
    }
    if (categoryVisible(role, "internet")) {
      actionable.internetProvisioningFailures = await this.scalar(this.internetCountSql(scope));
    }

    if (hasPermission(role, "resident:read")) {
      const residents = await this.repo.first<{ total_residents: number; active_residents: number; applicants: number }>(`
        SELECT
          (SELECT COUNT(*) FROM residents) AS total_residents,
          (SELECT COUNT(*) FROM residents WHERE status = 'resident') AS active_residents,
          (SELECT COUNT(*) FROM residents WHERE status = 'applicant') AS applicants
      `);
      summary.totalResidents = Number(residents?.total_residents ?? 0);
      summary.activeResidents = Number(residents?.active_residents ?? 0);
      summary.applicants = Number(residents?.applicants ?? 0);
    }
    if (hasPermission(role, "allocation:read") || hasPermission(role, "admin:read")) {
      const occupancy = await this.occupancyTotals(scope);
      summary.occupiedBeds = occupancy.occupiedBeds;
      summary.availableBeds = occupancy.availableBeds;
      summary.occupancyPercentage = occupancy.occupancyPercentage;
    }

    let finance: Record<string, number> | null = null;
    if (categoryVisible(role, "payment") && hasPermission(role, "report:finance")) {
      finance = await this.finance(scope);
    }

    const sessions = await this.repo.all<{ id: number; name: string }>("SELECT id, name FROM academic_sessions ORDER BY starts_on DESC, id DESC");
    const periods = await this.repo.all<{ id: number; name: string; kind: string }>("SELECT id, name, kind FROM lease_periods ORDER BY starts_on DESC, id DESC");

    return {
      scope: {
        mode: scope.academicSessionId ? "academic_session" : scope.leasePeriodId ? "lease_period" : "all",
        label,
        academicSessionId: scope.academicSessionId,
        leasePeriodId: scope.leasePeriodId
      },
      actionable,
      summary,
      finance,
      periods: {
        academicSessions: sessions.results ?? [],
        leasePeriods: periods.results ?? []
      }
    };
  }

  async occupancyRooms(scope: PeriodScope) {
    const session = scope.academicSessionId;
    const period = scope.leasePeriodId;
    const allocationScope = session
      ? "AND a.academic_session_id = ?"
      : period
        ? "AND EXISTS (SELECT 1 FROM bookings bk WHERE bk.id = a.booking_id AND bk.lease_period_id = ?)"
        : "";
    const binds = session ? [session] : period ? [period] : [];
    const rows = await this.repo.all<Record<string, unknown>>(`
      SELECT r.id AS room_id, r.room_code, r.room_name, r.capacity, r.gender_policy, r.status AS room_status,
             b.id AS bed_id, b.bed_code, b.label AS bed_label, b.status AS bed_status,
             a.id AS allocation_id, res.resident_code, res.first_name, res.last_name
      FROM rooms r
      LEFT JOIN beds b ON b.room_id = r.id
      LEFT JOIN allocations a ON a.bed_id = b.id AND a.status = 'active' ${allocationScope}
      LEFT JOIN residents res ON res.id = a.resident_id
      ORDER BY r.room_code, b.label, b.id
    `, ...binds);
    const rooms = new Map<number, {
      id: number;
      roomCode: string;
      roomName: string | null;
      capacity: number;
      genderPolicy: string;
      status: string;
      occupiedBeds: number;
      beds: Array<{ id: number; bedCode: string; label: string; status: string; occupant: { allocationId: number; residentCode: string; name: string } | null }>;
    }>();
    for (const row of rows.results ?? []) {
      const roomId = Number(row.room_id);
      let room = rooms.get(roomId);
      if (!room) {
        room = {
          id: roomId,
          roomCode: String(row.room_code),
          roomName: row.room_name == null ? null : String(row.room_name),
          capacity: Number(row.capacity),
          genderPolicy: String(row.gender_policy),
          status: String(row.room_status),
          occupiedBeds: 0,
          beds: []
        };
        rooms.set(roomId, room);
      }
      if (row.bed_id == null) continue;
      const occupant = row.allocation_id == null ? null : {
        allocationId: Number(row.allocation_id),
        residentCode: String(row.resident_code ?? ""),
        name: [row.first_name, row.last_name].filter(Boolean).join(" ")
      };
      if (occupant) room.occupiedBeds += 1;
      room.beds.push({
        id: Number(row.bed_id),
        bedCode: String(row.bed_code),
        label: String(row.bed_label),
        status: String(row.bed_status),
        occupant
      });
    }
    return { rooms: [...rooms.values()] };
  }

  async listApplications(filters: PeriodScope & { status?: string | null; queue?: string | null; search?: string | null; limit: number; offset: number }) {
    const where = ["1 = 1"];
    const binds: unknown[] = [];
    this.pushScope(where, binds, "applications", filters);
    const status = oneOf(filters.status ?? null, APPLICATION_STATUSES, "application status");
    const queue = oneOf(filters.queue ?? null, ["awaiting_review", "drafts", "attention", "agreements"], "application queue");
    if (status) { where.push("status = ?"); binds.push(status); }
    if (queue === "awaiting_review") where.push("status IN ('submitted', 'under_review')");
    if (queue === "drafts") where.push("status = 'draft'");
    if (queue === "attention") where.push("status = 'under_review'");
    if (queue === "agreements") where.push("status = 'approved' AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.application_id = applications.id AND b.status IN ('pending', 'confirmed', 'completed'))");
    this.pushSearch(where, binds, ["application_number", "status"], filters.search);
    const page = await this.page("applications", where, binds, filters.limit, filters.offset);
    const counts = await this.applicationCounts(filters);
    return { ...page, counts };
  }

  async listBookings(filters: PeriodScope & { status?: string | null; queue?: string | null; search?: string | null; limit: number; offset: number }) {
    const where = ["1 = 1"];
    const binds: unknown[] = [];
    this.pushScope(where, binds, "bookings", filters);
    const status = oneOf(filters.status ?? null, BOOKING_STATUSES, "booking status");
    const queue = oneOf(filters.queue ?? null, ["awaiting_allocation", "payment_attention"], "booking queue");
    if (status) { where.push("status = ?"); binds.push(status); }
    if (queue === "awaiting_allocation") where.push("status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM allocations al WHERE al.booking_id = bookings.id AND al.status = 'active')");
    if (queue === "payment_attention") where.push("payment_attention_required = 1 AND status IN ('pending', 'confirmed')");
    this.pushSearch(where, binds, ["booking_number", "status"], filters.search);
    const page = await this.page("bookings", where, binds, filters.limit, filters.offset);
    const counts = {
      total: await this.scalar(this.bookingCountSql(filters, "1 = 1")),
      pending: await this.scalar(this.bookingCountSql(filters, "b.status = 'pending'")),
      confirmed: await this.scalar(this.bookingCountSql(filters, "b.status = 'confirmed'")),
      completed: await this.scalar(this.bookingCountSql(filters, "b.status = 'completed'")),
      awaitingAllocation: await this.scalar(this.bookingCountSql(filters, "b.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM allocations al WHERE al.booking_id = b.id AND al.status = 'active')")),
      paymentAttention: await this.scalar(this.bookingCountSql(filters, "b.payment_attention_required = 1 AND b.status IN ('pending', 'confirmed')"))
    };
    return { ...page, counts };
  }

  async listPayments(filters: PeriodScope & { status?: string | null; queue?: string | null; method?: string | null; search?: string | null; limit: number; offset: number }) {
    const where = ["1 = 1"];
    const binds: unknown[] = [];
    if (filters.academicSessionId) {
      where.push("EXISTS (SELECT 1 FROM bookings b WHERE b.id = payments.booking_id AND b.academic_session_id = ?)");
      binds.push(filters.academicSessionId);
    } else if (filters.leasePeriodId) {
      where.push("EXISTS (SELECT 1 FROM bookings b WHERE b.id = payments.booking_id AND b.lease_period_id = ?)");
      binds.push(filters.leasePeriodId);
    }
    const status = oneOf(filters.status ?? null, PAYMENT_STATUSES, "payment status");
    const method = oneOf(filters.method ?? null, PAYMENT_METHODS, "payment method");
    const queue = oneOf(filters.queue ?? null, ["awaiting_verification"], "payment queue");
    if (status) { where.push("status = ?"); binds.push(status); }
    if (method) { where.push("method = ?"); binds.push(method); }
    if (queue === "awaiting_verification") where.push("status IN ('pending', 'submitted')");
    this.pushSearch(where, binds, ["payment_reference", "status"], filters.search);
    const page = await this.page("payments", where, binds, filters.limit, filters.offset);
    const counts = {
      total: await this.scalar(this.paymentCountSql(filters, "1 = 1")),
      pending: await this.scalar(this.paymentCountSql(filters, "p.status = 'pending'")),
      submitted: await this.scalar(this.paymentCountSql(filters, "p.status = 'submitted'")),
      verified: await this.scalar(this.paymentCountSql(filters, "p.status = 'verified'")),
      rejected: await this.scalar(this.paymentCountSql(filters, "p.status = 'rejected'")),
      awaitingVerification: await this.scalar(this.paymentCountSql(filters, "p.status IN ('pending', 'submitted')"))
    };
    return { ...page, counts };
  }

  async listAllocations(filters: PeriodScope & { status?: string | null; search?: string | null; limit: number; offset: number }) {
    const where = ["1 = 1"];
    const binds: unknown[] = [];
    if (filters.academicSessionId) { where.push("academic_session_id = ?"); binds.push(filters.academicSessionId); }
    else if (filters.leasePeriodId) {
      where.push("EXISTS (SELECT 1 FROM bookings b WHERE b.id = allocations.booking_id AND b.lease_period_id = ?)");
      binds.push(filters.leasePeriodId);
    }
    const status = oneOf(filters.status ?? null, ALLOCATION_STATUSES, "allocation status");
    if (status) { where.push("status = ?"); binds.push(status); }
    this.pushSearch(where, binds, ["status"], filters.search);
    const page = await this.page("allocations", where, binds, filters.limit, filters.offset);
    const countWhere = filters.academicSessionId
      ? "a.academic_session_id = ?"
      : filters.leasePeriodId
        ? "EXISTS (SELECT 1 FROM bookings b WHERE b.id = a.booking_id AND b.lease_period_id = ?)"
        : "1 = 1";
    const countBinds = filters.academicSessionId ? [filters.academicSessionId] : filters.leasePeriodId ? [filters.leasePeriodId] : [];
    const count = async (extra: string) => {
      const row = await this.repo.first<{ total: number }>(`SELECT COUNT(*) AS total FROM allocations a WHERE ${countWhere} AND ${extra}`, ...countBinds);
      return Number(row?.total ?? 0);
    };
    return {
      ...page,
      counts: {
        total: await count("1 = 1"),
        active: await count("a.status = 'active'"),
        transferred: await count("a.status = 'transferred'")
      }
    };
  }

  async listMaintenance(filters: { status?: string | null; priority?: string | null; search?: string | null; limit: number; offset: number }) {
    const where = ["1 = 1"];
    const binds: unknown[] = [];
    const status = oneOf(filters.status ?? null, MAINTENANCE_STATUSES, "maintenance status");
    const priority = oneOf(filters.priority ?? null, MAINTENANCE_PRIORITIES, "maintenance priority");
    if (status) { where.push("status = ?"); binds.push(status); }
    if (priority) { where.push("priority = ?"); binds.push(priority); }
    this.pushSearch(where, binds, ["request_number", "title", "status"], filters.search);
    return this.page("maintenance_requests", where, binds, filters.limit, filters.offset);
  }

  async listReceipts(filters: { status?: string | null; search?: string | null; limit: number; offset: number }) {
    const where = ["1 = 1"];
    const binds: unknown[] = [];
    const status = oneOf(filters.status ?? null, RECEIPT_STATUSES, "receipt status");
    if (status) { where.push("status = ?"); binds.push(status); }
    this.pushSearch(where, binds, ["receipt_number", "status"], filters.search);
    const page = await this.page("receipts", where, binds, filters.limit, filters.offset);
    const issued = await this.repo.first<{ total: number }>("SELECT COUNT(*) AS total FROM receipts WHERE status = 'issued'");
    const voided = await this.repo.first<{ total: number }>("SELECT COUNT(*) AS total FROM receipts WHERE status = 'voided'");
    return { ...page, counts: { issued: Number(issued?.total ?? 0), voided: Number(voided?.total ?? 0), total: page.total } };
  }

  async workflow(actor: AuthUser, subjectType: string, subjectId: number) {
    const permission = workflowPermission(subjectType);
    if (!permission || !hasPermission(actor.role, permission)) throw new Error("Forbidden");
    if (subjectType === "application") return this.applicationWorkflow(subjectId);
    if (subjectType === "booking") return this.bookingWorkflow(subjectId);
    if (subjectType === "payment") return this.paymentWorkflow(subjectId);
    if (subjectType === "refund") return this.refundWorkflow(actor, subjectId);
    if (subjectType === "allocation") return this.allocationWorkflow(subjectId);
    if (subjectType === "maintenance") return this.maintenanceWorkflow(actor, subjectId);
    if (subjectType === "internet") return this.internetWorkflow(subjectId);
    throw new Error("Invalid workflow subject");
  }

  private unavailable(subjectType: string, subjectId: number) {
    return {
      subjectType,
      subjectId,
      available: false,
      status: null,
      unavailableReason: "This record is no longer available.",
      steps: [],
      nextAction: null,
      responsibleRole: null,
      blockers: ["This record is no longer available."]
    };
  }

  private async applicationWorkflow(id: number) {
    const row = await this.repo.first<Record<string, unknown>>("SELECT * FROM applications WHERE id = ?", id);
    if (!row) return this.unavailable("application", id);
    const status = String(row.status);
    const booking = await this.repo.first("SELECT id FROM bookings WHERE application_id = ? AND status IN ('pending', 'confirmed', 'completed') LIMIT 1", id);
    const steps = [
      step("draft", "Draft", status === "draft" ? "current" : "complete"),
      step("submitted", "Submitted", status === "draft" ? "upcoming" : status === "submitted" ? "current" : "complete"),
      step("under_review", "Under review", status === "submitted" || status === "draft" ? "upcoming" : status === "under_review" ? "current" : "complete"),
      step("decision", "Decision", status === "approved" || status === "rejected" ? "complete" : status === "cancelled" || status === "archived" ? "blocked" : "upcoming", decisionDetail(status))
    ];
    if (status === "approved") {
      steps.push(step("agreement", "Agreement", booking ? "complete" : "current", booking ? "Booking exists" : "No booking yet"));
    }
    const next = nextApplicationAction(status, Boolean(booking));
    return {
      subjectType: "application",
      subjectId: id,
      available: true,
      status,
      steps,
      nextAction: next,
      responsibleRole: next?.responsibleRole ?? null,
      blockers: next?.blockedReason ? [next.blockedReason] : [],
      dependencies: ["corrections_required and withdrawn are Phase 4 statuses and are not shown here."]
    };
  }

  private async bookingWorkflow(id: number) {
    const row = await this.repo.first<Record<string, unknown>>("SELECT * FROM bookings WHERE id = ?", id);
    if (!row) return this.unavailable("booking", id);
    const status = String(row.status);
    let confirmationMet = false;
    let blocker: string | null = null;
    try {
      const summary = await new AdminService(this.repo).bookingPaymentSummary(id);
      confirmationMet = Boolean(summary.confirmationRequirementMet);
      if (status === "pending" && !confirmationMet) blocker = "Payment confirmation requirement not satisfied";
    } catch (error) {
      blocker = error instanceof Error ? error.message : "Payment summary is unavailable";
    }
    const allocation = await this.repo.first("SELECT id FROM allocations WHERE booking_id = ? AND status = 'active' LIMIT 1", id);
    const steps = [
      step("pending", "Agreement pending", status === "pending" ? "current" : pastBooking(status) ? "complete" : "blocked"),
      step("payment", "Payment threshold", confirmationMet ? "complete" : status === "pending" ? "current" : "upcoming", blocker ?? undefined),
      step("confirmed", "Confirmed", status === "confirmed" || status === "completed" ? "complete" : status === "pending" ? "upcoming" : "blocked"),
      step("allocated", "Bed allocated", allocation ? "complete" : status === "confirmed" ? "current" : "upcoming")
    ];
    const next = status === "pending"
      ? { label: "Confirm booking", permission: "booking:confirm", responsibleRole: "Accounts or Manager", blockedReason: blocker }
      : status === "confirmed" && !allocation
        ? { label: "Allocate a bed", permission: "allocation:write", responsibleRole: "Reception or Manager", blockedReason: null }
        : null;
    return { subjectType: "booking", subjectId: id, available: true, status, steps, nextAction: next, responsibleRole: next?.responsibleRole ?? null, blockers: blocker ? [blocker] : [] };
  }

  private async paymentWorkflow(id: number) {
    const row = await this.repo.first<Record<string, unknown>>("SELECT * FROM payments WHERE id = ?", id);
    if (!row) return this.unavailable("payment", id);
    const status = String(row.status);
    const rank = ["pending", "submitted", "verified"];
    const at = rank.indexOf(status);
    const terminal = status === "rejected" || status === "cancelled" || status === "archived";
    const steps = ["pending", "submitted", "verified"].map((name, index) => {
      let state: "complete" | "current" | "upcoming" | "blocked" = "upcoming";
      if (terminal) state = name === "verified" ? "blocked" : "complete";
      else if (status === "refunded") state = "complete";
      else if (at === index) state = "current";
      else if (at > index) state = "complete";
      return step(name, labelize(name), state);
    });
    const next = status === "pending" || status === "submitted"
      ? { label: "Verify payment", permission: "payment:verify", responsibleRole: "Accounts or Manager", blockedReason: null }
      : null;
    return { subjectType: "payment", subjectId: id, available: true, status, steps, nextAction: next, responsibleRole: next?.responsibleRole ?? null, blockers: [] };
  }

  private async refundWorkflow(actor: AuthUser, id: number) {
    const row = await this.repo.first<Record<string, unknown>>("SELECT * FROM refunds WHERE id = ?", id);
    if (!row) return this.unavailable("refund", id);
    const status = String(row.status);
    const order = ["requested", "approved", "paid"];
    const at = order.indexOf(status);
    const steps = order.map((name, index) => step(name, labelize(name), status === "rejected" || status === "cancelled" ? (index === 0 ? "complete" : "blocked") : at === index ? "current" : at > index ? "complete" : "upcoming"));
    const self = actor.staffId != null && Number(row.requested_by_staff_id) === Number(actor.staffId);
    const blocker = status === "requested" && self ? REFUND_SELF_APPROVAL_ERROR : null;
    const next = status === "requested"
      ? { label: "Approve refund", permission: "refund:approve", responsibleRole: "A different Accounts or Manager user", blockedReason: blocker }
      : status === "approved"
        ? { label: "Record payout", permission: "refund:payout", responsibleRole: "Accounts or Manager", blockedReason: null }
        : null;
    return { subjectType: "refund", subjectId: id, available: true, status, steps, nextAction: next, responsibleRole: next?.responsibleRole ?? null, blockers: blocker ? [blocker] : [] };
  }

  private async allocationWorkflow(id: number) {
    const row = await this.repo.first<Record<string, unknown>>("SELECT * FROM allocations WHERE id = ?", id);
    if (!row) return this.unavailable("allocation", id);
    const booking = await this.repo.first<{ status: string }>("SELECT status FROM bookings WHERE id = ?", row.booking_id);
    const status = String(row.status);
    const confirmed = booking?.status === "confirmed" || booking?.status === "completed";
    const steps = [
      step("booking", "Booking confirmed", confirmed ? "complete" : "blocked", booking ? `Booking is ${booking.status}` : "Booking is missing"),
      step("active", "Bed allocated", status === "active" ? "current" : status === "ended" || status === "transferred" ? "complete" : "blocked")
    ];
    const blocker = confirmed ? null : "Allocation requires a confirmed booking";
    return {
      subjectType: "allocation",
      subjectId: id,
      available: true,
      status,
      steps,
      nextAction: status === "active" ? { label: "End or transfer allocation", permission: "allocation:write", responsibleRole: "Reception or Manager", blockedReason: null } : null,
      responsibleRole: "Reception or Manager",
      blockers: blocker ? [blocker] : []
    };
  }

  private async maintenanceWorkflow(actor: AuthUser, id: number) {
    const row = await this.repo.first<Record<string, unknown>>("SELECT * FROM maintenance_requests WHERE id = ?", id);
    if (!row) return this.unavailable("maintenance", id);
    const status = String(row.status);
    const order = ["open", "assigned", "in_progress", "resolved", "closed"];
    const at = order.indexOf(status);
    const steps = order.map((name, index) => step(
      name,
      labelize(name),
      status === "cancelled" || status === "archived" ? (index === 0 ? "complete" : "blocked") : at === index ? "current" : at > index ? "complete" : "upcoming"
    ));
    const next = maintenanceNext(status, hasPermission(actor.role, "maintenance:assign"), hasPermission(actor.role, "maintenance:update"), hasPermission(actor.role, "maintenance:resolve"), hasPermission(actor.role, "maintenance:close"));
    return { subjectType: "maintenance", subjectId: id, available: true, status, steps, nextAction: next, responsibleRole: next?.responsibleRole ?? "Maintenance", blockers: next?.blockedReason ? [next.blockedReason] : [] };
  }

  private async internetWorkflow(id: number) {
    const row = await this.repo.first<Record<string, unknown>>("SELECT * FROM resident_internet_accounts WHERE id = ?", id);
    if (!row) return this.unavailable("internet", id);
    const sync = String(row.sync_status);
    const steps = [
      step("account", "Account", "complete"),
      step("sync", "Provisioning", sync === "synced" ? "complete" : sync === "failed" ? "blocked" : "current", sync === "failed" ? "Sync failed" : sync)
    ];
    const next = sync === "failed"
      ? { label: "Retry provisioning", permission: "internet:manage", responsibleRole: "Manager", blockedReason: null }
      : null;
    return { subjectType: "internet", subjectId: id, available: true, status: sync, steps, nextAction: next, responsibleRole: next?.responsibleRole ?? null, blockers: sync === "failed" ? ["Internet provisioning failed"] : [] };
  }

  private async applicationCounts(scope: PeriodScope) {
    const sql = (extra: string) => this.applicationCountSql(scope, extra);
    const [drafts, submitted, underReview, approved, agreements, total] = await Promise.all([
      this.scalar(sql("a.status = 'draft'")),
      this.scalar(sql("a.status = 'submitted'")),
      this.scalar(sql("a.status = 'under_review'")),
      this.scalar(sql("a.status = 'approved'")),
      this.scalar(sql(`a.status = 'approved' AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.application_id = a.id AND b.status IN ('pending', 'confirmed', 'completed'))`)),
      this.scalar(sql("1 = 1"))
    ]);
    return {
      drafts,
      submitted,
      under_review: underReview,
      approved,
      awaiting_review: submitted + underReview,
      agreements,
      total
    };
  }

  private applicationCountSql(scope: PeriodScope, extra: string) {
    const scopeSql = scope.academicSessionId ? "a.academic_session_id = ?" : scope.leasePeriodId ? "a.lease_period_id = ?" : "1 = 1";
    const bind = scope.academicSessionId ?? scope.leasePeriodId;
    return { sql: `SELECT COUNT(*) AS total FROM applications a WHERE ${scopeSql} AND ${extra}`, binds: bind == null ? [] : [bind] };
  }

  private bookingCountSql(scope: PeriodScope, extra: string) {
    const scopeSql = scope.academicSessionId ? "b.academic_session_id = ?" : scope.leasePeriodId ? "b.lease_period_id = ?" : "1 = 1";
    const bind = scope.academicSessionId ?? scope.leasePeriodId;
    return { sql: `SELECT COUNT(*) AS total FROM bookings b WHERE ${scopeSql} AND ${extra}`, binds: bind == null ? [] : [bind] };
  }

  private paymentCountSql(scope: PeriodScope, extra: string) {
    const scopeSql = scope.academicSessionId
      ? "EXISTS (SELECT 1 FROM bookings b WHERE b.id = p.booking_id AND b.academic_session_id = ?)"
      : scope.leasePeriodId
        ? "EXISTS (SELECT 1 FROM bookings b WHERE b.id = p.booking_id AND b.lease_period_id = ?)"
        : "1 = 1";
    const bind = scope.academicSessionId ?? scope.leasePeriodId;
    return { sql: `SELECT COUNT(*) AS total FROM payments p WHERE ${scopeSql} AND ${extra}`, binds: bind == null ? [] : [bind] };
  }

  private refundCountSql(scope: PeriodScope, extra: string) {
    const scopeSql = scope.academicSessionId
      ? "EXISTS (SELECT 1 FROM bookings b WHERE b.id = r.booking_id AND b.academic_session_id = ?)"
      : scope.leasePeriodId
        ? "EXISTS (SELECT 1 FROM bookings b WHERE b.id = r.booking_id AND b.lease_period_id = ?)"
        : "1 = 1";
    const bind = scope.academicSessionId ?? scope.leasePeriodId;
    return { sql: `SELECT COUNT(*) AS total FROM refunds r WHERE ${scopeSql} AND ${extra}`, binds: bind == null ? [] : [bind] };
  }

  private maintenanceCountSql(scope: PeriodScope, extra: string) {
    const scopeSql = scope.academicSessionId
      ? "EXISTS (SELECT 1 FROM bookings b WHERE b.resident_id = m.resident_id AND b.academic_session_id = ?)"
      : scope.leasePeriodId
        ? "EXISTS (SELECT 1 FROM bookings b WHERE b.resident_id = m.resident_id AND b.lease_period_id = ?)"
        : "1 = 1";
    const bind = scope.academicSessionId ?? scope.leasePeriodId;
    return { sql: `SELECT COUNT(*) AS total FROM maintenance_requests m WHERE ${scopeSql} AND ${extra}`, binds: bind == null ? [] : [bind] };
  }

  private internetCountSql(scope: PeriodScope) {
    const scopeSql = scope.academicSessionId
      ? "EXISTS (SELECT 1 FROM bookings b WHERE b.resident_id = ia.resident_id AND b.academic_session_id = ?)"
      : scope.leasePeriodId
        ? "EXISTS (SELECT 1 FROM bookings b WHERE b.resident_id = ia.resident_id AND b.lease_period_id = ?)"
        : "1 = 1";
    const bind = scope.academicSessionId ?? scope.leasePeriodId;
    return { sql: `SELECT COUNT(*) AS total FROM resident_internet_accounts ia WHERE ia.sync_status = 'failed' AND ${scopeSql}`, binds: bind == null ? [] : [bind] };
  }

  private async finance(scope: PeriodScope) {
    const bookingScope = scope.academicSessionId ? "AND b.academic_session_id = ?" : scope.leasePeriodId ? "AND b.lease_period_id = ?" : "";
    const paymentScope = scope.academicSessionId
      ? "AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = p.booking_id AND b.academic_session_id = ?)"
      : scope.leasePeriodId
        ? "AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = p.booking_id AND b.lease_period_id = ?)"
        : "";
    const bind = scope.academicSessionId ?? scope.leasePeriodId;
    const binds = bind == null ? [] : [bind, bind, bind, bind];
    const row = await this.repo.first<Record<string, number>>(`
      SELECT
        (SELECT COALESCE(SUM(b.total_amount_minor + COALESCE(b.maintenance_fee_minor, 0)), 0) FROM bookings b WHERE b.status IN ('pending', 'confirmed', 'completed') ${bookingScope}) AS expected_booking_revenue,
        (SELECT COALESCE(SUM(p.amount_minor - p.refunded_amount_minor), 0) FROM payments p WHERE p.status = 'verified' ${paymentScope}) AS verified_payments,
        (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p WHERE p.status IN ('pending', 'submitted') ${paymentScope}) AS awaiting_verification_total,
        (SELECT COUNT(*) FROM payments p WHERE p.status IN ('pending', 'submitted') ${paymentScope}) AS awaiting_verification_count
    `, ...binds);
    const expected = Number(row?.expected_booking_revenue ?? 0);
    const verified = Number(row?.verified_payments ?? 0);
    return {
      expectedBookingRevenue: expected,
      verifiedPayments: verified,
      outstandingBookingBalances: expected - verified,
      paymentsAwaitingVerificationCount: Number(row?.awaiting_verification_count ?? 0),
      paymentsAwaitingVerificationTotal: Number(row?.awaiting_verification_total ?? 0)
    };
  }

  private async occupancyTotals(scope: PeriodScope) {
    const occupiedSql = scope.academicSessionId
      ? "SELECT COUNT(*) AS total FROM allocations WHERE status = 'active' AND academic_session_id = ?"
      : scope.leasePeriodId
        ? "SELECT COUNT(*) AS total FROM allocations a WHERE a.status = 'active' AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = a.booking_id AND b.lease_period_id = ?)"
        : "SELECT COUNT(*) AS total FROM allocations WHERE status = 'active'";
    const bind = scope.academicSessionId ?? scope.leasePeriodId;
    const occupiedRow = await this.repo.first<{ total: number }>(occupiedSql, ...(bind == null ? [] : [bind]));
    const bedsRow = await this.repo.first<{ total: number }>("SELECT COUNT(*) AS total FROM beds WHERE status = 'available'");
    const occupiedBeds = Number(occupiedRow?.total ?? 0);
    const usable = Number(bedsRow?.total ?? 0);
    const availableBeds = usable - occupiedBeds;
    return {
      occupiedBeds,
      availableBeds,
      occupancyPercentage: usable ? Math.round((occupiedBeds * 10000) / usable) / 100 : 0
    };
  }

  private async scopeLabel(scope: PeriodScope) {
    if (scope.academicSessionId) {
      const row = await this.repo.first<{ name: string }>("SELECT name FROM academic_sessions WHERE id = ?", scope.academicSessionId);
      return row ? `Academic session: ${row.name}` : `Academic session #${scope.academicSessionId} (not found)`;
    }
    if (scope.leasePeriodId) {
      const row = await this.repo.first<{ name: string }>("SELECT name FROM lease_periods WHERE id = ?", scope.leasePeriodId);
      return row ? `Accommodation period: ${row.name}` : `Accommodation period #${scope.leasePeriodId} (not found)`;
    }
    return "All periods";
  }

  private pushScope(where: string[], binds: unknown[], table: "applications" | "bookings", scope: PeriodScope) {
    if (scope.academicSessionId) { where.push("academic_session_id = ?"); binds.push(scope.academicSessionId); }
    else if (scope.leasePeriodId) { where.push("lease_period_id = ?"); binds.push(scope.leasePeriodId); }
    void table;
  }

  private pushSearch(where: string[], binds: unknown[], columns: string[], search?: string | null) {
    const term = search?.trim();
    if (!term) return;
    where.push(`(${columns.map((column) => `${column} LIKE ?`).join(" OR ")})`);
    for (const _column of columns) binds.push(`%${term}%`);
  }

  private async page(table: string, where: string[], binds: unknown[], limit: number, offset: number) {
    const clause = where.join(" AND ");
    const totalRow = await this.repo.first<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE ${clause}`, ...binds);
    const rows = await this.repo.all(`SELECT * FROM ${table} WHERE ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, ...binds, limit, offset);
    return { results: rows.results ?? [], total: Number(totalRow?.total ?? 0) };
  }

  private async scalar(query: { sql: string; binds: unknown[] }) {
    const row = await this.repo.first<{ total: number }>(query.sql, ...query.binds);
    return Number(row?.total ?? 0);
  }
}

function step(id: string, label: string, state: "complete" | "current" | "upcoming" | "blocked", detail?: string) {
  return { id, label, state, detail: detail ?? null };
}

function decisionDetail(status: string) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "cancelled") return "Cancelled";
  if (status === "archived") return "Archived";
  return undefined;
}

function pastBooking(status: string) {
  return status === "confirmed" || status === "completed";
}

function labelize(value: string) {
  return value.replaceAll("_", " ").replace(/^\w/, (char) => char.toUpperCase());
}

function nextApplicationAction(status: string, hasBooking: boolean) {
  if (status === "draft") return { label: "Submit application", permission: "application:write", responsibleRole: "Reception or the applicant", blockedReason: null };
  if (status === "submitted") return { label: "Start review", permission: "application:write", responsibleRole: "Reception or Manager", blockedReason: null };
  if (status === "under_review") return { label: "Approve or reject", permission: "application:write", responsibleRole: "Reception or Manager", blockedReason: null };
  if (status === "approved" && !hasBooking) return { label: "Prepare agreement", permission: "booking:write", responsibleRole: "Reception or Manager", blockedReason: null };
  return null;
}

function maintenanceNext(status: string, canAssign: boolean, canUpdate: boolean, canResolve: boolean, canClose: boolean) {
  if (status === "open") return { label: "Assign maintenance", permission: "maintenance:assign", responsibleRole: "Reception or Manager", blockedReason: canAssign ? null : "This role cannot assign maintenance" };
  if (status === "assigned") return { label: "Start work", permission: "maintenance:update", responsibleRole: "Maintenance", blockedReason: canUpdate ? null : "This role cannot update maintenance" };
  if (status === "in_progress") return { label: "Resolve request", permission: "maintenance:resolve", responsibleRole: "Maintenance", blockedReason: canResolve ? null : "This role cannot resolve maintenance" };
  if (status === "resolved") return { label: "Close request", permission: "maintenance:close", responsibleRole: "Manager", blockedReason: canClose ? null : "This role cannot close maintenance" };
  return null;
}

function workflowPermission(subjectType: string): string | null {
  if (subjectType === "application") return "application:read";
  if (subjectType === "booking") return "booking:read";
  if (subjectType === "payment") return "payment:read";
  if (subjectType === "refund") return "refund:read";
  if (subjectType === "allocation") return "allocation:read";
  if (subjectType === "maintenance") return "maintenance:read";
  if (subjectType === "internet") return "internet:read";
  return null;
}

export function dashboardCardVisible(role: AuthUser["role"], category: TaskCategory) {
  return categoryVisible(role, category);
}
