PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS payment_reference_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL DEFAULT 'KSM-PAY',
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  padding INTEGER NOT NULL DEFAULT 4 CHECK (padding >= 4),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS receipt_number_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL DEFAULT 'KSM-RCP',
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  padding INTEGER NOT NULL DEFAULT 4 CHECK (padding >= 4),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS payment_confirmation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  requirement_type TEXT NOT NULL CHECK (requirement_type IN ('full', 'fixed', 'percentage')),
  fixed_amount_minor INTEGER CHECK (fixed_amount_minor IS NULL OR fixed_amount_minor >= 0),
  percentage_basis_points INTEGER CHECK (percentage_basis_points IS NULL OR percentage_basis_points BETWEEN 0 AND 10000),
  currency TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = upper(currency) AND length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO payment_reference_sequence (id, prefix, next_value, padding)
SELECT 1, 'KSM-PAY', COALESCE((SELECT MAX(CAST(substr(payment_reference, 9) AS INTEGER)) + 1 FROM payments WHERE payment_reference GLOB 'KSM-PAY-[0-9][0-9][0-9][0-9]*'), 1), 4
WHERE NOT EXISTS (SELECT 1 FROM payment_reference_sequence WHERE id = 1);

INSERT INTO receipt_number_sequence (id, prefix, next_value, padding)
SELECT 1, 'KSM-RCP', COALESCE((SELECT MAX(CAST(substr(receipt_number, 9) AS INTEGER)) + 1 FROM receipts WHERE receipt_number GLOB 'KSM-RCP-[0-9][0-9][0-9][0-9]*'), 1), 4
WHERE NOT EXISTS (SELECT 1 FROM receipt_number_sequence WHERE id = 1);

INSERT INTO payment_confirmation_settings (id, requirement_type, fixed_amount_minor, percentage_basis_points, currency, status)
SELECT 1, 'full', NULL, NULL, 'GHS', 'active'
WHERE NOT EXISTS (SELECT 1 FROM payment_confirmation_settings WHERE id = 1);

ALTER TABLE bookings ADD COLUMN payment_attention_required INTEGER NOT NULL DEFAULT 0 CHECK (payment_attention_required IN (0, 1));
ALTER TABLE bookings ADD COLUMN payment_attention_reason TEXT;
