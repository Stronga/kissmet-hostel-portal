PRAGMA foreign_keys = ON;

ALTER TABLE residents ADD COLUMN middle_name TEXT;
ALTER TABLE residents ADD COLUMN phone_verified_at TEXT;

ALTER TABLE otp_codes ADD COLUMN registration_payload_json TEXT;

CREATE TABLE IF NOT EXISTS application_number_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL DEFAULT 'KSM-APP',
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  padding INTEGER NOT NULL DEFAULT 4 CHECK (padding >= 4),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO application_number_sequence (id, prefix, next_value, padding)
SELECT 1, 'KSM-APP', COALESCE((SELECT MAX(CAST(substr(application_number, 9) AS INTEGER)) + 1 FROM applications WHERE application_number GLOB 'KSM-APP-[0-9][0-9][0-9][0-9]*'), 1), 4
WHERE NOT EXISTS (SELECT 1 FROM application_number_sequence WHERE id = 1);
