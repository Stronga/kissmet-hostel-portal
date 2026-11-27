import type { AuthUser } from "../auth/context";
import { hasPermission } from "../auth/permissions";
import type { AdminRepository } from "../repositories/admin.repository";
import type { AdminService } from "./admin.service";

/**
 * Refund redesign milestone 2: refund records with partial/full refunds, maker/checker approval,
 * payouts with references, credit notes, and atomic state changes.
 *
 * Lifecycle: requested -> approved | rejected | cancelled; approved -> paid | cancelled.
 * Money only leaves (payments.refunded_amount_minor grows, net verified drops) at `paid`.
 *
 * Atomicity: every state change is ONE D1 batch (a single SQL transaction). The first statement is
 * a conditional claim that stamps a fresh random `op_token` on the refund row only if the expected
 * state still holds; every later statement in the batch is guarded by that token, so a lost race
 * (concurrent approval, double payout) turns the whole batch into a no-op. Migration 0022 triggers
 * and CHECKs repeat the critical rules at the database level (refundable amount, forward-only
 * lifecycle, maker/checker, immutable/undeletable records, unique payout reference).
 *
 * Audit metadata carries ids, numbers, amounts and states only; reasons, notes and payout
 * references are stored on the refund row and never copied into audit_logs.
 */

export const REFUND_PAYOUT_METHODS = ["cash", "bank_transfer", "mobile_money", "card", "other"] as const;
export type RefundPayoutMethod = (typeof REFUND_PAYOUT_METHODS)[number];
export type RefundStatus = "requested" | "approved" | "rejected" | "cancelled" | "paid";

export const REFUND_RECEIPT_VOID_REASON = "Payment refunded";
export const REFUND_SELF_APPROVAL_ERROR = "Refund approval by the requester is forbidden";
export const REFUND_SELF_REJECTION_ERROR = "Refund rejection by the requester is forbidden; cancel it instead";
export const REFUND_EXCEEDS_ERROR = "Refund amount exceeds refundable amount";
export const PAYOUT_REFERENCE_CONFLICT_ERROR = "Payout reference conflict: already used for another refund";
export const REFUND_CANCEL_FORBIDDEN_ERROR = "Refund cancellation is forbidden for this user";

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

type RefundRow = Record<string, unknown> & {
  id: number;
  status: RefundStatus;
  payment_id: number;
  booking_id: number | null;
  requested_by_staff_id: number;
  amount_minor: number;
  op_token: string | null;
};

function requireStaffId(actor: AuthUser): number {
  if (actor.staffId == null) throw new Error("Forbidden");
  return Number(actor.staffId);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new Error("Invalid input: text is too long");
  return trimmed;
}

function auditFromRefund(actor: AuthUser, action: string, token: string, metadataSql: string) {
  return {
    sql: `INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity_type, entity_id, metadata_json)
          SELECT ?, ?, ?, 'refund', r.id, ${metadataSql} FROM refunds r WHERE r.op_token = ?`,
    binds: [actor.id, actor.staffId, action, token]
  };
}

export class RefundService {
  constructor(private readonly repo: AdminRepository, private readonly admin: AdminService) {}

  private token() {
    return crypto.randomUUID();
  }

  private async refundByToken(token: string) {
    return this.repo.first<RefundRow>("SELECT * FROM refunds WHERE op_token = ?", token);
  }

  async refund(id: number) {
    const row = await this.repo.first<RefundRow>(`
      SELECT r.id, r.refund_number, r.payment_id, r.booking_id, r.resident_id, r.amount_minor, r.currency, r.status,
             r.reason, r.decision_note, r.requested_by_staff_id, r.requested_at, r.approved_by_staff_id, r.approved_at,
             r.rejected_by_staff_id, r.rejected_at, r.cancelled_by_staff_id, r.cancelled_at,
             r.paid_by_staff_id, r.paid_at, r.payout_method, r.payout_reference, r.created_at, r.updated_at,
             p.payment_reference, p.amount_minor AS payment_amount_minor, p.refunded_amount_minor AS payment_refunded_amount_minor,
             p.status AS payment_status, p.refund_status AS payment_refund_status,
             b.booking_number, res.resident_code,
             cn.id AS credit_note_id, cn.credit_note_number
      FROM refunds r
      JOIN payments p ON p.id = r.payment_id
      LEFT JOIN bookings b ON b.id = r.booking_id
      JOIN residents res ON res.id = r.resident_id
      LEFT JOIN credit_notes cn ON cn.refund_id = r.id
      WHERE r.id = ?
    `, id);
    if (!row) throw new Error("Refund not found");
    return row;
  }

  async listRefunds(filters: { status?: string | null; paymentId?: number | null; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (filters.status) {
      if (!["requested", "approved", "rejected", "cancelled", "paid"].includes(filters.status)) throw new Error("Invalid refund status");
      where.push("r.status = ?");
      binds.push(filters.status);
    }
    if (filters.paymentId) { where.push("r.payment_id = ?"); binds.push(filters.paymentId); }
    const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
    const offset = Math.max(Number(filters.offset ?? 0), 0);
    const rows = await this.repo.all<Record<string, unknown>>(`
      SELECT r.id, r.refund_number, r.payment_id, r.booking_id, r.amount_minor, r.currency, r.status,
             r.requested_by_staff_id, r.requested_at, r.approved_by_staff_id, r.approved_at, r.paid_at,
             r.payout_method, r.payout_reference, p.payment_reference, b.booking_number, res.resident_code,
             cn.credit_note_number
      FROM refunds r
      JOIN payments p ON p.id = r.payment_id
      LEFT JOIN bookings b ON b.id = r.booking_id
      JOIN residents res ON res.id = r.resident_id
      LEFT JOIN credit_notes cn ON cn.refund_id = r.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY r.id DESC LIMIT ? OFFSET ?
    `, ...binds, limit, offset);
    return rows.results ?? [];
  }

  async countRefunds(filters: { status?: string | null } = {}) {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (filters.status) {
      if (!["requested", "approved", "rejected", "cancelled", "paid"].includes(filters.status)) throw new Error("Invalid refund status");
      where.push("status = ?");
      binds.push(filters.status);
    }
    const row = await this.repo.first<{ total: number }>(`SELECT COUNT(*) AS total FROM refunds ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`, ...binds);
    return Number(row?.total ?? 0);
  }

  /** Refundable remainder = amount - paid refunds - open (requested/approved) refunds. */
  async refundable(paymentId: number) {
    const payment = await this.repo.first<Record<string, unknown>>("SELECT id, status, amount_minor, refunded_amount_minor, currency FROM payments WHERE id = ?", paymentId);
    if (!payment) throw new Error("Payment not found");
    const open = await this.repo.first<{ open_minor: number }>("SELECT COALESCE(SUM(amount_minor), 0) AS open_minor FROM refunds WHERE payment_id = ? AND status IN ('requested', 'approved')", paymentId);
    const amount = Number(payment.amount_minor);
    const refunded = Number(payment.refunded_amount_minor ?? 0);
    const openMinor = Number(open?.open_minor ?? 0);
    return {
      paymentId,
      paymentStatus: String(payment.status),
      currency: String(payment.currency),
      amountMinor: amount,
      refundedMinor: refunded,
      openRefundMinor: openMinor,
      refundableMinor: payment.status === "verified" ? Math.max(amount - refunded - openMinor, 0) : 0
    };
  }

  async requestRefund(actor: AuthUser, paymentId: number, input: { amountMinor?: number | null; reason?: string | null }) {
    const staffId = requireStaffId(actor);
    const reason = cleanText(input.reason, 2000);
    if (!reason) throw new Error("Refund reason required");
    const state = await this.refundable(paymentId);
    if (state.paymentStatus !== "verified") throw new Error("Invalid workflow transition");
    // Nothing left (fully reserved by open requests or already paid out) is a conflict, not bad input.
    if (input.amountMinor == null && state.refundableMinor <= 0) throw new Error(REFUND_EXCEEDS_ERROR);
    const amount = input.amountMinor == null ? state.refundableMinor : Number(input.amountMinor);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid refund amount");
    if (amount > state.refundableMinor) throw new Error(REFUND_EXCEEDS_ERROR);
    const token = this.token();
    try {
      await this.repo.batch([
        {
          sql: `INSERT INTO refunds (refund_number, payment_id, booking_id, resident_id, amount_minor, currency, status, reason, requested_by_staff_id, op_token)
                SELECT seq.prefix || '-' || printf('%0' || seq.padding || 'd', seq.next_value), p.id, p.booking_id, p.resident_id, ?, p.currency, 'requested', ?, ?, ?
                FROM payments p JOIN refund_number_sequence seq ON seq.id = 1
                WHERE p.id = ? AND p.status = 'verified'
                  AND ? + p.refunded_amount_minor + COALESCE((SELECT SUM(r.amount_minor) FROM refunds r WHERE r.payment_id = p.id AND r.status IN ('requested', 'approved')), 0) <= p.amount_minor`,
          binds: [amount, reason, staffId, token, paymentId, amount]
        },
        { sql: `UPDATE refund_number_sequence SET next_value = next_value + 1, updated_at = ${NOW_SQL} WHERE id = 1 AND EXISTS (SELECT 1 FROM refunds WHERE op_token = ?)`, binds: [token] },
        auditFromRefund(actor, "admin.refund.requested", token, "json_object('paymentId', r.payment_id, 'bookingId', r.booking_id, 'refundNumber', r.refund_number, 'amountMinor', r.amount_minor, 'partial', CASE WHEN r.amount_minor < (SELECT amount_minor FROM payments WHERE id = r.payment_id) THEN json('true') ELSE json('false') END)")
      ]);
    } catch (error) {
      if (/refund exceeds/i.test(String((error as Error).message))) throw new Error(REFUND_EXCEEDS_ERROR);
      throw error;
    }
    const created = await this.refundByToken(token);
    if (!created) throw new Error(REFUND_EXCEEDS_ERROR);
    return this.refund(Number(created.id));
  }

  private async loadForDecision(id: number) {
    const refund = await this.repo.first<RefundRow>("SELECT * FROM refunds WHERE id = ?", id);
    if (!refund) throw new Error("Refund not found");
    return refund;
  }

  async approveRefund(actor: AuthUser, id: number, note?: string | null) {
    const staffId = requireStaffId(actor);
    const refund = await this.loadForDecision(id);
    if (refund.status !== "requested") throw new Error("Invalid workflow transition");
    if (Number(refund.requested_by_staff_id) === staffId) {
      await this.repo.audit(actor.id, actor.staffId, "admin.refund.self_approval_blocked", "refund", id, { paymentId: Number(refund.payment_id) });
      throw new Error(REFUND_SELF_APPROVAL_ERROR);
    }
    const token = this.token();
    await this.repo.batch([
      {
        sql: `UPDATE refunds SET status = 'approved', approved_by_staff_id = ?, approved_at = ${NOW_SQL}, decision_note = COALESCE(?, decision_note), op_token = ?, updated_at = ${NOW_SQL}
              WHERE id = ? AND status = 'requested' AND requested_by_staff_id <> ?
                AND EXISTS (SELECT 1 FROM payments p WHERE p.id = refunds.payment_id AND p.status = 'verified')`,
        binds: [staffId, cleanText(note, 2000), token, id, staffId]
      },
      auditFromRefund(actor, "admin.refund.approved", token, "json_object('paymentId', r.payment_id, 'refundNumber', r.refund_number, 'amountMinor', r.amount_minor)")
    ]);
    if (!(await this.refundByToken(token))) throw new Error("Invalid workflow transition");
    return this.refund(id);
  }

  async rejectRefund(actor: AuthUser, id: number, note?: string | null) {
    const staffId = requireStaffId(actor);
    const refund = await this.loadForDecision(id);
    if (refund.status !== "requested") throw new Error("Invalid workflow transition");
    if (Number(refund.requested_by_staff_id) === staffId) throw new Error(REFUND_SELF_REJECTION_ERROR);
    const token = this.token();
    await this.repo.batch([
      {
        sql: `UPDATE refunds SET status = 'rejected', rejected_by_staff_id = ?, rejected_at = ${NOW_SQL}, decision_note = COALESCE(?, decision_note), op_token = ?, updated_at = ${NOW_SQL}
              WHERE id = ? AND status = 'requested' AND requested_by_staff_id <> ?`,
        binds: [staffId, cleanText(note, 2000), token, id, staffId]
      },
      auditFromRefund(actor, "admin.refund.rejected", token, "json_object('paymentId', r.payment_id, 'refundNumber', r.refund_number, 'amountMinor', r.amount_minor)")
    ]);
    if (!(await this.refundByToken(token))) throw new Error("Invalid workflow transition");
    return this.refund(id);
  }

  /** The requester, or any user who may approve refunds, can cancel a requested/approved refund. */
  async cancelRefund(actor: AuthUser, id: number, note?: string | null) {
    const staffId = requireStaffId(actor);
    const refund = await this.loadForDecision(id);
    if (refund.status !== "requested" && refund.status !== "approved") throw new Error("Invalid workflow transition");
    if (Number(refund.requested_by_staff_id) !== staffId && !hasPermission(actor.role, "refund:approve")) throw new Error(REFUND_CANCEL_FORBIDDEN_ERROR);
    const token = this.token();
    await this.repo.batch([
      {
        sql: `UPDATE refunds SET status = 'cancelled', cancelled_by_staff_id = ?, cancelled_at = ${NOW_SQL}, decision_note = COALESCE(?, decision_note), op_token = ?, updated_at = ${NOW_SQL}
              WHERE id = ? AND status IN ('requested', 'approved')`,
        binds: [staffId, cleanText(note, 2000), token, id]
      },
      {
        sql: `INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity_type, entity_id, metadata_json)
              SELECT ?, ?, 'admin.refund.cancelled', 'refund', r.id, json_object('paymentId', r.payment_id, 'refundNumber', r.refund_number, 'amountMinor', r.amount_minor, 'from', ?)
              FROM refunds r WHERE r.op_token = ?`,
        binds: [actor.id, actor.staffId, refund.status, token]
      }
    ]);
    if (!(await this.refundByToken(token))) throw new Error("Invalid workflow transition");
    return this.refund(id);
  }

  /**
   * Records the payout of an approved refund and, in the same transaction: adds the amount to
   * payments.refunded_amount_minor (full refund -> payment status 'refunded'), voids the issued
   * receipt on a full refund (milestone-1 rule), issues a numbered credit note linked to the
   * refund/payment/booking/receipt, and writes the audit trail. The booking's payment-attention
   * flag is then recalculated from NET verified payments.
   */
  async payoutRefund(actor: AuthUser, id: number, input: { method?: string | null; reference?: string | null }) {
    const staffId = requireStaffId(actor);
    const method = String(input.method ?? "").trim();
    if (!(REFUND_PAYOUT_METHODS as readonly string[]).includes(method)) throw new Error("Invalid payout method");
    const reference = cleanText(input.reference, 120);
    if (!reference) throw new Error("Payout reference required");
    const refund = await this.loadForDecision(id);
    if (refund.status !== "approved") throw new Error("Invalid workflow transition");
    const token = this.token();
    const now = new Date().toISOString();
    const refundAmount = "(SELECT amount_minor FROM refunds WHERE op_token = ?)";
    const refundPayment = "(SELECT payment_id FROM refunds WHERE op_token = ?)";
    try {
      await this.repo.batch([
        {
          sql: `UPDATE refunds SET status = 'paid', paid_by_staff_id = ?, paid_at = ?, payout_method = ?, payout_reference = ?, op_token = ?, updated_at = ?
                WHERE id = ? AND status = 'approved'
                  AND EXISTS (SELECT 1 FROM payments p WHERE p.id = refunds.payment_id AND p.status = 'verified' AND p.refunded_amount_minor + refunds.amount_minor <= p.amount_minor)`,
          binds: [staffId, now, method, reference, token, now, id]
        },
        {
          sql: `UPDATE payments
                SET refunded_amount_minor = refunded_amount_minor + ${refundAmount},
                    refund_status = CASE WHEN refunded_amount_minor + ${refundAmount} >= amount_minor THEN 'fully_refunded' ELSE 'partially_refunded' END,
                    status = CASE WHEN refunded_amount_minor + ${refundAmount} >= amount_minor THEN 'refunded' ELSE status END,
                    updated_at = ?
                WHERE id = ${refundPayment} AND status = 'verified'`,
          binds: [token, token, token, now, token]
        },
        {
          sql: `UPDATE receipts SET status = 'voided', voided_at = ?, void_reason = ?, updated_at = ?
                WHERE payment_id = ${refundPayment} AND status = 'issued'
                  AND (SELECT p.status FROM payments p WHERE p.id = receipts.payment_id) = 'refunded'`,
          binds: [now, REFUND_RECEIPT_VOID_REASON, now, token]
        },
        {
          sql: `INSERT INTO credit_notes (credit_note_number, refund_id, payment_id, booking_id, resident_id, receipt_id, amount_minor, currency, status, issued_at, issued_by_staff_id)
                SELECT seq.prefix || '-' || printf('%0' || seq.padding || 'd', seq.next_value), r.id, r.payment_id, r.booking_id, r.resident_id,
                       (SELECT rec.id FROM receipts rec WHERE rec.payment_id = r.payment_id), r.amount_minor, r.currency, 'issued', ?, ?
                FROM refunds r JOIN credit_note_number_sequence seq ON seq.id = 1
                WHERE r.op_token = ?`,
          binds: [now, staffId, token]
        },
        { sql: `UPDATE credit_note_number_sequence SET next_value = next_value + 1, updated_at = ? WHERE id = 1 AND EXISTS (SELECT 1 FROM refunds WHERE op_token = ?)`, binds: [now, token] },
        auditFromRefund(actor, "admin.refund.paid", token, "json_object('paymentId', r.payment_id, 'bookingId', r.booking_id, 'refundNumber', r.refund_number, 'amountMinor', r.amount_minor, 'payoutMethod', r.payout_method)"),
        {
          sql: `INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity_type, entity_id, metadata_json)
                SELECT ?, ?, 'admin.payment.refunded', 'payment', p.id,
                       json_object('refundId', r.id, 'bookingId', r.booking_id, 'amountMinor', r.amount_minor, 'refundedTotalMinor', p.refunded_amount_minor, 'refundStatus', p.refund_status)
                FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.op_token = ?`,
          binds: [actor.id, actor.staffId, token]
        },
        {
          sql: `INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity_type, entity_id, metadata_json)
                SELECT ?, ?, 'admin.credit_note.issued', 'credit_note', cn.id, json_object('refundId', r.id, 'paymentId', r.payment_id, 'creditNoteNumber', cn.credit_note_number, 'amountMinor', cn.amount_minor)
                FROM refunds r JOIN credit_notes cn ON cn.refund_id = r.id WHERE r.op_token = ?`,
          binds: [actor.id, actor.staffId, token]
        },
        {
          sql: `INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity_type, entity_id, metadata_json)
                SELECT ?, ?, 'admin.receipt.voided', 'receipt', rec.id, json_object('paymentId', rec.payment_id, 'refundId', r.id, 'cause', 'payment_refunded')
                FROM refunds r JOIN receipts rec ON rec.payment_id = r.payment_id
                WHERE r.op_token = ? AND rec.status = 'voided' AND rec.voided_at = ? AND rec.void_reason = ?`,
          binds: [actor.id, actor.staffId, token, now, REFUND_RECEIPT_VOID_REASON]
        }
      ]);
    } catch (error) {
      const message = String((error as Error).message);
      if (/UNIQUE/i.test(message)) throw new Error(PAYOUT_REFERENCE_CONFLICT_ERROR);
      throw error;
    }
    const paid = await this.refundByToken(token);
    if (!paid) throw new Error("Invalid workflow transition");
    let summary = null;
    if (paid.booking_id != null) {
      summary = await this.admin.recalculatePaymentAttention(actor, Number(paid.booking_id), "refund", Number(paid.payment_id));
    }
    return { refund: await this.refund(id), summary };
  }

  async creditNote(id: number) {
    const row = await this.repo.first(`
      SELECT cn.*, r.refund_number, r.payout_method, r.paid_at, p.payment_reference, p.amount_minor AS payment_amount_minor,
             b.booking_number, res.resident_code, rec.receipt_number
      FROM credit_notes cn
      JOIN refunds r ON r.id = cn.refund_id
      JOIN payments p ON p.id = cn.payment_id
      LEFT JOIN bookings b ON b.id = cn.booking_id
      JOIN residents res ON res.id = cn.resident_id
      LEFT JOIN receipts rec ON rec.id = cn.receipt_id
      WHERE cn.id = ?
    `, id);
    if (!row) throw new Error("Credit note not found");
    return row;
  }

  async listCreditNotes(filters: { limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
    const offset = Math.max(Number(filters.offset ?? 0), 0);
    const rows = await this.repo.all(`
      SELECT cn.id, cn.credit_note_number, cn.refund_id, cn.payment_id, cn.booking_id, cn.amount_minor, cn.currency, cn.status, cn.issued_at,
             r.refund_number, p.payment_reference, b.booking_number, res.resident_code, rec.receipt_number
      FROM credit_notes cn
      JOIN refunds r ON r.id = cn.refund_id
      JOIN payments p ON p.id = cn.payment_id
      LEFT JOIN bookings b ON b.id = cn.booking_id
      JOIN residents res ON res.id = cn.resident_id
      LEFT JOIN receipts rec ON rec.id = cn.receipt_id
      ORDER BY cn.id DESC LIMIT ? OFFSET ?
    `, limit, offset);
    return rows.results ?? [];
  }

  /**
   * Refund report: counts/amounts by status for refunds requested in the period, refunds actually
   * paid out in the period (by paid_at), and gross/net verified payments for payments created in
   * the period. Resident identity is limited to resident_code.
   */
  async reportRefunds(filters: { dateFrom?: string | null; dateTo?: string | null; status?: string | null } = {}) {
    const requestedWhere: string[] = [];
    const requestedBinds: unknown[] = [];
    if (filters.dateFrom) { requestedWhere.push("r.requested_at >= ?"); requestedBinds.push(filters.dateFrom); }
    if (filters.dateTo) { requestedWhere.push("r.requested_at <= ?"); requestedBinds.push(filters.dateTo); }
    const listWhere = [...requestedWhere];
    const listBinds = [...requestedBinds];
    if (filters.status) {
      if (!["requested", "approved", "rejected", "cancelled", "paid"].includes(filters.status)) throw new Error("Invalid refund status");
      listWhere.push("r.status = ?");
      listBinds.push(filters.status);
    }
    const paidWhere = ["r.status = 'paid'"];
    const paidBinds: unknown[] = [];
    if (filters.dateFrom) { paidWhere.push("r.paid_at >= ?"); paidBinds.push(filters.dateFrom); }
    if (filters.dateTo) { paidWhere.push("r.paid_at <= ?"); paidBinds.push(filters.dateTo); }
    const paymentWhere: string[] = [];
    const paymentBinds: unknown[] = [];
    if (filters.dateFrom) { paymentWhere.push("p.created_at >= ?"); paymentBinds.push(filters.dateFrom); }
    if (filters.dateTo) { paymentWhere.push("p.created_at <= ?"); paymentBinds.push(filters.dateTo); }
    const paymentScope = paymentWhere.length ? `AND ${paymentWhere.join(" AND ")}` : "";

    const byStatus = await this.repo.all<Record<string, unknown>>(
      `SELECT r.status, COUNT(*) AS count, COALESCE(SUM(r.amount_minor), 0) AS amount_minor
       FROM refunds r ${requestedWhere.length ? `WHERE ${requestedWhere.join(" AND ")}` : ""}
       GROUP BY r.status ORDER BY r.status`,
      ...requestedBinds
    );
    const paid = await this.repo.first<Record<string, unknown>>(
      `SELECT COUNT(*) AS paid_count, COALESCE(SUM(r.amount_minor), 0) AS paid_amount_minor,
              COALESCE(SUM(CASE WHEN r.amount_minor < p.amount_minor THEN r.amount_minor ELSE 0 END), 0) AS partial_paid_amount_minor
       FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE ${paidWhere.join(" AND ")}`,
      ...paidBinds
    );
    const byPayoutMethod = await this.repo.all<Record<string, unknown>>(
      `SELECT r.payout_method, COUNT(*) AS count, COALESCE(SUM(r.amount_minor), 0) AS amount_minor
       FROM refunds r WHERE ${paidWhere.join(" AND ")} GROUP BY r.payout_method ORDER BY r.payout_method`,
      ...paidBinds
    );
    const net = await this.repo.first<Record<string, unknown>>(
      `SELECT
         (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p WHERE p.status IN ('verified', 'refunded') ${paymentScope}) AS gross_verified_minor,
         (SELECT COALESCE(SUM(p.refunded_amount_minor), 0) FROM payments p WHERE p.status IN ('verified', 'refunded') ${paymentScope}) AS refunded_minor,
         (SELECT COALESCE(SUM(p.amount_minor - p.refunded_amount_minor), 0) FROM payments p WHERE p.status = 'verified' ${paymentScope}) AS net_verified_minor,
         (SELECT COUNT(*) FROM credit_notes cn WHERE cn.status = 'issued') AS credit_notes_issued`,
      ...paymentBinds,
      ...paymentBinds,
      ...paymentBinds
    );
    const refunds = await this.repo.all<Record<string, unknown>>(
      `SELECT r.id, r.refund_number, r.status, r.amount_minor, r.currency, r.requested_at, r.approved_at, r.paid_at, r.payout_method,
              p.payment_reference, b.booking_number, res.resident_code, cn.credit_note_number
       FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       LEFT JOIN bookings b ON b.id = r.booking_id
       JOIN residents res ON res.id = r.resident_id
       LEFT JOIN credit_notes cn ON cn.refund_id = r.id
       ${listWhere.length ? `WHERE ${listWhere.join(" AND ")}` : ""}
       ORDER BY r.id DESC LIMIT 500`,
      ...listBinds
    );
    return {
      byStatus: byStatus.results ?? [],
      paid: paid ?? { paid_count: 0, paid_amount_minor: 0, partial_paid_amount_minor: 0 },
      byPayoutMethod: byPayoutMethod.results ?? [],
      net: net ?? {},
      refunds: refunds.results ?? []
    };
  }
}
