PRAGMA foreign_keys = ON;

-- Stage 2L-G: session-optional booking agreements (management-controlled).
-- Migrations 0001–0017 remain immutable.
-- Makes bookings.academic_session_id nullable so Calendar Year / Short-Term
-- Path B agreements can exist without inventing fake academic sessions.
-- Academic Calendar may still carry a session when the chosen lease period is linked.
-- Legacy Path A bookings (session present, lease null) survive unchanged.
-- Preserves payment_attention_required / payment_attention_reason from migration 0005
-- (values carried through INSERT…SELECT; not recreated empty).

PRAGMA foreign_keys = OFF;

CREATE TABLE bookings__new (
  id INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL,
  academic_session_id INTEGER,
  application_id INTEGER,
  booking_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired', 'completed', 'archived')),
  total_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = upper(currency) AND length(currency) = 3),
  booked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  cancelled_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  priced_room_id INTEGER,
  priced_room_rate_id INTEGER,
  lease_period_id INTEGER,
  lease_kind TEXT CHECK (lease_kind IS NULL OR lease_kind IN ('academic_calendar', 'calendar_year', 'short_term')),
  starts_on TEXT,
  ends_on TEXT,
  maintenance_fee_minor INTEGER CHECK (maintenance_fee_minor IS NULL OR maintenance_fee_minor >= 0),
  payment_requirement_type TEXT CHECK (payment_requirement_type IS NULL OR payment_requirement_type IN ('full', 'fixed', 'percentage')),
  payment_fixed_amount_minor INTEGER CHECK (payment_fixed_amount_minor IS NULL OR payment_fixed_amount_minor >= 0),
  payment_percentage_basis_points INTEGER CHECK (payment_percentage_basis_points IS NULL OR payment_percentage_basis_points BETWEEN 0 AND 10000),
  partial_payment_authorized INTEGER NOT NULL DEFAULT 0 CHECK (partial_payment_authorized IN (0, 1)),
  payment_attention_required INTEGER NOT NULL DEFAULT 0 CHECK (payment_attention_required IN (0, 1)),
  payment_attention_reason TEXT,
  prior_booking_id INTEGER,
  override_reason TEXT,
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT,
  FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
  FOREIGN KEY (priced_room_id) REFERENCES rooms(id) ON DELETE RESTRICT,
  FOREIGN KEY (priced_room_rate_id) REFERENCES room_rates(id) ON DELETE RESTRICT,
  FOREIGN KEY (lease_period_id) REFERENCES lease_periods(id) ON DELETE RESTRICT,
  FOREIGN KEY (prior_booking_id) REFERENCES bookings__new(id) ON DELETE RESTRICT,
  -- Meaningful commercial period: session and/or lease period.
  CHECK (academic_session_id IS NOT NULL OR lease_period_id IS NOT NULL),
  -- CY/ST must not invent/attach an academic session.
  CHECK (
    lease_kind IS NULL
    OR lease_kind = 'academic_calendar'
    OR academic_session_id IS NULL
  )
);

INSERT INTO bookings__new (
  id, resident_id, academic_session_id, application_id, booking_number, status,
  total_amount_minor, currency, booked_at, expires_at, cancelled_at, completed_at,
  created_at, updated_at, priced_room_id, priced_room_rate_id,
  lease_period_id, lease_kind, starts_on, ends_on, maintenance_fee_minor,
  payment_requirement_type, payment_fixed_amount_minor, payment_percentage_basis_points,
  partial_payment_authorized, payment_attention_required, payment_attention_reason,
  prior_booking_id, override_reason
)
SELECT
  id, resident_id, academic_session_id, application_id, booking_number, status,
  total_amount_minor, currency, booked_at, expires_at, cancelled_at, completed_at,
  created_at, updated_at, priced_room_id, priced_room_rate_id,
  lease_period_id, lease_kind, starts_on, ends_on, maintenance_fee_minor,
  payment_requirement_type, payment_fixed_amount_minor, payment_percentage_basis_points,
  partial_payment_authorized, payment_attention_required, payment_attention_reason,
  prior_booking_id, override_reason
FROM bookings;

DROP TABLE bookings;
ALTER TABLE bookings__new RENAME TO bookings;

-- Legacy uniqueness: one active booking per resident+session when session present.
CREATE UNIQUE INDEX idx_bookings_one_active_per_resident_session
  ON bookings(resident_id, academic_session_id)
  WHERE status IN ('pending', 'confirmed')
    AND academic_session_id IS NOT NULL;

-- Flexible uniqueness: one active booking per resident+lease_period.
CREATE UNIQUE INDEX idx_bookings_one_active_per_resident_lease_period
  ON bookings(resident_id, lease_period_id)
  WHERE status IN ('pending', 'confirmed')
    AND lease_period_id IS NOT NULL;

-- One active agreement per application (prevent accidental duplicates).
CREATE UNIQUE INDEX idx_bookings_one_active_per_application
  ON bookings(application_id)
  WHERE status IN ('pending', 'confirmed')
    AND application_id IS NOT NULL;

CREATE INDEX idx_bookings_status_session ON bookings(status, academic_session_id);
CREATE INDEX idx_bookings_priced_room ON bookings(priced_room_id);
CREATE INDEX idx_bookings_priced_room_rate ON bookings(priced_room_rate_id);
CREATE INDEX idx_bookings_lease_period ON bookings(lease_period_id);
CREATE INDEX idx_bookings_lease_kind ON bookings(lease_kind);
CREATE INDEX idx_bookings_agreement_dates ON bookings(starts_on, ends_on);
CREATE INDEX idx_bookings_prior_booking ON bookings(prior_booking_id);

-- Recreate agreement date triggers from 0015 (dropped with table rebuild).
CREATE TRIGGER trg_bookings_agreement_dates_insert
BEFORE INSERT ON bookings
FOR EACH ROW
WHEN NEW.starts_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.starts_on > NEW.ends_on
BEGIN
  SELECT RAISE(ABORT, 'bookings.starts_on must be <= ends_on');
END;

CREATE TRIGGER trg_bookings_agreement_dates_update
BEFORE UPDATE OF starts_on, ends_on ON bookings
FOR EACH ROW
WHEN NEW.starts_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.starts_on > NEW.ends_on
BEGIN
  SELECT RAISE(ABORT, 'bookings.starts_on must be <= ends_on');
END;

PRAGMA foreign_keys = ON;
