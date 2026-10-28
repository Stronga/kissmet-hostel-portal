PRAGMA foreign_keys = ON;

-- Stage 2L-B: evolve bookings into the durable accommodation agreement snapshot.
-- Agreed accommodation price authority remains bookings.total_amount_minor.
-- maintenance_fee_minor is a separate non-refundable management-defined snapshot.
-- New columns are nullable (except partial_payment_authorized default) so existing
-- booking create/confirm/payment/allocation flows keep working unchanged.
-- No competing agreement table.

ALTER TABLE bookings ADD COLUMN lease_period_id INTEGER REFERENCES lease_periods(id) ON DELETE RESTRICT;
ALTER TABLE bookings ADD COLUMN lease_kind TEXT CHECK (lease_kind IS NULL OR lease_kind IN ('academic_calendar', 'calendar_year', 'short_term'));
ALTER TABLE bookings ADD COLUMN starts_on TEXT;
ALTER TABLE bookings ADD COLUMN ends_on TEXT;
ALTER TABLE bookings ADD COLUMN maintenance_fee_minor INTEGER CHECK (maintenance_fee_minor IS NULL OR maintenance_fee_minor >= 0);
ALTER TABLE bookings ADD COLUMN payment_requirement_type TEXT CHECK (payment_requirement_type IS NULL OR payment_requirement_type IN ('full', 'fixed', 'percentage'));
ALTER TABLE bookings ADD COLUMN payment_fixed_amount_minor INTEGER CHECK (payment_fixed_amount_minor IS NULL OR payment_fixed_amount_minor >= 0);
ALTER TABLE bookings ADD COLUMN payment_percentage_basis_points INTEGER CHECK (payment_percentage_basis_points IS NULL OR payment_percentage_basis_points BETWEEN 0 AND 10000);
ALTER TABLE bookings ADD COLUMN partial_payment_authorized INTEGER NOT NULL DEFAULT 0 CHECK (partial_payment_authorized IN (0, 1));
ALTER TABLE bookings ADD COLUMN prior_booking_id INTEGER REFERENCES bookings(id) ON DELETE RESTRICT;
ALTER TABLE bookings ADD COLUMN override_reason TEXT;

CREATE INDEX idx_bookings_lease_period ON bookings(lease_period_id);
CREATE INDEX idx_bookings_lease_kind ON bookings(lease_kind);
CREATE INDEX idx_bookings_agreement_dates ON bookings(starts_on, ends_on);
CREATE INDEX idx_bookings_prior_booking ON bookings(prior_booking_id);

-- SQLite cannot ADD table-level CHECK via ALTER; enforce starts_on <= ends_on with triggers.
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
