ALTER TABLE announcements
  ADD COLUMN severity TEXT NOT NULL DEFAULT 'normal'
  CHECK (severity IN ('normal', 'important', 'high_alert'));

ALTER TABLE announcements
  ADD COLUMN starts_at TEXT;

ALTER TABLE announcements
  ADD COLUMN created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS announcement_channels (
  id INTEGER PRIMARY KEY,
  announcement_id INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('resident_portal', 'staff_portal', 'public_website', 'sms', 'email')),
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  UNIQUE (announcement_id, channel)
);

CREATE TABLE IF NOT EXISTS announcement_delivery_attempts (
  id INTEGER PRIMARY KEY,
  announcement_id INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('resident', 'staff')),
  recipient_user_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_message_id TEXT,
  provider_status TEXT,
  failure_reason TEXT,
  idempotency_key TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (announcement_id, channel, recipient_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_announcements_status_severity ON announcements(status, severity);
CREATE INDEX IF NOT EXISTS idx_announcements_current ON announcements(status, starts_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_announcement_channels_lookup ON announcement_channels(announcement_id, channel, status);
CREATE INDEX IF NOT EXISTS idx_announcement_delivery_announcement ON announcement_delivery_attempts(announcement_id, channel, status);
