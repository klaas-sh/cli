-- Initial database schema for Klaas
-- All IDs use ULID format (26 characters, uppercase alphanumeric)

-- Users table
-- Stores user accounts linked to GitHub OAuth
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    github_id TEXT NOT NULL UNIQUE,
    github_username TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for GitHub lookups
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);

-- Devices table
-- Stores CLI devices registered by users
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for user device lookups
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

-- Sessions table
-- Stores CLI sessions (each klaas invocation creates a session)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'detached' CHECK (status IN ('attached', 'detached')),
    cwd TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    attached_at TEXT,
    detached_at TEXT
);

-- Indexes for session lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
