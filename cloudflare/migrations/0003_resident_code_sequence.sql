PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS resident_code_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL DEFAULT 'KSM-RES',
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  padding INTEGER NOT NULL DEFAULT 4 CHECK (padding >= 4),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO resident_code_sequence (id, prefix, next_value, padding)
SELECT
  1,
  'KSM-RES',
  COALESCE(
    (
      SELECT MAX(CAST(substr(resident_code, 9) AS INTEGER)) + 1
      FROM residents
      WHERE resident_code GLOB 'KSM-RES-[0-9][0-9][0-9][0-9]*'
    ),
    1
  ),
  4
WHERE NOT EXISTS (SELECT 1 FROM resident_code_sequence WHERE id = 1);
