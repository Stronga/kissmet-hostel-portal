PRAGMA foreign_keys = ON;

-- Internet Access Phase 0: resident-linked HotSpot identities (enforcement on MikroTik).
-- Does not alter hostel application/booking/payment/allocation flows.

CREATE TABLE IF NOT EXISTS resident_internet_accounts (
  id INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL UNIQUE,
  router_username TEXT NOT NULL UNIQUE,
  router_profile TEXT NOT NULL DEFAULT 'Kissmet-Residents',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed')),
  last_synced_at TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by_staff_id INTEGER,
  updated_by_staff_id INTEGER,
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_resident_internet_accounts_status
  ON resident_internet_accounts(status, sync_status);

CREATE INDEX IF NOT EXISTS idx_resident_internet_accounts_username
  ON resident_internet_accounts(router_username);
