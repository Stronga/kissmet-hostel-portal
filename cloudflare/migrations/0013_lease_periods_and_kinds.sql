PRAGMA foreign_keys = ON;

-- Stage 2L-B: commercial lease periods (Academic Calendar / Calendar Year / Short-Term).
-- academic_sessions remains the Stage 2K institutional Academic Calendar organizer.
-- Optional nullable academic_session_id on lease_periods links an academic_calendar
-- period to its institutional session without altering academic_sessions or requiring
-- fake sessions for calendar_year / short_term.

CREATE TABLE lease_periods (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('academic_calendar', 'calendar_year', 'short_term')),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed', 'archived')),
  academic_session_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id) ON DELETE RESTRICT,
  CHECK (starts_on <= ends_on),
  CHECK (
    academic_session_id IS NULL
    OR kind = 'academic_calendar'
  )
);

CREATE INDEX idx_lease_periods_kind_status ON lease_periods(kind, status);
CREATE INDEX idx_lease_periods_dates ON lease_periods(starts_on, ends_on);
CREATE INDEX idx_lease_periods_academic_session ON lease_periods(academic_session_id);

-- At most one lease_period may reference a given academic_session.
CREATE UNIQUE INDEX idx_lease_periods_one_per_academic_session
  ON lease_periods(academic_session_id)
  WHERE academic_session_id IS NOT NULL;
