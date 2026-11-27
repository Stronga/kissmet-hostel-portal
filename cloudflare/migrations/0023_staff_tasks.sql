PRAGMA foreign_keys = ON;

-- Phase 2 / D7: persistent operational staff tasks.
-- Separate from audit_logs. A task is work still open in the hostel, not a security audit row.
-- Reading a task is per staff member and never changes whether the task is resolved.

CREATE TABLE IF NOT EXISTS staff_tasks (
  id INTEGER PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN (
    'application', 'enquiry', 'booking', 'allocation',
    'payment', 'receipt', 'refund', 'maintenance', 'internet'
  )),
  kind TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'unavailable')),
  href TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  unavailable_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_tasks_status_updated ON staff_tasks(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_tasks_category_status ON staff_tasks(category, status);
CREATE INDEX IF NOT EXISTS idx_staff_tasks_subject ON staff_tasks(subject_type, subject_id);

CREATE TABLE IF NOT EXISTS staff_task_reads (
  staff_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (staff_id, task_id),
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES staff_tasks(id) ON DELETE CASCADE
);
