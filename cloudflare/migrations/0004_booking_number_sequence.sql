PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS booking_number_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL DEFAULT 'KSM-BKG',
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  padding INTEGER NOT NULL DEFAULT 4 CHECK (padding >= 4),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO booking_number_sequence (id, prefix, next_value, padding)
SELECT
  1,
  'KSM-BKG',
  COALESCE(
    (
      SELECT MAX(CAST(substr(booking_number, 9) AS INTEGER)) + 1
      FROM bookings
      WHERE booking_number GLOB 'KSM-BKG-[0-9][0-9][0-9][0-9]*'
    ),
    1
  ),
  4
WHERE NOT EXISTS (SELECT 1 FROM booking_number_sequence WHERE id = 1);
