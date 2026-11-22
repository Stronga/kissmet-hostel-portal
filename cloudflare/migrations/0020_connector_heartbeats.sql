PRAGMA foreign_keys = ON;

-- Pi connector heartbeat (last-seen only). Additive; no existing table is touched.
-- One row per allowlisted connector UUID, upserted on every accepted heartbeat, so the table
-- never grows with time (no history). last_heartbeat_ts is the sender's signed unix timestamp
-- (seconds) and must strictly increase: together with the HMAC signature and the Worker's
-- +/- skew window this rejects replays without a separate nonce table.

CREATE TABLE IF NOT EXISTS connector_heartbeats (
  connector_id TEXT PRIMARY KEY
    CHECK (length(connector_id) = 36 AND connector_id = lower(connector_id)),
  last_heartbeat_ts INTEGER NOT NULL CHECK (last_heartbeat_ts > 0),
  last_nonce TEXT NOT NULL CHECK (length(last_nonce) BETWEEN 16 AND 64),
  last_seen_at TEXT NOT NULL,
  agent_version TEXT CHECK (agent_version IS NULL OR length(agent_version) <= 32),
  hostname TEXT CHECK (hostname IS NULL OR length(hostname) <= 64),
  connector_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (connector_status IN ('ok', 'degraded', 'down', 'unknown')),
  routeros_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (routeros_status IN ('ok', 'unavailable', 'unknown')),
  uptime_seconds INTEGER CHECK (uptime_seconds IS NULL OR uptime_seconds >= 0),
  source_ip TEXT CHECK (source_ip IS NULL OR length(source_ip) <= 64),
  heartbeat_count INTEGER NOT NULL DEFAULT 1 CHECK (heartbeat_count >= 1),
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
