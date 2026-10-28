PRAGMA foreign_keys = ON;

-- Stage 2L-H: agreement-aware, session-optional bed allocations.
-- Migrations 0001–0018 remain immutable.
-- Makes allocations.academic_session_id nullable so Calendar Year / Short-Term
-- agreements can receive bed assignments without inventing fake academic sessions.
-- Academic Calendar may still carry session context mirrored from the booking.
-- Physical freeness is enforced in service logic via inclusive date-overlap checks;
-- DB unique indexes remain defense-in-depth for simultaneously-active rows only.

PRAGMA foreign_keys = OFF;

CREATE TABLE allocations__new (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL,
  resident_id INTEGER NOT NULL,
  academic_session_id INTEGER,
  bed_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled', 'transferred', 'archived')),
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  assigned_by_staff_id INTEGER,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  released_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT,
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT,
  FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (bed_id) REFERENCES beds(id) ON DELETE RESTRICT,
  FOREIGN KEY (assigned_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL,
  CHECK (ends_on IS NULL OR starts_on <= ends_on)
);

INSERT INTO allocations__new (
  id, booking_id, resident_id, academic_session_id, bed_id, status,
  starts_on, ends_on, assigned_by_staff_id, assigned_at, released_at,
  notes, created_at, updated_at
)
SELECT
  id, booking_id, resident_id, academic_session_id, bed_id, status,
  starts_on, ends_on, assigned_by_staff_id, assigned_at, released_at,
  notes, created_at, updated_at
FROM allocations;

DROP TABLE allocations;
ALTER TABLE allocations__new RENAME TO allocations;

-- Defense-in-depth: at most one simultaneously-active allocation per bed.
CREATE UNIQUE INDEX idx_allocations_one_active_bed
  ON allocations(bed_id)
  WHERE status = 'active';

-- Defense-in-depth: at most one simultaneously-active allocation per resident
-- (replaces session-scoped uniqueness; date-overlap is authoritative for occupancy).
CREATE UNIQUE INDEX idx_allocations_one_active_resident
  ON allocations(resident_id)
  WHERE status = 'active';

CREATE INDEX idx_allocations_session_status ON allocations(academic_session_id, status);
CREATE INDEX idx_allocations_booking_status ON allocations(booking_id, status);
CREATE INDEX idx_allocations_bed_dates ON allocations(bed_id, starts_on, ends_on);
CREATE INDEX idx_allocations_resident_dates ON allocations(resident_id, starts_on, ends_on);

PRAGMA foreign_keys = ON;
