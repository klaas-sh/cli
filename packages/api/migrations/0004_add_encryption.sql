-- Add encrypted MEK storage to users table for E2EE
-- The encrypted_mek field stores a JSON blob with the encrypted master key
-- Server cannot decrypt this data - only the user's password can unlock it

-- Add encrypted_mek column to users table (nullable for users without E2EE)
ALTER TABLE users ADD COLUMN encrypted_mek TEXT;

-- Index for encryption key lookup
CREATE INDEX IF NOT EXISTS idx_users_has_encryption
  ON users(id) WHERE encrypted_mek IS NOT NULL;
