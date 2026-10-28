PRAGMA foreign_keys = ON;

-- Stage 2L-B: management DEFAULT/list pricing by lease period + occupancy capacity.
-- Editing rate_cards must never alter historical bookings.total_amount_minor.
-- room_rates remains intact for compatibility until later stages switch flows.
-- Short-term package length (e.g. 3 months) lives here as optional package_months
-- rather than on lease_periods; the period itself still carries concrete start/end dates.
-- Amount examples (NOT seeded): Academic 1/2/4 → 900000/600000/450000; ST → 350000.

CREATE TABLE rate_cards (
  id INTEGER PRIMARY KEY,
  lease_period_id INTEGER NOT NULL,
  occupancy_capacity INTEGER NOT NULL CHECK (occupancy_capacity IN (1, 2, 4)),
  rate_code TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = upper(currency) AND length(currency) = 3),
  package_months INTEGER CHECK (package_months IS NULL OR package_months > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  effective_from TEXT,
  effective_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  FOREIGN KEY (lease_period_id) REFERENCES lease_periods(id) ON DELETE RESTRICT,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_from <= effective_to)
);

CREATE UNIQUE INDEX idx_rate_cards_one_active_per_period_occupancy
  ON rate_cards(lease_period_id, occupancy_capacity)
  WHERE status = 'active';

CREATE INDEX idx_rate_cards_period_status ON rate_cards(lease_period_id, status);
CREATE INDEX idx_rate_cards_occupancy_status ON rate_cards(occupancy_capacity, status);
