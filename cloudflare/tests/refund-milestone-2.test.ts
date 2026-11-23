import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import { all, get, openMigratedDatabase, run } from "./apply-migrations";
import app from "../src/index";
import { AdminRepository } from "../src/repositories/admin.repository";
import { AdminService, ARCHIVE_OPEN_REFUND_ERROR, REFUND_ATTENTION_REASON } from "../src/services/admin.service";
import {
  PAYOUT_REFERENCE_CONFLICT_ERROR,
  REFUND_EXCEEDS_ERROR,
  REFUND_SELF_APPROVAL_ERROR,
  REFUND_SELF_REJECTION_ERROR,
  RefundService,
} from "../src/services/refund.service";
import { sha256Hex } from "../src/auth/crypto";
import type { AuthUser } from "../src/auth/context";
import type { Env } from "../src/types/bindings";

/**
 * Refund redesign milestone 2 against the real migrated schema (0001–0022) in sql.js, with a D1
 * fake whose batch() is a real SQL transaction (as on D1).
 */

function createSqlJsD1(db: Database): D1Database {
  let queue: Promise<unknown> = Promise.resolve();
  const wrap = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      async first<T>() {
        return (get<Record<string, unknown>>(db, sql, binds as Array<string | number | null>) as T) ?? null;
      },
      async all<T>() {
        return { results: all<Record<string, unknown>>(db, sql, binds as Array<string | number | null>) as T[], success: true };
      },
      async run() {
        run(db, sql, binds as Array<string | number | null>);
        const changes = Number(db.getRowsModified());
        let lastRowId: number | null = null;
        if (/^\s*INSERT\b/i.test(sql)) lastRowId = Number(get<{ id: number }>(db, "SELECT last_insert_rowid() AS id")!.id);
        return { success: true, meta: { changes, last_row_id: lastRowId, duration: 0, size_after: 0, rows_read: 0, rows_written: changes } };
      },
    };
    return stmt;
  };
  return {
    prepare: (sql: string) => wrap(sql) as unknown as D1PreparedStatement,
    // D1 serialises writes and runs each batch as one transaction; mirror both.
    batch: (statements: Array<{ run: () => Promise<unknown> }>) => {
      const next = queue.then(async () => {
        db.run("BEGIN");
        try {
          const results = [];
          for (const s of statements) results.push(await s.run());
          db.run("COMMIT");
          return results;
        } catch (error) {
          db.run("ROLLBACK");
          throw error;
        }
      });
      queue = next.catch(() => undefined);
      return next;
    },
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

const STAFF = ["manager", "accounts", "accounts2", "reception"] as const;
type StaffKey = (typeof STAFF)[number];
const ROLE_OF: Record<StaffKey, string> = { manager: "manager", accounts: "accounts", accounts2: "accounts", reception: "reception" };
const token = (k: string) => `test-session-${k}-0123456789abcdef`;
const REASON = "Resident moved out early (private note)";
const RESIDENT_PHONE = "+233200000777";

type Fx = {
  db: Database;
  svc: AdminService;
  refunds: RefundService;
  users: Record<StaffKey, AuthUser>;
  residentId: number;
  otherResidentId: number;
  sessionId: number;
};

async function seed(): Promise<Fx> {
  const db = await openMigratedDatabase();
  const users = {} as Record<StaffKey, AuthUser>;
  for (const code of ["manager", "accounts", "reception"]) run(db, "INSERT INTO roles (code, name, is_system) VALUES (?, ?, 1)", [code, code]);
  let n = 0;
  for (const key of STAFF) {
    n += 1;
    run(db, "INSERT INTO users (email, phone, display_name, user_type, status) VALUES (?, ?, ?, 'staff', 'active')", [`${key}@example.com`, `+23320000080${n}`, key]);
    const userId = Number(get<{ id: number }>(db, "SELECT id FROM users WHERE email = ?", [`${key}@example.com`])!.id);
    run(db, "INSERT INTO staff (user_id, role_id, staff_code, status) SELECT ?, id, ?, 'active' FROM roles WHERE code = ?", [userId, `KSM-STF-00${n}0`, ROLE_OF[key]]);
    const staffId = Number(get<{ id: number }>(db, "SELECT id FROM staff WHERE user_id = ?", [userId])!.id);
    run(db, "INSERT INTO sessions (user_id, session_token_hash, status, expires_at) VALUES (?, ?, 'active', '2099-01-01T00:00:00.000Z')", [userId, await sha256Hex(token(key))]);
    users[key] = { id: userId, userType: "staff", displayName: key, email: `${key}@example.com`, role: ROLE_OF[key] as AuthUser["role"], staffId, residentId: null, sessionId: n };
  }
  run(db, "INSERT INTO academic_sessions (code, name, starts_on, ends_on, status) VALUES ('2026-2027', '2026/2027', '2026-09-01', '2027-06-30', 'active')");
  for (const [email, phone, first] of [["res1@example.com", RESIDENT_PHONE, "Akua"], ["res2@example.com", "+233200000778", "Yaw"]]) {
    run(db, "INSERT INTO users (email, phone, display_name, user_type, status) VALUES (?, ?, ?, 'resident', 'active')", [email, phone, first]);
    run(db, "INSERT INTO residents (user_id, first_name, last_name, gender, status, resident_kind) SELECT id, ?, 'Synthetic', 'female', 'resident', 'non_student' FROM users WHERE email = ?", [first, email]);
  }
  const residentId = Number(get<{ id: number }>(db, "SELECT id FROM residents WHERE first_name = 'Akua'")!.id);
  const otherResidentId = Number(get<{ id: number }>(db, "SELECT id FROM residents WHERE first_name = 'Yaw'")!.id);
  const resUser = Number(get<{ id: number }>(db, "SELECT id FROM users WHERE email = 'res1@example.com'")!.id);
  run(db, "INSERT INTO sessions (user_id, session_token_hash, status, expires_at) VALUES (?, ?, 'active', '2099-01-01T00:00:00.000Z')", [resUser, await sha256Hex(token("resident"))]);
  const sessionId = Number(get<{ id: number }>(db, "SELECT id FROM academic_sessions")!.id);
  const repo = new AdminRepository(createSqlJsD1(db));
  const svc = new AdminService(repo);
  return { db, svc, refunds: new RefundService(repo, svc), users, residentId, otherResidentId, sessionId };
}

function booking(f: Fx, number: string, status = "confirmed", total = 250000, residentId = f.residentId) {
  run(f.db, "INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency) VALUES (?, ?, ?, ?, ?, 'GHS')", [residentId, f.sessionId, number, status, total]);
  return Number(get<{ id: number }>(f.db, "SELECT id FROM bookings WHERE booking_number = ?", [number])!.id);
}
function verifiedPayment(f: Fx, ref: string, bookingId: number | null, amount = 250000, residentId = f.residentId) {
  run(f.db, "INSERT INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method, verified_at) VALUES (?, ?, ?, 'verified', ?, 'GHS', 'mobile_money', 'x')", [bookingId, residentId, ref, amount]);
  return Number(get<{ id: number }>(f.db, "SELECT id FROM payments WHERE payment_reference = ?", [ref])!.id);
}
const one = (f: Fx, sql: string, params: Array<string | number | null> = []) => get<Record<string, unknown>>(f.db, sql, params)!;
const audits = (f: Fx) => all<{ action: string; entity_type: string; entity_id: number; metadata_json: string | null }>(f.db, "SELECT action, entity_type, entity_id, metadata_json FROM audit_logs ORDER BY id");
const count = (f: Fx, action: string) => audits(f).filter((a) => a.action === action).length;

async function approvedRefund(f: Fx, paymentId: number, amountMinor?: number) {
  const r = await f.refunds.requestRefund(f.users.accounts, paymentId, { amountMinor, reason: REASON });
  await f.refunds.approveRefund(f.users.manager, Number(r.id));
  return Number(r.id);
}
async function paidRefund(f: Fx, paymentId: number, amountMinor: number | undefined, reference: string) {
  const id = await approvedRefund(f, paymentId, amountMinor);
  return f.refunds.payoutRefund(f.users.accounts, id, { method: "mobile_money", reference });
}

function testEnv(db: Database): Env {
  return {
    APP_NAME: "kissmet-test",
    APP_ENV: "local",
    DB: createSqlJsD1(db),
    DOCUMENTS: {} as never,
    CONNECTOR_HEARTBEAT_SECRET: "heartbeat-test-secret-0123456789abcdef",
    CONNECTOR_HEARTBEAT_ALLOWED_IDS: "0b7e1c52-5f0e-4f9a-9d3b-2a6f1c0e8d41",
  } as unknown as Env;
}
async function api(db: Database, who: string, method: string, path: string, body?: unknown) {
  const res = await app.request(`http://worker.test${path}`, { method, headers: { Authorization: `Bearer ${token(who)}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, testEnv(db));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

describe("refund milestone 2 (real schema 0001–0022)", () => {
  let f: Fx;
  beforeEach(async () => {
    f = await seed();
  });

  describe("partial and full refunds", () => {
    it("partial payout keeps the payment verified, keeps the receipt, issues a credit note and lowers net paid", async () => {
      const b = booking(f, "B-P1");
      const p = verifiedPayment(f, "P-P1", b);
      const receipt = (await f.svc.issueReceipt(f.users.accounts, p)) as Record<string, unknown>;
      const result = await paidRefund(f, p, 100000, "MM-P1-A");
      expect(result.refund).toMatchObject({ status: "paid", amount_minor: 100000, payment_status: "verified", payment_refund_status: "partially_refunded", payment_refunded_amount_minor: 100000 });
      expect(one(f, "SELECT status FROM receipts WHERE id = ?", [Number(receipt.id)]).status).toBe("issued");
      const cn = one(f, "SELECT * FROM credit_notes WHERE refund_id = ?", [Number(result.refund.id)]);
      expect(cn).toMatchObject({ credit_note_number: "KSM-CRN-0001", payment_id: p, booking_id: b, resident_id: f.residentId, receipt_id: Number(receipt.id), amount_minor: 100000, status: "issued" });
      expect(result.summary).toMatchObject({ verifiedPaidMinor: 150000, confirmationRequirementMet: false, paymentAttentionRequired: true });
      expect(one(f, "SELECT payment_attention_reason AS r FROM bookings WHERE id = ?", [b]).r).toBe(REFUND_ATTENTION_REASON);
    });

    it("a second partial refund that reaches the full amount moves the payment to refunded and voids the receipt", async () => {
      const b = booking(f, "B-P2");
      const p = verifiedPayment(f, "P-P2", b);
      const receipt = (await f.svc.issueReceipt(f.users.accounts, p)) as Record<string, unknown>;
      await paidRefund(f, p, 100000, "MM-P2-A");
      const second = await paidRefund(f, p, undefined, "MM-P2-B"); // defaults to the refundable remainder
      expect(second.refund).toMatchObject({ amount_minor: 150000, payment_status: "refunded", payment_refund_status: "fully_refunded", payment_refunded_amount_minor: 250000 });
      expect(one(f, "SELECT status, void_reason FROM receipts WHERE id = ?", [Number(receipt.id)])).toMatchObject({ status: "voided", void_reason: "Payment refunded" });
      expect(all(f.db, "SELECT credit_note_number FROM credit_notes ORDER BY id").map((r) => r.credit_note_number)).toEqual(["KSM-CRN-0001", "KSM-CRN-0002"]);
      expect(count(f, "admin.receipt.voided")).toBe(1);
      await expect(f.refunds.requestRefund(f.users.accounts, p, { reason: REASON })).rejects.toThrow("Invalid workflow transition");
    });

    it("refunds can never exceed the verified amount minus prior and open refunds", async () => {
      const p = verifiedPayment(f, "P-X1", booking(f, "B-X1"));
      await expect(f.refunds.requestRefund(f.users.accounts, p, { amountMinor: 250001, reason: REASON })).rejects.toThrow(REFUND_EXCEEDS_ERROR);
      await f.refunds.requestRefund(f.users.accounts, p, { amountMinor: 200000, reason: REASON });
      await expect(f.refunds.requestRefund(f.users.accounts, p, { amountMinor: 50001, reason: REASON })).rejects.toThrow(REFUND_EXCEEDS_ERROR);
      expect((await f.refunds.refundable(p)).refundableMinor).toBe(50000);
      for (const bad of [0, -5, 1.5]) await expect(f.refunds.requestRefund(f.users.accounts, p, { amountMinor: bad, reason: REASON })).rejects.toThrow("Invalid refund amount");
    });

    it("only verified payments can be refunded and a reason is required", async () => {
      run(f.db, "INSERT INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method) VALUES (NULL, ?, 'P-S1', 'submitted', 1000, 'GHS', 'cash')", [f.residentId]);
      const submitted = Number(one(f, "SELECT id FROM payments WHERE payment_reference = 'P-S1'").id);
      await expect(f.refunds.requestRefund(f.users.accounts, submitted, { reason: REASON })).rejects.toThrow("Invalid workflow transition");
      const p = verifiedPayment(f, "P-S2", null, 1000);
      await expect(f.refunds.requestRefund(f.users.accounts, p, { reason: "  " })).rejects.toThrow("Refund reason required");
    });

    it("rejected and cancelled refunds release their reserved amount", async () => {
      const p = verifiedPayment(f, "P-R1", booking(f, "B-R1"));
      const a = await f.refunds.requestRefund(f.users.accounts, p, { amountMinor: 250000, reason: REASON });
      await f.refunds.rejectRefund(f.users.manager, Number(a.id), "not eligible");
      const b2 = await f.refunds.requestRefund(f.users.accounts, p, { amountMinor: 250000, reason: REASON });
      await f.refunds.cancelRefund(f.users.accounts, Number(b2.id));
      expect((await f.refunds.refundable(p)).refundableMinor).toBe(250000);
      expect(one(f, "SELECT status, refunded_amount_minor FROM payments WHERE id = ?", [p])).toMatchObject({ status: "verified", refunded_amount_minor: 0 });
      await expect(f.refunds.approveRefund(f.users.manager, Number(a.id))).rejects.toThrow("Invalid workflow transition");
    });
  });

  describe("maker/checker", () => {
    it("refuses self-approval and self-rejection, and audits the blocked approval", async () => {
      const p = verifiedPayment(f, "P-M1", booking(f, "B-M1"));
      const r = await f.refunds.requestRefund(f.users.accounts, p, { reason: REASON });
      await expect(f.refunds.approveRefund(f.users.accounts, Number(r.id))).rejects.toThrow(REFUND_SELF_APPROVAL_ERROR);
      await expect(f.refunds.rejectRefund(f.users.accounts, Number(r.id))).rejects.toThrow(REFUND_SELF_REJECTION_ERROR);
      expect(count(f, "admin.refund.self_approval_blocked")).toBe(1);
      expect(one(f, "SELECT status FROM refunds WHERE id = ?", [Number(r.id)]).status).toBe("requested");
      // A different user holding the same role may approve.
      await f.refunds.approveRefund(f.users.accounts2, Number(r.id));
      expect(one(f, "SELECT status, approved_by_staff_id FROM refunds WHERE id = ?", [Number(r.id)])).toMatchObject({ status: "approved", approved_by_staff_id: f.users.accounts2.staffId });
    });

    it("payout requires an approved refund, a valid method and a reference", async () => {
      const p = verifiedPayment(f, "P-M2", booking(f, "B-M2"));
      const r = await f.refunds.requestRefund(f.users.accounts, p, { reason: REASON });
      await expect(f.refunds.payoutRefund(f.users.accounts, Number(r.id), { method: "mobile_money", reference: "X" })).rejects.toThrow("Invalid workflow transition");
      await f.refunds.approveRefund(f.users.manager, Number(r.id));
      await expect(f.refunds.payoutRefund(f.users.accounts, Number(r.id), { method: "crypto", reference: "X" })).rejects.toThrow("Invalid payout method");
      await expect(f.refunds.payoutRefund(f.users.accounts, Number(r.id), { method: "cash", reference: " " })).rejects.toThrow("Payout reference required");
    });
  });

  describe("atomicity", () => {
    // Races are made deterministic by handing the second caller the STALE row the first caller also
    // read, so the JS pre-checks pass and only the conditional SQL claim can stop it.
    function withStaleRead(svc: RefundService, stale: Record<string, unknown>) {
      (svc as unknown as { loadForDecision: () => Promise<unknown> }).loadForDecision = async () => stale;
      return svc;
    }

    it("concurrent approvals by two approvers: exactly one wins", async () => {
      const p = verifiedPayment(f, "P-C1", booking(f, "B-C1"));
      const r = await f.refunds.requestRefund(f.users.accounts, p, { reason: REASON });
      const stale = one(f, "SELECT * FROM refunds WHERE id = ?", [Number(r.id)]);
      await f.refunds.approveRefund(f.users.manager, Number(r.id));
      const racer = withStaleRead(new RefundService(new AdminRepository(createSqlJsD1(f.db)), f.svc), stale);
      await expect(racer.approveRefund(f.users.accounts2, Number(r.id))).rejects.toThrow("Invalid workflow transition");
      expect(one(f, "SELECT approved_by_staff_id AS a FROM refunds WHERE id = ?", [Number(r.id)]).a).toBe(f.users.manager.staffId);
      expect(count(f, "admin.refund.approved")).toBe(1);
      // Same race, but against a reject after approval.
      await expect(racer.rejectRefund(f.users.accounts2, Number(r.id))).rejects.toThrow("Invalid workflow transition");
    });

    it("concurrent payouts of the same refund: money moves once, one credit note", async () => {
      const p = verifiedPayment(f, "P-C2", booking(f, "B-C2"));
      const id = await approvedRefund(f, p, 100000);
      const stale = one(f, "SELECT * FROM refunds WHERE id = ?", [id]);
      await f.refunds.payoutRefund(f.users.accounts, id, { method: "mobile_money", reference: "MM-C2-A" });
      const racer = withStaleRead(new RefundService(new AdminRepository(createSqlJsD1(f.db)), f.svc), stale);
      await expect(racer.payoutRefund(f.users.manager, id, { method: "bank_transfer", reference: "BT-C2-B" })).rejects.toThrow("Invalid workflow transition");
      expect(one(f, "SELECT refunded_amount_minor AS r FROM payments WHERE id = ?", [p]).r).toBe(100000);
      expect(one(f, "SELECT COUNT(*) AS n FROM credit_notes").n).toBe(1);
      expect(count(f, "admin.refund.paid")).toBe(1);
      expect(count(f, "admin.payment.refunded")).toBe(1);
      expect(one(f, "SELECT payout_reference AS r FROM refunds WHERE id = ?", [id]).r).toBe("MM-C2-A");
    });

    it("truly simultaneous payout calls are serialised: exactly one succeeds", async () => {
      const p = verifiedPayment(f, "P-C5", booking(f, "B-C5"));
      const id = await approvedRefund(f, p, 100000);
      const results = await Promise.allSettled([
        f.refunds.payoutRefund(f.users.accounts, id, { method: "mobile_money", reference: "MM-C5-A" }),
        f.refunds.payoutRefund(f.users.manager, id, { method: "bank_transfer", reference: "BT-C5-B" }),
      ]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(one(f, "SELECT refunded_amount_minor AS r FROM payments WHERE id = ?", [p]).r).toBe(100000);
      expect(one(f, "SELECT COUNT(*) AS n FROM credit_notes").n).toBe(1);
    });

    it("an approval racing a cancellation cannot resurrect the refund", async () => {
      const p = verifiedPayment(f, "P-C6", booking(f, "B-C6"));
      const r = await f.refunds.requestRefund(f.users.accounts, p, { reason: REASON });
      const stale = one(f, "SELECT * FROM refunds WHERE id = ?", [Number(r.id)]);
      await f.refunds.cancelRefund(f.users.accounts, Number(r.id));
      const racer = withStaleRead(new RefundService(new AdminRepository(createSqlJsD1(f.db)), f.svc), stale);
      await expect(racer.approveRefund(f.users.manager, Number(r.id))).rejects.toThrow();
      expect(one(f, "SELECT status FROM refunds WHERE id = ?", [Number(r.id)]).status).toBe("cancelled");
    });

    it("a reused payout reference rolls back the whole payout (no partial state, no number gap)", async () => {
      const p1 = verifiedPayment(f, "P-C3", booking(f, "B-C3"));
      const p2 = verifiedPayment(f, "P-C4", booking(f, "B-C4", "confirmed", 250000, f.otherResidentId), 250000, f.otherResidentId);
      await paidRefund(f, p1, 1000, "MM-SAME");
      const id2 = await approvedRefund(f, p2, 2000);
      await expect(f.refunds.payoutRefund(f.users.accounts, id2, { method: "mobile_money", reference: "MM-SAME" })).rejects.toThrow(PAYOUT_REFERENCE_CONFLICT_ERROR);
      expect(one(f, "SELECT status, op_token FROM refunds WHERE id = ?", [id2]).status).toBe("approved");
      expect(one(f, "SELECT refunded_amount_minor AS r FROM payments WHERE id = ?", [p2]).r).toBe(0);
      expect(one(f, "SELECT COUNT(*) AS n FROM credit_notes").n).toBe(1);
      expect(one(f, "SELECT next_value FROM credit_note_number_sequence WHERE id = 1").next_value).toBe(2);
      const ok = await f.refunds.payoutRefund(f.users.accounts, id2, { method: "mobile_money", reference: "MM-OTHER" });
      expect(ok.refund.credit_note_number).toBe("KSM-CRN-0002");
    });
  });

  describe("payment-attention recalculation on net verified payments", () => {
    it("clears only when net verified payments genuinely meet the requirement again", async () => {
      const b = booking(f, "B-A1");
      const p = verifiedPayment(f, "P-A1", b);
      await paidRefund(f, p, 100000, "MM-A1");
      expect(one(f, "SELECT payment_attention_required AS a FROM bookings WHERE id = ?", [b]).a).toBe(1);

      // 50 000 of the 100 000 shortfall: still flagged.
      const top1 = (await f.svc.createPayment(f.users.accounts, { bookingId: b, residentId: f.residentId, amountMinor: 50000, method: "cash" })) as Record<string, unknown>;
      await f.svc.updatePaymentStatus(f.users.accounts, Number(top1.id), "submitted");
      const v1 = await f.svc.verifyPayment(f.users.accounts, Number(top1.id));
      expect(v1.summary).toMatchObject({ verifiedPaidMinor: 200000, paymentAttentionRequired: true });
      expect(count(f, "admin.booking.payment_attention_cleared")).toBe(0);

      // The remaining 50 000: requirement met on NET verified (250 000 - 100 000 + 50 000 + 50 000) -> cleared.
      const top2 = (await f.svc.createPayment(f.users.accounts, { bookingId: b, residentId: f.residentId, amountMinor: 50000, method: "cash" })) as Record<string, unknown>;
      await f.svc.updatePaymentStatus(f.users.accounts, Number(top2.id), "submitted");
      const v2 = await f.svc.verifyPayment(f.users.accounts, Number(top2.id));
      expect(v2.summary).toMatchObject({ verifiedPaidMinor: 250000, confirmationRequirementMet: true, paymentAttentionRequired: false });
      expect(one(f, "SELECT payment_attention_required AS a, payment_attention_reason AS r FROM bookings WHERE id = ?", [b])).toEqual({ a: 0, r: null });
      const cleared = audits(f).find((a) => a.action === "admin.booking.payment_attention_cleared")!;
      expect(JSON.parse(cleared.metadata_json!)).toEqual({ cause: "verification", paymentId: Number(top2.id), netVerifiedPaidMinor: 250000, requiredConfirmationAmountMinor: 250000 });
      // History is kept: the deficiency event, the refund and its credit note remain.
      expect(count(f, "admin.booking.payment_deficiency_after_refund")).toBe(1);
      expect(one(f, "SELECT COUNT(*) AS n FROM refunds WHERE status = 'paid'").n).toBe(1);
      expect(one(f, "SELECT COUNT(*) AS n FROM credit_notes").n).toBe(1);
    });

    it("gross verified payments alone never clear the flag (partial refund keeps status verified)", async () => {
      const b = booking(f, "B-A2");
      const p = verifiedPayment(f, "P-A2", b);
      await paidRefund(f, p, 1, "MM-A2");
      // Gross verified (status = 'verified') is still 250 000, but net is 249 999.
      expect(one(f, "SELECT status FROM payments WHERE id = ?", [p]).status).toBe("verified");
      const summary = await f.svc.recalculatePaymentAttention(f.users.manager, b, "verification", null);
      expect(summary).toMatchObject({ verifiedPaidMinor: 249999, paymentAttentionRequired: true });
    });

    it("archiving recalculates, and a verified payment with an open refund cannot be archived", async () => {
      const b = booking(f, "B-A3", "completed");
      const p = verifiedPayment(f, "P-A3", b);
      await f.refunds.requestRefund(f.users.accounts, p, { amountMinor: 1000, reason: REASON });
      await expect(f.svc.updatePaymentStatus(f.users.accounts, p, "archived")).rejects.toThrow(ARCHIVE_OPEN_REFUND_ERROR);
      run(f.db, "UPDATE bookings SET payment_attention_required = 1, payment_attention_reason = 'x' WHERE id = ?", [b]);
      const p2 = verifiedPayment(f, "P-A4", b, 1000);
      // completed booking, flag set, net still covers the requirement after archiving p2 -> cleared with cause "archive".
      await f.svc.updatePaymentStatus(f.users.accounts, p2, "archived");
      expect(one(f, "SELECT payment_attention_required AS a FROM bookings WHERE id = ?", [b]).a).toBe(0);
      expect(JSON.parse(audits(f).find((a) => a.action === "admin.booking.payment_attention_cleared")!.metadata_json!).cause).toBe("archive");
    });
  });

  describe("reports", () => {
    it("finance report and refund report use net verified payments and refund states", async () => {
      const b = booking(f, "B-F1");
      const p = verifiedPayment(f, "P-F1", b);
      await paidRefund(f, p, 100000, "MM-F1");
      const p2 = verifiedPayment(f, "P-F2", booking(f, "B-F2", "confirmed", 50000, f.otherResidentId), 50000, f.otherResidentId);
      await f.refunds.requestRefund(f.users.accounts, p2, { amountMinor: 20000, reason: REASON });

      const dash = await f.svc.financialReport();
      expect(dash).toMatchObject({ verified_payments: 200000, gross_verified_payments: 300000, refunded_totals: 100000, open_refund_totals: 20000 });
      const fin = await f.svc.reportFinance({});
      expect(fin.summary).toMatchObject({ verified_payments: 200000, gross_verified_payments: 300000, refunded_totals: 100000 });

      const rep = await f.refunds.reportRefunds({});
      expect(rep.byStatus).toEqual(expect.arrayContaining([{ status: "paid", count: 1, amount_minor: 100000 }, { status: "requested", count: 1, amount_minor: 20000 }]));
      expect(rep.paid).toMatchObject({ paid_count: 1, paid_amount_minor: 100000, partial_paid_amount_minor: 100000 });
      expect(rep.net).toMatchObject({ gross_verified_minor: 300000, refunded_minor: 100000, net_verified_minor: 200000, credit_notes_issued: 1 });
      expect(rep.byPayoutMethod).toEqual([{ payout_method: "mobile_money", count: 1, amount_minor: 100000 }]);
      const onlyPaid = await f.refunds.reportRefunds({ status: "paid", dateFrom: "2000-01-01", dateTo: "2999-01-01" });
      expect(onlyPaid.refunds).toHaveLength(1);
      expect(JSON.stringify(onlyPaid.refunds)).not.toContain("Akua");
    });
  });

  describe("audit trail", () => {
    it("every step is audited with ids/amounts only (no reasons, notes, payout references or PII)", async () => {
      const p = verifiedPayment(f, "P-U1", booking(f, "B-U1"));
      await f.svc.issueReceipt(f.users.accounts, p);
      const r = await f.refunds.requestRefund(f.users.accounts, p, { reason: `${REASON} ${RESIDENT_PHONE}` });
      await f.refunds.approveRefund(f.users.manager, Number(r.id), "approved per policy NOTE-SECRET");
      await f.refunds.payoutRefund(f.users.accounts, Number(r.id), { method: "bank_transfer", reference: "BANKREF-SECRET-123" });
      const actions = audits(f).map((a) => a.action);
      for (const a of ["admin.refund.requested", "admin.refund.approved", "admin.refund.paid", "admin.payment.refunded", "admin.credit_note.issued", "admin.receipt.voided", "admin.booking.payment_deficiency_after_refund"]) expect(actions).toContain(a);
      const blob = JSON.stringify(audits(f));
      for (const secret of ["moved out", RESIDENT_PHONE, "NOTE-SECRET", "BANKREF-SECRET-123", "Akua", "res1@example.com"]) expect(blob).not.toContain(secret);
    });
  });

  describe("HTTP + RBAC", () => {
    it("reception cannot touch any refund route; accounts/manager can; self-approval is 403", async () => {
      const p = verifiedPayment(f, "P-H1", booking(f, "B-H1"));
      expect((await api(f.db, "reception", "POST", `/admin/payments/${p}/refund`, { reason: REASON })).status).toBe(403);
      const created = await api(f.db, "accounts", "POST", `/admin/payments/${p}/refund`, { amountMinor: 100000, reason: REASON });
      expect(created.status).toBe(201);
      const id = Number(created.json.data.id);
      for (const [m, path] of [["GET", "/admin/refunds"], ["GET", `/admin/refunds/${id}`], ["POST", `/admin/refunds/${id}/approve`], ["POST", `/admin/refunds/${id}/reject`], ["POST", `/admin/refunds/${id}/cancel`], ["POST", `/admin/refunds/${id}/payout`], ["GET", "/admin/credit-notes"], ["GET", "/admin/reports/refunds"], ["GET", `/admin/payments/${p}/refunds`]]) {
        expect((await api(f.db, "reception", m, path, m === "POST" ? {} : undefined)).status, `${m} ${path}`).toBe(403);
      }
      const self = await api(f.db, "accounts", "POST", `/admin/refunds/${id}/approve`, {});
      expect(self.status).toBe(403);
      expect(self.json.error.message).toBe(REFUND_SELF_APPROVAL_ERROR);
      expect((await api(f.db, "manager", "POST", `/admin/refunds/${id}/approve`, {})).status).toBe(200);
      const paid = await api(f.db, "accounts", "POST", `/admin/refunds/${id}/payout`, { method: "mobile_money", reference: "MM-H1" });
      expect(paid.status).toBe(200);
      const list = await api(f.db, "manager", "GET", `/admin/payments/${p}/refunds`);
      expect(list.json.data.refundable).toMatchObject({ refundedMinor: 100000, refundableMinor: 150000 });
      const cns = await api(f.db, "accounts", "GET", "/admin/credit-notes");
      expect(cns.json.data).toHaveLength(1);
      const cn = await api(f.db, "accounts", "GET", `/admin/credit-notes/${cns.json.data[0].id}`);
      expect(cn.json.data).toMatchObject({ credit_note_number: "KSM-CRN-0001", payout_method: "mobile_money" });
      const over = await api(f.db, "accounts", "POST", `/admin/payments/${p}/refund`, { amountMinor: 150001, reason: REASON });
      expect(over.status).toBe(409);
      const report = await api(f.db, "accounts", "GET", "/admin/reports/refunds?status=paid");
      expect(report.status).toBe(200);
      expect(report.json.data.refunds).toHaveLength(1);
    });

    it("status endpoint still refuses refunded; residents see only their own refunds and credit notes, without staff notes", async () => {
      const p = verifiedPayment(f, "P-H2", booking(f, "B-H2"));
      expect((await api(f.db, "manager", "PATCH", `/admin/payments/${p}/status`, { status: "refunded" })).status).toBe(400);
      await paidRefund(f, p, 1000, "MM-H2");
      const other = verifiedPayment(f, "P-H3", booking(f, "B-H3", "confirmed", 250000, f.otherResidentId), 250000, f.otherResidentId);
      await paidRefund(f, other, 500, "MM-H3");
      const mine = await api(f.db, "resident", "GET", "/resident/me/refunds");
      expect(mine.status).toBe(200);
      expect(mine.json.data).toHaveLength(1);
      expect(mine.json.data[0]).toMatchObject({ amount_minor: 1000, status: "paid", payment_reference: "P-H2", credit_note_number: "KSM-CRN-0001" });
      expect(JSON.stringify(mine.json.data)).not.toContain("moved out");
      const notes = await api(f.db, "resident", "GET", "/resident/me/credit-notes");
      expect(notes.json.data).toHaveLength(1);
      expect((await api(f.db, "resident", "GET", "/admin/refunds")).status).toBe(403);
    });
  });
});
