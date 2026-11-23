PRAGMA foreign_keys = ON;

-- Refund redesign milestone 2 (refund records, partial refunds, maker/checker, payouts, credit notes).
-- 0021 is reserved for staff password rotation; this is 0022.
--
-- Additive only: no existing table is rebuilt and no existing row is deleted. The only write to
-- existing rows is a backfill of the two NEW payments columns for payments that were already fully
-- refunded under milestone 1 (status = 'refunded'), so net-paid maths stays identical for them.
--
-- Money model:
--   payments.refunded_amount_minor = sum of PAID refunds for the payment (never above amount_minor).
--   net verified paid for a booking  = SUM(amount_minor - refunded_amount_minor) over status = 'verified'.
--   A full refund (refunded_amount_minor = amount_minor) moves the payment to status 'refunded'.
--   A partial refund keeps status 'verified' and sets refund_status = 'partially_refunded'.
--
-- Refund lifecycle (enforced by trigger, terminal states are immutable):
--   requested -> approved | rejected | cancelled
--   approved  -> paid | cancelled
--   rejected / cancelled / paid -> (none)

ALTER TABLE payments ADD COLUMN refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount_minor >= 0);
ALTER TABLE payments ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'partially_refunded', 'fully_refunded'));

UPDATE payments
SET refunded_amount_minor = amount_minor,
    refund_status = 'fully_refunded'
WHERE status = 'refunded' AND refunded_amount_minor = 0;

CREATE TRIGGER IF NOT EXISTS payments_refunded_amount_within_payment
BEFORE UPDATE OF refunded_amount_minor ON payments
WHEN NEW.refunded_amount_minor > NEW.amount_minor OR NEW.refunded_amount_minor < OLD.refunded_amount_minor
BEGIN
  SELECT RAISE(ABORT, 'refunded amount must not exceed payment amount or decrease');
END;

CREATE TABLE IF NOT EXISTS refund_number_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL DEFAULT 'KSM-RFD',
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  padding INTEGER NOT NULL DEFAULT 4 CHECK (padding >= 4),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO refund_number_sequence (id, prefix, next_value, padding)
SELECT 1, 'KSM-RFD', 1, 4 WHERE NOT EXISTS (SELECT 1 FROM refund_number_sequence WHERE id = 1);

CREATE TABLE IF NOT EXISTS credit_note_number_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL DEFAULT 'KSM-CRN',
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  padding INTEGER NOT NULL DEFAULT 4 CHECK (padding >= 4),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO credit_note_number_sequence (id, prefix, next_value, padding)
SELECT 1, 'KSM-CRN', 1, 4 WHERE NOT EXISTS (SELECT 1 FROM credit_note_number_sequence WHERE id = 1);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY,
  refund_number TEXT NOT NULL UNIQUE,
  payment_id INTEGER NOT NULL,
  booking_id INTEGER,
  resident_id INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = upper(currency) AND length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled', 'paid')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  requested_by_staff_id INTEGER NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  approved_by_staff_id INTEGER,
  approved_at TEXT,
  rejected_by_staff_id INTEGER,
  rejected_at TEXT,
  cancelled_by_staff_id INTEGER,
  cancelled_at TEXT,
  decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 2000),
  paid_by_staff_id INTEGER,
  paid_at TEXT,
  payout_method TEXT CHECK (payout_method IS NULL OR payout_method IN ('cash', 'bank_transfer', 'mobile_money', 'card', 'other')),
  payout_reference TEXT CHECK (payout_reference IS NULL OR length(trim(payout_reference)) BETWEEN 1 AND 120),
  -- Opaque per-operation token used to chain the statements of one atomic D1 batch; not business data.
  op_token TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_by_staff_id) REFERENCES staff(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by_staff_id) REFERENCES staff(id) ON DELETE RESTRICT,
  FOREIGN KEY (rejected_by_staff_id) REFERENCES staff(id) ON DELETE RESTRICT,
  FOREIGN KEY (cancelled_by_staff_id) REFERENCES staff(id) ON DELETE RESTRICT,
  FOREIGN KEY (paid_by_staff_id) REFERENCES staff(id) ON DELETE RESTRICT,
  -- Maker/checker: the approver (and rejecter) can never be the requester.
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id <> requested_by_staff_id),
  CHECK (rejected_by_staff_id IS NULL OR rejected_by_staff_id <> requested_by_staff_id),
  CHECK (status NOT IN ('approved', 'paid') OR (approved_by_staff_id IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'rejected' OR (rejected_by_staff_id IS NOT NULL AND rejected_at IS NOT NULL)),
  CHECK (status <> 'cancelled' OR (cancelled_by_staff_id IS NOT NULL AND cancelled_at IS NOT NULL)),
  CHECK (status <> 'paid' OR (paid_by_staff_id IS NOT NULL AND paid_at IS NOT NULL AND payout_method IS NOT NULL AND payout_reference IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_refunds_payment_status ON refunds (payment_id, status);
CREATE INDEX IF NOT EXISTS idx_refunds_booking ON refunds (booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_resident ON refunds (resident_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status_requested_at ON refunds (status, requested_at);
CREATE INDEX IF NOT EXISTS idx_refunds_paid_at ON refunds (paid_at);
-- One payout reference can settle only one refund (per payout method): blocks double payouts.
CREATE UNIQUE INDEX IF NOT EXISTS ux_refunds_payout_reference ON refunds (payout_method, payout_reference) WHERE payout_reference IS NOT NULL;

-- Open (requested/approved) plus paid refunds may never exceed the payment amount.
CREATE TRIGGER IF NOT EXISTS refunds_within_payment_amount
BEFORE INSERT ON refunds
WHEN NEW.amount_minor + COALESCE((SELECT SUM(r.amount_minor) FROM refunds r WHERE r.payment_id = NEW.payment_id AND r.status IN ('requested', 'approved', 'paid')), 0)
     > (SELECT p.amount_minor FROM payments p WHERE p.id = NEW.payment_id)
BEGIN
  SELECT RAISE(ABORT, 'refund exceeds refundable amount');
END;

-- Only forward lifecycle transitions; terminal states and money fields are immutable.
CREATE TRIGGER IF NOT EXISTS refunds_status_transition
BEFORE UPDATE OF status ON refunds
WHEN NOT (
  OLD.status = NEW.status
  OR (OLD.status = 'requested' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
  OR (OLD.status = 'approved' AND NEW.status IN ('paid', 'cancelled'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid refund status transition');
END;

CREATE TRIGGER IF NOT EXISTS refunds_immutable_fields
BEFORE UPDATE ON refunds
WHEN NEW.payment_id IS NOT OLD.payment_id
  OR NEW.amount_minor IS NOT OLD.amount_minor
  OR NEW.currency IS NOT OLD.currency
  OR NEW.refund_number IS NOT OLD.refund_number
  OR NEW.requested_by_staff_id IS NOT OLD.requested_by_staff_id
  OR NEW.reason IS NOT OLD.reason
  OR (OLD.status IN ('paid', 'rejected', 'cancelled') AND NEW.op_token IS NOT OLD.op_token)
BEGIN
  SELECT RAISE(ABORT, 'refund record is immutable');
END;

CREATE TRIGGER IF NOT EXISTS refunds_no_delete
BEFORE DELETE ON refunds
BEGIN
  SELECT RAISE(ABORT, 'refund records cannot be deleted');
END;

CREATE TABLE IF NOT EXISTS credit_notes (
  id INTEGER PRIMARY KEY,
  credit_note_number TEXT NOT NULL UNIQUE,
  refund_id INTEGER NOT NULL UNIQUE,
  payment_id INTEGER NOT NULL,
  booking_id INTEGER,
  resident_id INTEGER NOT NULL,
  receipt_id INTEGER,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = upper(currency) AND length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'voided')),
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  issued_by_staff_id INTEGER,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (refund_id) REFERENCES refunds(id) ON DELETE RESTRICT,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT,
  FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE SET NULL,
  FOREIGN KEY (issued_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_payment ON credit_notes (payment_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_resident ON credit_notes (resident_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_issued_at ON credit_notes (issued_at);

CREATE TRIGGER IF NOT EXISTS credit_notes_no_delete
BEFORE DELETE ON credit_notes
BEGIN
  SELECT RAISE(ABORT, 'credit notes cannot be deleted');
END;
