import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import { all, get, openMigratedDatabase, run } from "./apply-migrations";
import app from "../src/index";
import { AdminRepository } from "../src/repositories/admin.repository";
import {
  AdminService,
  REFUND_ATTENTION_REASON,
  REFUND_RECEIPT_VOID_REASON,
  REFUND_VIA_STATUS_ERROR,
  ARCHIVE_VERIFIED_ACTIVE_BOOKING_ERROR,
} from "../src/services/admin.service";
import { sha256Hex } from "../src/auth/crypto";
import { RefundService } from "../src/services/refund.service";
import type { AuthUser } from "../src/auth/context";
import type { Env } from "../src/types/bindings";

/**
 * Refund integrity (milestone 1 of the refund redesign), against the real migrated schema
 * (0001–0020) in sql.js.
 *
 * Regression for: `PATCH /admin/payments/:id/status {status:"refunded"}` used to mark a payment
 * refunded while skipping the booking payment-attention flag that `POST /refund` sets, and no
 * refund path touched the payment's issued receipt.
 */

function createSqlJsD1(db: Database): D1Database {
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
    // D1 runs a batch as one SQL transaction; mirror that so atomicity is actually exercised.
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
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
    },
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

const RESIDENT_PHONE = "+233200000123";
const RESIDENT_EMAIL = "refund.resident@example.com";
const REFUND_REASON = "Resident withdrew before move-in";

const TOKENS = {
  manager: "test-session-manager-0123456789abcdef",
  accounts: "test-session-accounts-0123456789abcdef",
  reception: "test-session-reception-0123456789abcdef",
} as const;

type Fixture = {
  db: Database;
  svc: AdminService;
  residentId: number;
  sessionId: number;
  accounts: AuthUser;
  manager: AuthUser;
  refunds: RefundService;
};

/**
 * Full refund through the milestone-2 flow: accounts requests, manager approves (maker/checker),
 * accounts records the payout. Returns the milestone-1 shaped result used by these regressions.
 */
async function fullRefund(f: Fixture, paymentId: number, reason?: string | null) {
  const receiptBefore = get<{ id: number; status: string }>(f.db, "SELECT id, status FROM receipts WHERE payment_id = ?", [paymentId]);
  const requested = await f.refunds.requestRefund(f.accounts, paymentId, { reason });
  await f.refunds.approveRefund(f.manager, Number(requested.id));
  const paid = await f.refunds.payoutRefund(f.accounts, Number(requested.id), { method: "mobile_money", reference: `MM-${paymentId}-${Date.now()}` });
  const receiptAfter = get<{ id: number; status: string }>(f.db, "SELECT id, status FROM receipts WHERE payment_id = ?", [paymentId]);
  return {
    refund: paid.refund,
    payment: get<Record<string, unknown>>(f.db, "SELECT * FROM payments WHERE id = ?", [paymentId])!,
    summary: paid.summary,
    voidedReceiptId: receiptBefore?.status === "issued" && receiptAfter?.status === "voided" ? Number(receiptAfter.id) : null,
  };
}

async function seed(): Promise<Fixture> {
  const db = await openMigratedDatabase();
  const staffIds: Record<string, number> = {};
  let n = 0;
  for (const role of ["manager", "accounts", "reception"] as const) {
    n += 1;
    run(db, "INSERT INTO roles (code, name, is_system) VALUES (?, ?, 1)", [role, role]);
    run(db, "INSERT INTO users (email, phone, display_name, user_type, status) VALUES (?, ?, ?, 'staff', 'active')", [
      `${role}@example.com`,
      `+23320000009${n}`,
      role,
    ]);
    run(db, `INSERT INTO staff (user_id, role_id, staff_code, status)
      SELECT u.id, r.id, ?, 'active' FROM users u CROSS JOIN roles r WHERE u.email = ? AND r.code = ?`, [
      `KSM-STF-000${n}`,
      `${role}@example.com`,
      role,
    ]);
    const userId = Number(get<{ id: number }>(db, "SELECT id FROM users WHERE email = ?", [`${role}@example.com`])!.id);
    staffIds[role] = Number(get<{ id: number }>(db, "SELECT id FROM staff WHERE user_id = ?", [userId])!.id);
    run(db, "INSERT INTO sessions (user_id, session_token_hash, status, expires_at) VALUES (?, ?, 'active', '2099-01-01T00:00:00.000Z')", [
      userId,
      await sha256Hex(TOKENS[role]),
    ]);
  }
  run(db, "INSERT INTO academic_sessions (code, name, starts_on, ends_on, status) VALUES ('2026-2027', '2026/2027', '2026-09-01', '2027-06-30', 'active')");
  run(db, "INSERT INTO users (email, phone, display_name, user_type, status) VALUES (?, ?, 'Refund Resident', 'resident', 'active')", [
    RESIDENT_EMAIL,
    RESIDENT_PHONE,
  ]);
  run(db, `INSERT INTO residents (user_id, first_name, last_name, gender, status, resident_kind)
    SELECT id, 'Abena', 'Refundtest', 'female', 'resident', 'non_student' FROM users WHERE email = ?`, [RESIDENT_EMAIL]);
  const residentId = Number(get<{ id: number }>(db, "SELECT id FROM residents WHERE first_name = 'Abena'")!.id);
  const sessionId = Number(get<{ id: number }>(db, "SELECT id FROM academic_sessions")!.id);
  const accountsUserId = Number(get<{ id: number }>(db, "SELECT id FROM users WHERE email = 'accounts@example.com'")!.id);
  const accounts: AuthUser = {
    id: accountsUserId,
    userType: "staff",
    displayName: "accounts",
    email: "accounts@example.com",
    role: "accounts",
    staffId: staffIds.accounts,
    residentId: null,
    sessionId: 2,
  };
  const managerUserId = Number(get<{ id: number }>(db, "SELECT id FROM users WHERE email = 'manager@example.com'")!.id);
  const manager: AuthUser = { ...accounts, id: managerUserId, displayName: "manager", email: "manager@example.com", role: "manager", staffId: staffIds.manager, sessionId: 1 };
  const repo = new AdminRepository(createSqlJsD1(db));
  const svc = new AdminService(repo);
  return { db, svc, refunds: new RefundService(repo, svc), residentId, sessionId, accounts, manager };
}

function insertBooking(f: Fixture, number: string, status: "pending" | "confirmed", totalMinor = 250000): number {
  run(f.db, `INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
    VALUES (?, ?, ?, ?, ?, 'GHS')`, [f.residentId, f.sessionId, number, status, totalMinor]);
  return Number(get<{ id: number }>(f.db, "SELECT id FROM bookings WHERE booking_number = ?", [number])!.id);
}

function insertVerifiedPayment(f: Fixture, reference: string, bookingId: number | null, amountMinor = 250000): number {
  run(f.db, `INSERT INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method, verified_at)
    VALUES (?, ?, ?, 'verified', ?, 'GHS', 'mobile_money', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`, [
    bookingId,
    f.residentId,
    reference,
    amountMinor,
  ]);
  return Number(get<{ id: number }>(f.db, "SELECT id FROM payments WHERE payment_reference = ?", [reference])!.id);
}

const row = (f: Fixture, sql: string, params: Array<string | number | null> = []) => get<Record<string, unknown>>(f.db, sql, params)!;
const audits = (f: Fixture) => all<{ action: string; entity_type: string; entity_id: number; metadata_json: string | null }>(
  f.db,
  "SELECT action, entity_type, entity_id, metadata_json FROM audit_logs ORDER BY id",
);

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

async function api(db: Database, token: string, method: string, path: string, body?: unknown) {
  const res = await app.request(
    `http://worker.test${path}`,
    { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    testEnv(db),
  );
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

describe("refund integrity — single authoritative refund path (real schema)", () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seed();
  });

  it("refund voids the issued receipt, flags the confirmed booking and keeps reports consistent", async () => {
    const bookingId = insertBooking(f, "KSM-BKG-R1", "confirmed");
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-R1", bookingId);
    const receipt = await f.svc.issueReceipt(f.accounts, paymentId) as Record<string, unknown>;
    expect(receipt.status).toBe("issued");

    const before = await f.svc.financialReport();
    expect(Number(before?.verified_payments)).toBe(250000);
    expect(Number(before?.bookings_requiring_payment_attention)).toBe(0);

    const result = await fullRefund(f, paymentId, `  ${REFUND_REASON}  `);
    expect((result.payment as Record<string, unknown>).status).toBe("refunded");
    expect(result.summary).toMatchObject({ verifiedPaidMinor: 0, confirmationRequirementMet: false, paymentAttentionRequired: true });
    expect(result.voidedReceiptId).toBe(Number(receipt.id));

    expect(row(f, "SELECT status, refunded_amount_minor, refund_status FROM payments WHERE id = ?", [paymentId])).toMatchObject({ status: "refunded", refunded_amount_minor: 250000, refund_status: "fully_refunded" });
    expect(row(f, "SELECT reason FROM refunds WHERE payment_id = ?", [paymentId]).reason).toBe(REFUND_REASON);
    const rec = row(f, "SELECT status, void_reason, voided_at FROM receipts WHERE id = ?", [Number(receipt.id)]);
    expect(rec).toMatchObject({ status: "voided", void_reason: REFUND_RECEIPT_VOID_REASON });
    expect(rec.voided_at).toBeTruthy();
    const booking = row(f, "SELECT status, payment_attention_required, payment_attention_reason FROM bookings WHERE id = ?", [bookingId]);
    expect(booking).toMatchObject({ status: "confirmed", payment_attention_required: 1, payment_attention_reason: REFUND_ATTENTION_REASON });

    const after = await f.svc.financialReport();
    expect(Number(after?.verified_payments)).toBe(0);
    expect(Number(after?.refunded_totals)).toBe(250000);
    expect(Number(after?.bookings_requiring_payment_attention)).toBe(1);
    const report = await f.svc.reportFinance({});
    expect(Number(report.summary.refunded_totals)).toBe(250000);
    expect(Number(report.summary.verified_payments)).toBe(0);

    const actions = audits(f).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["admin.payment.refunded", "admin.receipt.voided", "admin.booking.payment_deficiency_after_refund"]));
    expect(actions.filter((a) => a === "admin.payment.refunded")).toHaveLength(1);
  });

  it("audit metadata carries ids and amounts only — no reason text or resident PII", async () => {
    const bookingId = insertBooking(f, "KSM-BKG-R2", "confirmed");
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-R2", bookingId);
    await f.svc.issueReceipt(f.accounts, paymentId);
    await fullRefund(f, paymentId, `${REFUND_REASON} call ${RESIDENT_PHONE}`);
    const blob = JSON.stringify(audits(f));
    for (const secret of [REFUND_REASON, RESIDENT_PHONE, RESIDENT_EMAIL, "Abena", "Refundtest"]) expect(blob).not.toContain(secret);
    const refunded = audits(f).find((a) => a.action === "admin.payment.refunded")!;
    expect(JSON.parse(refunded.metadata_json!)).toEqual({ refundId: expect.any(Number), bookingId, amountMinor: 250000, refundedTotalMinor: 250000, refundStatus: "fully_refunded" });
  });

  it("generic status path refuses `refunded` and changes nothing", async () => {
    const bookingId = insertBooking(f, "KSM-BKG-R3", "confirmed");
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-R3", bookingId);
    await f.svc.issueReceipt(f.accounts, paymentId);
    const auditCount = audits(f).length;
    await expect(f.svc.updatePaymentStatus(f.accounts, paymentId, "refunded")).rejects.toThrow(REFUND_VIA_STATUS_ERROR);
    expect(row(f, "SELECT status FROM payments WHERE id = ?", [paymentId]).status).toBe("verified");
    expect(row(f, "SELECT status FROM receipts WHERE payment_id = ?", [paymentId]).status).toBe("issued");
    expect(Number(row(f, "SELECT payment_attention_required AS a FROM bookings WHERE id = ?", [bookingId]).a)).toBe(0);
    expect(audits(f)).toHaveLength(auditCount);
  });

  it("other generic status transitions still work", async () => {
    const bookingId = insertBooking(f, "KSM-BKG-R4", "pending");
    run(f.db, `INSERT INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method)
      VALUES (?, ?, 'KSM-PAY-R4', 'pending', 1000, 'GHS', 'cash')`, [bookingId, f.residentId]);
    const paymentId = Number(row(f, "SELECT id FROM payments WHERE payment_reference = 'KSM-PAY-R4'").id);
    await f.svc.updatePaymentStatus(f.accounts, paymentId, "submitted");
    expect(row(f, "SELECT status FROM payments WHERE id = ?", [paymentId]).status).toBe("submitted");
  });

  it("a second (or concurrent) refund of the same payment fails without duplicating side effects", async () => {
    const bookingId = insertBooking(f, "KSM-BKG-R5", "confirmed");
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-R5", bookingId);
    await f.svc.issueReceipt(f.accounts, paymentId);
    await fullRefund(f, paymentId, REFUND_REASON);
    await expect(fullRefund(f, paymentId, REFUND_REASON)).rejects.toThrow("Invalid workflow transition");
    expect(audits(f).filter((a) => a.action === "admin.payment.refunded")).toHaveLength(1);
    expect(audits(f).filter((a) => a.action === "admin.receipt.voided")).toHaveLength(1);
  });

  it("requires a refund reason and leaves the payment verified when it is missing", async () => {
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-R6", insertBooking(f, "KSM-BKG-R6", "confirmed"));
    await expect(fullRefund(f, paymentId, "   ")).rejects.toThrow("Refund reason required");
    await expect(fullRefund(f, paymentId)).rejects.toThrow("Refund reason required");
    expect(row(f, "SELECT status FROM payments WHERE id = ?", [paymentId]).status).toBe("verified");
  });

  it("only verified payments can be refunded", async () => {
    const bookingId = insertBooking(f, "KSM-BKG-R7", "pending");
    run(f.db, `INSERT INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method)
      VALUES (?, ?, 'KSM-PAY-R7', 'submitted', 1000, 'GHS', 'cash')`, [bookingId, f.residentId]);
    const paymentId = Number(row(f, "SELECT id FROM payments WHERE payment_reference = 'KSM-PAY-R7'").id);
    await expect(fullRefund(f, paymentId, REFUND_REASON)).rejects.toThrow("Invalid workflow transition");
    expect(row(f, "SELECT status FROM payments WHERE id = ?", [paymentId]).status).toBe("submitted");
  });

  it("pending bookings are not flagged, but the receipt is still voided", async () => {
    const bookingId = insertBooking(f, "KSM-BKG-R8", "pending");
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-R8", bookingId, 100000);
    await f.svc.issueReceipt(f.accounts, paymentId);
    const result = await fullRefund(f, paymentId, REFUND_REASON);
    expect(result.summary).toMatchObject({ verifiedPaidMinor: 0, paymentAttentionRequired: false });
    expect(row(f, "SELECT status FROM receipts WHERE payment_id = ?", [paymentId]).status).toBe("voided");
    expect(Number(row(f, "SELECT payment_attention_required AS a FROM bookings WHERE id = ?", [bookingId]).a)).toBe(0);
  });

  it("refund without a receipt, and a payment detached from its booking, still complete consistently", async () => {
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-R9", null, 5000);
    const result = await fullRefund(f, paymentId, REFUND_REASON);
    expect(result.summary).toBeNull();
    expect(result.voidedReceiptId).toBeNull();
    expect(row(f, "SELECT status FROM payments WHERE id = ?", [paymentId]).status).toBe("refunded");
  });

  it("a refunded payment cannot get a new receipt", async () => {
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-R10", insertBooking(f, "KSM-BKG-R10", "confirmed"));
    await f.svc.issueReceipt(f.accounts, paymentId);
    await fullRefund(f, paymentId, REFUND_REASON);
    await expect(f.svc.issueReceipt(f.accounts, paymentId)).rejects.toThrow("Receipt requires verified payment");
  });

  it("resident receipt view shows the refunded payment's receipt as voided", async () => {
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-R11", insertBooking(f, "KSM-BKG-R11", "confirmed"));
    await f.svc.issueReceipt(f.accounts, paymentId);
    await fullRefund(f, paymentId, REFUND_REASON);
    const receipts = all<{ status: string; voided_at: string | null }>(
      f.db,
      "SELECT rec.status, rec.voided_at FROM receipts rec JOIN payments p ON p.id = rec.payment_id WHERE p.resident_id = ?",
      [f.residentId],
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe("voided");
    expect(receipts[0].voided_at).toBeTruthy();
  });

  describe("HTTP routes (real auth middleware + RBAC)", () => {
    it("PATCH /admin/payments/:id/status {status: refunded} is refused with a pointer to the refund endpoint", async () => {
      const bookingId = insertBooking(f, "KSM-BKG-H1", "confirmed");
      const paymentId = insertVerifiedPayment(f, "KSM-PAY-H1", bookingId);
      await f.svc.issueReceipt(f.accounts, paymentId);
      const res = await api(f.db, TOKENS.manager, "PATCH", `/admin/payments/${paymentId}/status`, { status: "refunded" });
      expect(res.status).toBe(400);
      expect(res.json.error.message).toBe(REFUND_VIA_STATUS_ERROR);
      expect(row(f, "SELECT status FROM payments WHERE id = ?", [paymentId]).status).toBe("verified");
      expect(row(f, "SELECT status FROM receipts WHERE payment_id = ?", [paymentId]).status).toBe("issued");
    });

    it("roles without refund permissions cannot refund through either route", async () => {
      const paymentId = insertVerifiedPayment(f, "KSM-PAY-H2", insertBooking(f, "KSM-BKG-H2", "confirmed"));
      expect((await api(f.db, TOKENS.reception, "PATCH", `/admin/payments/${paymentId}/status`, { status: "refunded" })).status).toBe(403);
      expect((await api(f.db, TOKENS.reception, "POST", `/admin/payments/${paymentId}/refund`, { reason: REFUND_REASON })).status).toBe(403);
      expect(row(f, "SELECT status FROM payments WHERE id = ?", [paymentId]).status).toBe("verified");
    });

    it("POST /admin/payments/:id/refund requires a reason and applies every side effect", async () => {
      const bookingId = insertBooking(f, "KSM-BKG-H3", "confirmed");
      const paymentId = insertVerifiedPayment(f, "KSM-PAY-H3", bookingId);
      await f.svc.issueReceipt(f.accounts, paymentId);

      const missing = await api(f.db, TOKENS.accounts, "POST", `/admin/payments/${paymentId}/refund`, {});
      expect(missing.status).toBe(400);
      expect(missing.json.error.message).toBe("Refund reason required");

      const requested = await api(f.db, TOKENS.accounts, "POST", `/admin/payments/${paymentId}/refund`, { reason: REFUND_REASON });
      expect(requested.status).toBe(201);
      expect(requested.json.data).toMatchObject({ status: "requested", amount_minor: 250000 });
      // Nothing moves until a different user approves and the payout is recorded.
      expect(row(f, "SELECT status FROM payments WHERE id = ?", [paymentId]).status).toBe("verified");
      const refundId = Number(requested.json.data.id);
      expect((await api(f.db, TOKENS.accounts, "POST", `/admin/refunds/${refundId}/approve`, {})).status).toBe(403);
      expect((await api(f.db, TOKENS.manager, "POST", `/admin/refunds/${refundId}/approve`, {})).status).toBe(200);
      const ok = await api(f.db, TOKENS.accounts, "POST", `/admin/refunds/${refundId}/payout`, { method: "bank_transfer", reference: "BT-H3-1" });
      expect(ok.status).toBe(200);
      expect(ok.json.data.refund).toMatchObject({ status: "paid", payment_status: "refunded", payout_reference: "BT-H3-1" });
      expect(ok.json.data.refund.credit_note_number).toMatch(/^KSM-CRN-\d{4}$/);
      expect(ok.json.data.summary.paymentAttentionRequired).toBe(true);
      expect(row(f, "SELECT status FROM receipts WHERE payment_id = ?", [paymentId]).status).toBe("voided");
      expect(Number(row(f, "SELECT payment_attention_required AS a FROM bookings WHERE id = ?", [bookingId]).a)).toBe(1);

      const again = await api(f.db, TOKENS.accounts, "POST", `/admin/payments/${paymentId}/refund`, { reason: REFUND_REASON });
      expect(again.status).toBe(400);
    });

    it("legacy `notes` field is still accepted as the refund reason", async () => {
      const paymentId = insertVerifiedPayment(f, "KSM-PAY-H4", insertBooking(f, "KSM-BKG-H4", "confirmed"));
      const res = await api(f.db, TOKENS.manager, "POST", `/admin/payments/${paymentId}/refund`, { notes: REFUND_REASON });
      expect(res.status).toBe(201);
      expect(row(f, "SELECT reason FROM refunds WHERE payment_id = ?", [paymentId]).reason).toBe(REFUND_REASON);
    });
  });
});

describe("archiving verified payments linked to active bookings is blocked (real schema)", () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seed();
  });

  for (const status of ["pending", "confirmed"] as const) {
    it(`refuses verified -> archived while the booking is ${status}, and changes nothing`, async () => {
      const bookingId = insertBooking(f, `KSM-BKG-A-${status}`, status);
      const paymentId = insertVerifiedPayment(f, `KSM-PAY-A-${status}`, bookingId);
      const receipt = await f.svc.issueReceipt(f.accounts, paymentId) as Record<string, unknown>;
      const before = await f.svc.financialReport();
      await expect(f.svc.updatePaymentStatus(f.accounts, paymentId, "archived")).rejects.toThrow(ARCHIVE_VERIFIED_ACTIVE_BOOKING_ERROR);
      expect(row(f, "SELECT status FROM payments WHERE id = ?", [paymentId]).status).toBe("verified");
      expect(row(f, "SELECT status FROM receipts WHERE id = ?", [Number(receipt.id)]).status).toBe("issued");
      const after = await f.svc.financialReport();
      expect(Number(after?.verified_payments)).toBe(Number(before?.verified_payments));
      const blocked = audits(f).filter((a) => a.action === "admin.payment.archive_blocked");
      expect(blocked).toHaveLength(1);
      expect(JSON.parse(blocked[0].metadata_json ?? "{}")).toEqual({ bookingId, bookingStatus: status });
      expect(audits(f).some((a) => a.action === "admin.payment.archived")).toBe(false);
    });
  }

  for (const status of ["completed", "cancelled", "expired"] as const) {
    it(`allows verified -> archived once the booking is ${status}`, async () => {
      const bookingId = insertBooking(f, `KSM-BKG-B-${status}`, "confirmed");
      const paymentId = insertVerifiedPayment(f, `KSM-PAY-B-${status}`, bookingId);
      run(f.db, "UPDATE bookings SET status = ? WHERE id = ?", [status, bookingId]);
      const archived = await f.svc.updatePaymentStatus(f.accounts, paymentId, "archived") as Record<string, unknown>;
      expect(archived.status).toBe("archived");
    });
  }

  it("allows archiving a verified payment with no booking, and refunded payments on active bookings", async () => {
    const detached = insertVerifiedPayment(f, "KSM-PAY-C1", null);
    expect((await f.svc.updatePaymentStatus(f.accounts, detached, "archived") as Record<string, unknown>).status).toBe("archived");
    const bookingId = insertBooking(f, "KSM-BKG-C2", "confirmed");
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-C2", bookingId);
    await fullRefund(f, paymentId, REFUND_REASON);
    expect((await f.svc.updatePaymentStatus(f.accounts, paymentId, "archived") as Record<string, unknown>).status).toBe("archived");
  });

  it("PATCH /admin/payments/:id/status {status: archived} returns a clear 4xx for an active booking", async () => {
    const bookingId = insertBooking(f, "KSM-BKG-D1", "confirmed");
    const paymentId = insertVerifiedPayment(f, "KSM-PAY-D1", bookingId);
    const res = await api(f.db, TOKENS.accounts, "PATCH", `/admin/payments/${paymentId}/status`, { status: "archived" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.json)).toContain("refund it or end the booking");
    expect(row(f, "SELECT status FROM payments WHERE id = ?", [paymentId]).status).toBe("verified");
  });
});
