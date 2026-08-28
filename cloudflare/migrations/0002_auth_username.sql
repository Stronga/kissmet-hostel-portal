ALTER TABLE users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX idx_users_username_unique ON users(username);
