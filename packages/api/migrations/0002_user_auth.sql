-- User authentication tables for Nexo
-- All IDs use ULID format (26 characters, uppercase alphanumeric)

-- User passwords for local auth (alternative to GitHub OAuth)
CREATE TABLE IF NOT EXISTS user_passwords (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- MFA tokens for two-factor authentication
CREATE TABLE IF NOT EXISTS user_mfa (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    secret TEXT NOT NULL,
    backup_codes TEXT,
    enabled_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add additional columns to sessions table for dashboard functionality
-- device_name: Human-readable name for the session (e.g., "MacBook Pro")
ALTER TABLE sessions ADD COLUMN device_name TEXT;

-- device_type: Type of device (e.g., "laptop", "desktop", "server")
ALTER TABLE sessions ADD COLUMN device_type TEXT;

-- last_activity_at: Timestamp of last activity for timeout handling
ALTER TABLE sessions ADD COLUMN last_activity_at TEXT;

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_passwords_user_id ON user_passwords(user_id);
CREATE INDEX IF NOT EXISTS idx_user_mfa_user_id ON user_mfa(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity_at ON sessions(last_activity_at);
