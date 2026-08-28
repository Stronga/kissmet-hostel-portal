PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS maintenance_request_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL DEFAULT 'KSM-MNT',
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  padding INTEGER NOT NULL DEFAULT 4 CHECK (padding >= 4),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO maintenance_request_sequence (id, prefix, next_value, padding)
SELECT 1, 'KSM-MNT', COALESCE((SELECT MAX(CAST(substr(request_number, 9) AS INTEGER)) + 1 FROM maintenance_requests WHERE request_number GLOB 'KSM-MNT-[0-9][0-9][0-9][0-9]*'), 1), 4
WHERE NOT EXISTS (SELECT 1 FROM maintenance_request_sequence WHERE id = 1);

ALTER TABLE maintenance_requests ADD COLUMN assigned_at TEXT;
ALTER TABLE maintenance_requests ADD COLUMN started_at TEXT;
