PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  organization_name TEXT NOT NULL DEFAULT 'Kissmet Hostel',
  admin_portal_title TEXT NOT NULL DEFAULT 'Kissmet Admin Portal',
  resident_portal_title TEXT NOT NULL DEFAULT 'Kissmet Resident Portal',
  support_email TEXT,
  support_phone TEXT,
  address_text TEXT,
  default_currency TEXT NOT NULL DEFAULT 'GHS' CHECK (default_currency = upper(default_currency) AND length(default_currency) = 3),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO system_settings (id, organization_name, admin_portal_title, resident_portal_title, default_currency)
SELECT 1, 'Kissmet Hostel', 'Kissmet Admin Portal', 'Kissmet Resident Portal', 'GHS'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE id = 1);
