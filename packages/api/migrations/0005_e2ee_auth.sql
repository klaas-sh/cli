-- E2EE Authentication Migration
-- Changes password-based auth to derived auth_key system
-- Adds salt column and pairing_requests table for CLI pairing

-- Add salt column to users table
-- Salt is used for client-side key derivation (auth_key and enc_key)
ALTER TABLE users ADD COLUMN salt TEXT;

-- Rename password_hash to auth_key_hash for clarity
-- auth_key_hash = PBKDF2(PBKDF2(password, salt) + "klaas-auth-v1")
-- Note: SQLite doesn't support RENAME COLUMN in older versions,
-- so we keep the column name but change its semantic meaning.
-- The column stores hash of auth_key, not password.

-- Create pairing_requests table for CLI ECDH pairing
CREATE TABLE IF NOT EXISTS pairing_requests (
    id TEXT PRIMARY KEY,
    pairing_code TEXT UNIQUE NOT NULL,
    device_name TEXT NOT NULL,
    cli_public_key TEXT NOT NULL,
    dash_public_key TEXT,
    encrypted_mek TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'expired')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    approved_by TEXT REFERENCES users(id)
);

-- Index for pairing code lookups
CREATE INDEX IF NOT EXISTS idx_pairing_code
    ON pairing_requests(pairing_code);

-- Index for cleanup of expired pairing requests
CREATE INDEX IF NOT EXISTS idx_pairing_status_expires
    ON pairing_requests(status, expires_at);
