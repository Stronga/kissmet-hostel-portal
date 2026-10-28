PRAGMA foreign_keys = ON;

-- Stage 2L-F: resident_kind (student | non_student) and application lease flexibility.
-- Migrations 0001–0015 remain immutable. Production resident count is 0; backfill is
-- structural only for local/test fixtures.

-- ---------------------------------------------------------------------------
-- 1. residents.resident_kind
-- ---------------------------------------------------------------------------
-- Default 'student' preserves existing student-centric fixtures and registration.
ALTER TABLE residents ADD COLUMN resident_kind TEXT NOT NULL DEFAULT 'student'
  CHECK (resident_kind IN ('student', 'non_student'));

-- Any resident already without institution/student pair is classified non_student.
UPDATE residents
SET resident_kind = 'non_student'
WHERE institution_id IS NULL
  AND student_id IS NULL;

CREATE INDEX idx_residents_kind_status ON residents(resident_kind, status);

-- ---------------------------------------------------------------------------
-- 2. applications: nullable academic_session_id + lease_period_id / lease_kind
-- ---------------------------------------------------------------------------
-- SQLite cannot ALTER a NOT NULL column to nullable; rebuild applications.
-- Foreign keys from documents/bookings reference applications by name and remain
-- valid after RENAME when foreign_keys are briefly disabled during rebuild.

PRAGMA foreign_keys = OFF;

CREATE TABLE applications__new (
  id INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL,
  academic_session_id INTEGER,
  lease_period_id INTEGER,
  lease_kind TEXT CHECK (lease_kind IS NULL OR lease_kind IN ('academic_calendar', 'calendar_year', 'short_term')),
  application_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled', 'archived')),
  submitted_at TEXT,
  reviewed_by_staff_id INTEGER,
  reviewed_at TEXT,
  decision_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT,
  FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (lease_period_id) REFERENCES lease_periods(id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL,
  -- Meaningful period required: session and/or lease period.
  CHECK (academic_session_id IS NOT NULL OR lease_period_id IS NOT NULL),
  -- CY/ST must not invent/attach an academic session.
  CHECK (
    lease_kind IS NULL
    OR lease_kind = 'academic_calendar'
    OR academic_session_id IS NULL
  )
);

INSERT INTO applications__new (
  id, resident_id, academic_session_id, lease_period_id, lease_kind,
  application_number, status, submitted_at, reviewed_by_staff_id, reviewed_at,
  decision_notes, created_at, updated_at
)
SELECT
  id, resident_id, academic_session_id, NULL, NULL,
  application_number, status, submitted_at, reviewed_by_staff_id, reviewed_at,
  decision_notes, created_at, updated_at
FROM applications;

DROP TABLE applications;
ALTER TABLE applications__new RENAME TO applications;

-- Legacy uniqueness: one active app per resident+session when no lease_period yet.
CREATE UNIQUE INDEX idx_applications_one_active_per_resident_session
  ON applications(resident_id, academic_session_id)
  WHERE status IN ('draft', 'submitted', 'under_review', 'approved')
    AND lease_period_id IS NULL
    AND academic_session_id IS NOT NULL;

-- Flexible uniqueness: one active app per resident+lease_period.
CREATE UNIQUE INDEX idx_applications_one_active_per_resident_lease_period
  ON applications(resident_id, lease_period_id)
  WHERE status IN ('draft', 'submitted', 'under_review', 'approved')
    AND lease_period_id IS NOT NULL;

CREATE INDEX idx_applications_status_session ON applications(status, academic_session_id);
CREATE INDEX idx_applications_lease_period ON applications(lease_period_id);
CREATE INDEX idx_applications_lease_kind ON applications(lease_kind);
CREATE INDEX idx_applications_resident_status ON applications(resident_id, status);

PRAGMA foreign_keys = ON;
