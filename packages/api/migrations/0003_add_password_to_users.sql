-- Add password_hash column directly to users table
-- This allows local auth to work alongside GitHub OAuth
-- The user_passwords table from 0002 can be removed in a future migration

-- Add password_hash column to users table (nullable for GitHub-only users)
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- Index for faster lookups when authenticating
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
