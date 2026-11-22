PRAGMA foreign_keys = ON;

-- Staff password rotation (additive; no data rewritten).
-- must_change_password = 1 forces the account to set a new password before any other staff
-- route is usable. Set by: production bootstrap (temporary password), admin "reset password",
-- and admin-created staff accounts (initial password known to the creating admin).
-- Cleared only by a successful self-service password change.
-- password_changed_at records the last self-service change (NULL = never changed by the user).
--
-- NOTE: numbered 0021 because it is the next free number on main at the time of writing.
-- If another in-flight branch (e.g. the refund redesign) also adds 0021, renumber whichever
-- merges second before it is applied anywhere remote.

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
