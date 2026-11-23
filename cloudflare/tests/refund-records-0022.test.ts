import { describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import { all, get, listMigrationFiles, openMigratedDatabase, readMigrationSql, run } from "./apply-migrations";

/**
 * Migration 0022 (refund records, credit notes): additive schema, DB-level guards, and
 * preservation of every pre-existing row when applied on top of 0001–0021.
 */
const THROUGH_0021 = "0021_staff_password_rotation.sql";
const M0022 = "0022_refund_records_credit_notes.sql";

function seedPre0022(db: Database) {
  run(db, "INSERT INTO roles (code, name, is_system) VALUES ('manager', 'Manager', 1), ('accounts', 'Accounts', 1)");
  run(db, "INSERT INTO users (email, phone, display_name, user_type, status) VALUES ('m@example.com', '+233200000091', 'M', 'staff', 'active'), ('a@example.com', '+233200000092', 'A', 'staff', 'active'), ('r@example.com', '+233200000093', 'R', 'resident', 'active')");
  run(db, "INSERT INTO staff (id, user_id, role_id, staff_code, status) SELECT 1, u.id, r.id, 'KSM-STF-0001', 'active' FROM users u, roles r WHERE u.email = 'm@example.com' AND r.code = 'manager'");
  run(db, "INSERT INTO staff (id, user_id, role_id, staff_code, status) SELECT 2, u.id, r.id, 'KSM-STF-0002', 'active' FROM users u, roles r WHERE u.email = 'a@example.com' AND r.code = 'accounts'");
  run(db, "INSERT INTO residents (id, user_id, first_name, last_name, gender, status, resident_kind) SELECT 1, id, 'Esi', 'Pre', 'female', 'resident', 'non_student' FROM users WHERE email = 'r@example.com'");
  run(db, "INSERT INTO academic_sessions (id, code, name, starts_on, ends_on, status) VALUES (1, 'S1', 'S1', '2026-09-01', '2027-06-30', 'active')");
  run(db, "INSERT INTO bookings (id, resident_id, academic_session_id, booking_number, status, total_amount_minor, currency, payment_attention_required, payment_attention_reason) VALUES (1, 1, 1, 'KSM-BKG-P1', 'confirmed', 250000, 'GHS', 1, 'Refund reduced verified payments below confirmation threshold')");
  run(db, "INSERT INTO payments (id, booking_id, resident_id, payment_reference, status, amount_minor, currency, method, notes) VALUES (1, 1, 1, 'KSM-PAY-P1', 'verified', 100000, 'GHS', 'cash', 'kept'), (2, 1, 1, 'KSM-PAY-P2', 'refunded', 150000, 'GHS', 'mobile_money', 'legacy refund'), (3, 1, 1, 'KSM-PAY-P3', 'submitted', 5000, 'GHS', 'card', NULL)");
  run(db, "INSERT INTO receipts (id, payment_id, receipt_number, status) VALUES (1, 1, 'KSM-RCP-0001', 'issued'), (2, 2, 'KSM-RCP-0002', 'voided')");
  run(db, "INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity_type, entity_id) VALUES (1, 1, 'admin.payment.refunded', 'payment', 2)");
}

const snapshot = (db: Database, table: string, cols: string) => all<Record<string, unknown>>(db, `SELECT ${cols} FROM ${table} ORDER BY id`);

describe("migration 0022 refund records + credit notes", () => {
  it("is the next migration after 0021", () => {
    const files = listMigrationFiles();
    expect(files.indexOf(M0022)).toBe(files.indexOf(THROUGH_0021) + 1);
  });

  it("preserves all existing rows and backfills only the new payment columns for legacy full refunds", async () => {
    const db = await openMigratedDatabase(THROUGH_0021);
    seedPre0022(db);
    const paymentCols = "id, booking_id, resident_id, payment_reference, status, amount_minor, currency, method, notes, created_at";
    const before = {
      payments: snapshot(db, "payments", paymentCols),
      receipts: snapshot(db, "receipts", "*"),
      bookings: snapshot(db, "bookings", "*"),
      audit: snapshot(db, "audit_logs", "*"),
    };
    db.run(readMigrationSql(M0022));
    expect(snapshot(db, "payments", paymentCols)).toEqual(before.payments);
    expect(snapshot(db, "receipts", "*")).toEqual(before.receipts);
    expect(snapshot(db, "bookings", "*")).toEqual(before.bookings);
    expect(snapshot(db, "audit_logs", "*")).toEqual(before.audit);
    expect(snapshot(db, "payments", "id, refunded_amount_minor, refund_status")).toEqual([
      { id: 1, refunded_amount_minor: 0, refund_status: "none" },
      { id: 2, refunded_amount_minor: 150000, refund_status: "fully_refunded" },
      { id: 3, refunded_amount_minor: 0, refund_status: "none" },
    ]);
    // Re-applying is a no-op for the backfill (idempotent guard) and objects use IF NOT EXISTS.
    db.run(readMigrationSql(M0022).replace(/ALTER TABLE payments ADD COLUMN[^;]+;/g, ""));
    expect(snapshot(db, "payments", "id, refunded_amount_minor")).toEqual([
      { id: 1, refunded_amount_minor: 0 },
      { id: 2, refunded_amount_minor: 150000 },
      { id: 3, refunded_amount_minor: 0 },
    ]);
  });

  describe("database-level guards", () => {
    async function db0022() {
      const db = await openMigratedDatabase(M0022);
      seedPre0022(db);
      return db;
    }
    const insertRefund = (db: Database, n: string, amount: number, status = "requested", requester = 1) =>
      run(db, "INSERT INTO refunds (refund_number, payment_id, booking_id, resident_id, amount_minor, status, reason, requested_by_staff_id) VALUES (?, 1, 1, 1, ?, ?, 'reason', ?)", [n, amount, status, requester]);

    it("refuses refunds above the payment amount (open + paid)", async () => {
      const db = await db0022();
      insertRefund(db, "R1", 60000);
      expect(() => insertRefund(db, "R2", 40001)).toThrow(/refund exceeds refundable amount/);
      insertRefund(db, "R3", 40000);
    });

    it("refuses self-approval and incomplete paid records", async () => {
      const db = await db0022();
      insertRefund(db, "R1", 1000);
      expect(() => run(db, "UPDATE refunds SET status = 'approved', approved_by_staff_id = 1, approved_at = 'x' WHERE refund_number = 'R1'")).toThrow(/CHECK/);
      run(db, "UPDATE refunds SET status = 'approved', approved_by_staff_id = 2, approved_at = 'x' WHERE refund_number = 'R1'");
      expect(() => run(db, "UPDATE refunds SET status = 'paid', paid_by_staff_id = 2, paid_at = 'x' WHERE refund_number = 'R1'")).toThrow(/CHECK/);
    });

    it("allows only forward transitions and keeps terminal records immutable and undeletable", async () => {
      const db = await db0022();
      insertRefund(db, "R1", 1000);
      expect(() => run(db, "UPDATE refunds SET status = 'paid' WHERE refund_number = 'R1'")).toThrow(/invalid refund status transition/);
      run(db, "UPDATE refunds SET status = 'rejected', rejected_by_staff_id = 2, rejected_at = 'x' WHERE refund_number = 'R1'");
      expect(() => run(db, "UPDATE refunds SET status = 'requested' WHERE refund_number = 'R1'")).toThrow(/invalid refund status transition/);
      expect(() => run(db, "UPDATE refunds SET amount_minor = 1 WHERE refund_number = 'R1'")).toThrow(/immutable/);
      expect(() => run(db, "DELETE FROM refunds WHERE refund_number = 'R1'")).toThrow(/cannot be deleted/);
      // A rejected refund frees its amount again.
      insertRefund(db, "R2", 100000);
    });

    it("payments.refunded_amount_minor cannot exceed the payment or decrease", async () => {
      const db = await db0022();
      expect(() => run(db, "UPDATE payments SET refunded_amount_minor = 100001 WHERE id = 1")).toThrow(/must not exceed/);
      run(db, "UPDATE payments SET refunded_amount_minor = 10 WHERE id = 1");
      expect(() => run(db, "UPDATE payments SET refunded_amount_minor = 5 WHERE id = 1")).toThrow(/must not exceed/);
    });

    it("one payout reference settles only one refund per method", async () => {
      const db = await db0022();
      for (const n of ["R1", "R2"]) {
        insertRefund(db, n, 1000);
        run(db, "UPDATE refunds SET status = 'approved', approved_by_staff_id = 2, approved_at = 'x' WHERE refund_number = ?", [n]);
      }
      run(db, "UPDATE refunds SET status = 'paid', paid_by_staff_id = 2, paid_at = 'x', payout_method = 'mobile_money', payout_reference = 'MM-1' WHERE refund_number = 'R1'");
      expect(() => run(db, "UPDATE refunds SET status = 'paid', paid_by_staff_id = 2, paid_at = 'x', payout_method = 'mobile_money', payout_reference = 'MM-1' WHERE refund_number = 'R2'")).toThrow(/UNIQUE/);
      expect(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM refunds WHERE status = 'paid'")!.n).toBe(1);
    });

    it("credit notes cannot be deleted", async () => {
      const db = await db0022();
      insertRefund(db, "R1", 1000);
      run(db, "INSERT INTO credit_notes (credit_note_number, refund_id, payment_id, booking_id, resident_id, amount_minor) SELECT 'KSM-CRN-0001', id, 1, 1, 1, 1000 FROM refunds WHERE refund_number = 'R1'");
      expect(() => run(db, "DELETE FROM credit_notes")).toThrow(/cannot be deleted/);
    });
  });
});
