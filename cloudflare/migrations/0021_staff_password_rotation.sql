PRAGMA foreign_keys = ON;

-- Staff password rotation (additive; no data rewritten).
-- must_change_password = 1 forces the account to set a new password before any other staff
-- route is usable. Set by: production bootstrap (temporary password), admin "reset password",
-- and admin-created staff accounts (initial password known to the creating admin).
-- Cleared only by a successful self-service password change.
-- password_changed_at records the last self-service change (NULL = never changed by the user).
--
-- NOTE: 0021 is RESERVED for staff password rotation (decided 2026-11-22). The refund-records
-- If another in-flight branch (e.g. the refund redesign) also adds 0021, renumber whichever
-- merges second before it is applied anywhere remote.

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

-- Persistent, shared rate-limit counters (fixed window). Replaces the isolate-local Map for the
-- staff password-change endpoint so every Worker isolate / POP shares one counter per staff user.
-- bucket_key is an opaque, PII-free key such as 'staff-password-change:user:42' (numeric user id only;
-- never a username, email, phone or IP). One row per key; the row is reused when its window expires.
-- Rows are tiny and bounded by the number of staff users; expired rows are harmless and may be pruned.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_key TEXT PRIMARY KEY CHECK (length(bucket_key) BETWEEN 1 AND 200),
  window_started_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
