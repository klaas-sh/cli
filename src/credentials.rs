//! Credential storage module for secure token management.
//!
//! This module provides cross-platform credential storage using the OS keychain:
//! - macOS: Keychain
//! - Windows: Credential Manager
//! - Linux: Secret Service (libsecret)
//!
//! When the keychain is unavailable, it falls back to file-based storage
//! in `~/.config/klaas/`.

use std::fs;
use std::path::PathBuf;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use crate::config::KEYCHAIN_SERVICE;
use crate::error::{CliError, Result};

/// Key names for stored credentials.
const ACCESS_TOKEN_KEY: &str = "access_token";
const REFRESH_TOKEN_KEY: &str = "refresh_token";
const DEVICE_ID_KEY: &str = "device_id";
const SESSION_ID_KEY: &str = "session_id";
const MEK_KEY: &str = "encryption_key";

/// Fallback credentials file name.
const FALLBACK_CREDENTIALS_FILE: &str = "credentials.json";

/// Key size in bytes for MEK (256-bit key).
const MEK_SIZE: usize = 32;

/// Fallback credentials structure for file-based storage.
#[derive(Debug, Serialize, Deserialize, Default)]
struct FallbackCredentials {
    access_token: Option<String>,
    refresh_token: Option<String>,
    device_id: Option<String>,
    session_id: Option<String>,
    /// Master Encryption Key stored as hex string for E2EE.
    mek: Option<String>,
}

/// Credential storage manager.
///
/// Handles secure storage and retrieval of authentication tokens and device ID.
/// Attempts to use the OS keychain first, falling back to file-based storage
/// if the keychain is unavailable.
#[derive(Debug)]
pub struct CredentialStore {
    /// Whether to use keychain (true) or file-based fallback (false).
    use_keychain: bool,
    /// Path to fallback credentials file.
    fallback_path: PathBuf,
}

impl Default for CredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

impl CredentialStore {
    /// Creates a new credential store.
    ///
    /// Automatically detects whether the keychain is available and sets up
    /// the fallback path if needed.
    pub fn new() -> Self {
        let fallback_path = get_fallback_path();
        let use_keychain = check_keychain_available();

        if !use_keychain {
            warn!(
                "Keychain unavailable, using file-based storage at {:?}",
                fallback_path
            );
        } else {
            debug!("Using OS keychain for credential storage");
        }

        Self {
            use_keychain,
            fallback_path,
        }
    }

    /// Stores access and refresh tokens.
    ///
    /// # Arguments
    ///
    /// * `access_token` - JWT access token for API authentication
    /// * `refresh_token` - Refresh token for obtaining new access tokens
    ///
    /// # Errors
    ///
    /// Returns `CliError::KeychainError` if storage fails.
    pub fn store_tokens(&self, access_token: &str, refresh_token: &str) -> Result<()> {
        if self.use_keychain {
            self.store_keychain_value(ACCESS_TOKEN_KEY, access_token)?;
            self.store_keychain_value(REFRESH_TOKEN_KEY, refresh_token)?;
        } else {
            self.update_fallback(|creds| {
                creds.access_token = Some(access_token.to_string());
                creds.refresh_token = Some(refresh_token.to_string());
            })?;
        }

        debug!("Stored access and refresh tokens");
        Ok(())
    }

    /// Retrieves stored access and refresh tokens.
    ///
    /// # Returns
    ///
    /// - `Ok(Some((access_token, refresh_token)))` if both tokens are stored
    /// - `Ok(None)` if tokens are not stored
    /// - `Err(...)` if retrieval fails
    pub fn get_tokens(&self) -> Result<Option<(String, String)>> {
        if self.use_keychain {
            let access = self.get_keychain_value(ACCESS_TOKEN_KEY)?;
            let refresh = self.get_keychain_value(REFRESH_TOKEN_KEY)?;

            match (access, refresh) {
                (Some(a), Some(r)) => {
                    debug!("Retrieved tokens from keychain");
                    Ok(Some((a, r)))
                }
                _ => Ok(None),
            }
        } else {
            let creds = self.read_fallback()?;
            match (creds.access_token, creds.refresh_token) {
                (Some(a), Some(r)) => {
                    debug!("Retrieved tokens from fallback storage");
                    Ok(Some((a, r)))
                }
                _ => Ok(None),
            }
        }
    }

    /// Clears stored tokens.
    ///
    /// Removes both access and refresh tokens from storage.
    /// Does not affect the device ID.
    ///
    /// # Errors
    ///
    /// Returns `CliError::KeychainError` if deletion fails.
    pub fn clear_tokens(&self) -> Result<()> {
        if self.use_keychain {
            // Ignore errors for non-existent entries
            let _ = self.delete_keychain_value(ACCESS_TOKEN_KEY);
            let _ = self.delete_keychain_value(REFRESH_TOKEN_KEY);
        } else {
            self.update_fallback(|creds| {
                creds.access_token = None;
                creds.refresh_token = None;
            })?;
        }

        debug!("Cleared stored tokens");
        Ok(())
    }

    /// Stores the device ID.
    ///
    /// The device ID is a ULID that uniquely identifies this CLI installation.
    /// It is generated once and reused for all sessions.
    ///
    /// # Arguments
    ///
    /// * `device_id` - ULID string identifying this device
    ///
    /// # Errors
    ///
    /// Returns `CliError::KeychainError` if storage fails.
    pub fn store_device_id(&self, device_id: &str) -> Result<()> {
        if self.use_keychain {
            self.store_keychain_value(DEVICE_ID_KEY, device_id)?;
        } else {
            self.update_fallback(|creds| {
                creds.device_id = Some(device_id.to_string());
            })?;
        }

        debug!("Stored device ID");
        Ok(())
    }

    /// Retrieves the stored device ID.
    ///
    /// # Returns
    ///
    /// - `Ok(Some(device_id))` if a device ID is stored
    /// - `Ok(None)` if no device ID is stored
    /// - `Err(...)` if retrieval fails
    pub fn get_device_id(&self) -> Result<Option<String>> {
        if self.use_keychain {
            let device_id = self.get_keychain_value(DEVICE_ID_KEY)?;
            if device_id.is_some() {
                debug!("Retrieved device ID from keychain");
            }
            Ok(device_id)
        } else {
            let creds = self.read_fallback()?;
            if creds.device_id.is_some() {
                debug!("Retrieved device ID from fallback storage");
            }
            Ok(creds.device_id)
        }
    }

    /// Stores the current session ID.
    ///
    /// The session ID is persisted so the CLI can reconnect to the same session
    /// across restarts. This allows the web dashboard to show the same session.
    ///
    /// # Arguments
    ///
    /// * `session_id` - ULID string identifying the session
    ///
    /// # Errors
    ///
    /// Returns `CliError::KeychainError` if storage fails.
    pub fn store_session_id(&self, session_id: &str) -> Result<()> {
        if self.use_keychain {
            self.store_keychain_value(SESSION_ID_KEY, session_id)?;
        } else {
            self.update_fallback(|creds| {
                creds.session_id = Some(session_id.to_string());
            })?;
        }

        debug!("Stored session ID");
        Ok(())
    }

    /// Retrieves the stored session ID.
    ///
    /// # Returns
    ///
    /// - `Ok(Some(session_id))` if a session ID is stored
    /// - `Ok(None)` if no session ID is stored
    /// - `Err(...)` if retrieval fails
    pub fn get_session_id(&self) -> Result<Option<String>> {
        if self.use_keychain {
            let session_id = self.get_keychain_value(SESSION_ID_KEY)?;
            if session_id.is_some() {
                debug!("Retrieved session ID from keychain");
            }
            Ok(session_id)
        } else {
            let creds = self.read_fallback()?;
            if creds.session_id.is_some() {
                debug!("Retrieved session ID from fallback storage");
            }
            Ok(creds.session_id)
        }
    }

    /// Clears the stored session ID.
    ///
    /// Use this when starting a new session explicitly.
    ///
    /// # Errors
    ///
    /// Returns `CliError::KeychainError` if deletion fails.
    pub fn clear_session_id(&self) -> Result<()> {
        if self.use_keychain {
            let _ = self.delete_keychain_value(SESSION_ID_KEY);
        } else {
            self.update_fallback(|creds| {
                creds.session_id = None;
            })?;
        }

        debug!("Cleared session ID");
        Ok(())
    }

    /// Stores the Master Encryption Key (MEK) for E2EE.
    ///
    /// The MEK is a 32-byte key used to derive session-specific encryption
    /// keys. It is auto-generated on first use and stored securely.
    ///
    /// # Arguments
    ///
    /// * `mek` - 32-byte Master Encryption Key
    ///
    /// # Errors
    ///
    /// Returns `CliError::KeychainError` if storage fails.
    pub fn store_mek(&self, mek: &[u8]) -> Result<()> {
        if mek.len() != MEK_SIZE {
            return Err(CliError::KeychainError(format!(
                "Invalid MEK size: expected {}, got {}",
                MEK_SIZE,
                mek.len()
            )));
        }

        // Store as hex string for both keychain and fallback
        let hex_mek = hex::encode(mek);

        if self.use_keychain {
            self.store_keychain_value(MEK_KEY, &hex_mek)?;
        } else {
            self.update_fallback(|creds| {
                creds.mek = Some(hex_mek.clone());
            })?;
        }

        debug!("Stored MEK for E2EE");
        Ok(())
    }

    /// Retrieves the stored Master Encryption Key (MEK).
    ///
    /// # Returns
    ///
    /// - `Ok(Some(mek))` if MEK is stored (32-byte Vec)
    /// - `Ok(None)` if no MEK is stored
    /// - `Err(...)` if retrieval fails or MEK is invalid
    pub fn get_mek(&self) -> Result<Option<Vec<u8>>> {
        let hex_mek = if self.use_keychain {
            self.get_keychain_value(MEK_KEY)?
        } else {
            self.read_fallback()?.mek
        };

        match hex_mek {
            Some(hex) => {
                let mek = hex::decode(&hex)
                    .map_err(|e| CliError::KeychainError(format!("Invalid MEK encoding: {}", e)))?;

                if mek.len() != MEK_SIZE {
                    return Err(CliError::KeychainError(format!(
                        "Stored MEK has wrong size: expected {}, got {}",
                        MEK_SIZE,
                        mek.len()
                    )));
                }

                debug!("Retrieved MEK from storage");
                Ok(Some(mek))
            }
            None => Ok(None),
        }
    }

    /// Clears the stored MEK.
    ///
    /// This disables E2EE until a new MEK is generated. Use with caution as
    /// this will make previous encrypted sessions unrecoverable.
    ///
    /// # Errors
    ///
    /// Returns `CliError::KeychainError` if deletion fails.
    pub fn clear_mek(&self) -> Result<()> {
        if self.use_keychain {
            let _ = self.delete_keychain_value(MEK_KEY);
        } else {
            self.update_fallback(|creds| {
                creds.mek = None;
            })?;
        }

        debug!("Cleared MEK");
        Ok(())
    }

    /// Stores a value in the keychain.
    fn store_keychain_value(&self, key: &str, value: &str) -> Result<()> {
        let entry = Entry::new(KEYCHAIN_SERVICE, key)
            .map_err(|e| CliError::KeychainError(e.to_string()))?;

        entry
            .set_password(value)
            .map_err(|e| CliError::KeychainError(e.to_string()))?;

        Ok(())
    }

    /// Retrieves a value from the keychain.
    fn get_keychain_value(&self, key: &str) -> Result<Option<String>> {
        let entry = Entry::new(KEYCHAIN_SERVICE, key)
            .map_err(|e| CliError::KeychainError(e.to_string()))?;

        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(CliError::KeychainError(e.to_string())),
        }
    }

    /// Deletes a value from the keychain.
    fn delete_keychain_value(&self, key: &str) -> Result<()> {
        let entry = Entry::new(KEYCHAIN_SERVICE, key)
            .map_err(|e| CliError::KeychainError(e.to_string()))?;

        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // Already deleted
            Err(e) => Err(CliError::KeychainError(e.to_string())),
        }
    }

    /// Reads fallback credentials from file.
    fn read_fallback(&self) -> Result<FallbackCredentials> {
        if !self.fallback_path.exists() {
            return Ok(FallbackCredentials::default());
        }

        let content = fs::read_to_string(&self.fallback_path).map_err(|e| {
            CliError::KeychainError(format!("Failed to read fallback credentials: {}", e))
        })?;

        serde_json::from_str(&content).map_err(|e| {
            CliError::KeychainError(format!("Failed to parse fallback credentials: {}", e))
        })
    }

    /// Updates fallback credentials using a closure.
    fn update_fallback<F>(&self, update: F) -> Result<()>
    where
        F: FnOnce(&mut FallbackCredentials),
    {
        // Ensure parent directory exists
        if let Some(parent) = self.fallback_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                CliError::KeychainError(format!("Failed to create config directory: {}", e))
            })?;
        }

        // Read existing credentials
        let mut creds = self.read_fallback()?;

        // Apply update
        update(&mut creds);

        // Write back
        let content = serde_json::to_string_pretty(&creds).map_err(|e| {
            CliError::KeychainError(format!("Failed to serialize credentials: {}", e))
        })?;

        fs::write(&self.fallback_path, content).map_err(|e| {
            CliError::KeychainError(format!("Failed to write fallback credentials: {}", e))
        })?;

        // Set restrictive permissions on Unix systems
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::Permissions::from_mode(0o600);
            fs::set_permissions(&self.fallback_path, perms).map_err(|e| {
                CliError::KeychainError(format!(
                    "Failed to set credentials file permissions: {}",
                    e
                ))
            })?;
        }

        Ok(())
    }
}

/// Gets the fallback credentials file path.
///
/// Uses `~/.config/klaas/credentials.json` on Unix systems and the appropriate
/// config directory on other platforms.
fn get_fallback_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("klaas")
        .join(FALLBACK_CREDENTIALS_FILE)
}

/// Checks whether the keychain is available.
///
/// Attempts to create and delete a test entry to verify keychain access.
fn check_keychain_available() -> bool {
    let test_key = "__klaas_keychain_test__";

    // Try to create an entry
    let entry = match Entry::new(KEYCHAIN_SERVICE, test_key) {
        Ok(e) => e,
        Err(_) => return false,
    };

    // Try to set and then delete a test value
    if entry.set_password("test").is_err() {
        return false;
    }

    // Clean up test entry
    let _ = entry.delete_credential();

    true
}

/// Convenience function to store tokens.
///
/// Creates a temporary `CredentialStore` and stores the tokens.
pub fn store_tokens(access_token: &str, refresh_token: &str) -> Result<()> {
    CredentialStore::new().store_tokens(access_token, refresh_token)
}

/// Convenience function to get tokens.
///
/// Creates a temporary `CredentialStore` and retrieves the tokens.
pub fn get_tokens() -> Result<Option<(String, String)>> {
    CredentialStore::new().get_tokens()
}

/// Convenience function to clear tokens.
///
/// Creates a temporary `CredentialStore` and clears the tokens.
pub fn clear_tokens() -> Result<()> {
    CredentialStore::new().clear_tokens()
}

/// Convenience function to store device ID.
///
/// Creates a temporary `CredentialStore` and stores the device ID.
pub fn store_device_id(device_id: &str) -> Result<()> {
    CredentialStore::new().store_device_id(device_id)
}

/// Convenience function to get device ID.
///
/// Creates a temporary `CredentialStore` and retrieves the device ID.
pub fn get_device_id() -> Result<Option<String>> {
    CredentialStore::new().get_device_id()
}

/// Convenience function to store session ID.
///
/// Creates a temporary `CredentialStore` and stores the session ID.
pub fn store_session_id(session_id: &str) -> Result<()> {
    CredentialStore::new().store_session_id(session_id)
}

/// Convenience function to get session ID.
///
/// Creates a temporary `CredentialStore` and retrieves the session ID.
pub fn get_session_id() -> Result<Option<String>> {
    CredentialStore::new().get_session_id()
}

/// Convenience function to clear session ID.
///
/// Creates a temporary `CredentialStore` and clears the session ID.
pub fn clear_session_id() -> Result<()> {
    CredentialStore::new().clear_session_id()
}

/// Convenience function to store MEK.
///
/// Creates a temporary `CredentialStore` and stores the MEK.
pub fn store_mek(mek: &[u8]) -> Result<()> {
    CredentialStore::new().store_mek(mek)
}

/// Convenience function to get MEK.
///
/// Creates a temporary `CredentialStore` and retrieves the MEK.
pub fn get_mek() -> Result<Option<Vec<u8>>> {
    CredentialStore::new().get_mek()
}

/// Convenience function to clear MEK.
///
/// Creates a temporary `CredentialStore` and clears the MEK.
pub fn clear_mek() -> Result<()> {
    CredentialStore::new().clear_mek()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tests the fallback credentials serialization.
    #[test]
    fn test_fallback_credentials_default() {
        let creds = FallbackCredentials::default();
        assert!(creds.access_token.is_none());
        assert!(creds.refresh_token.is_none());
        assert!(creds.device_id.is_none());
        assert!(creds.session_id.is_none());
        assert!(creds.mek.is_none());
    }

    /// Tests fallback credentials serialization round-trip.
    #[test]
    fn test_fallback_credentials_serialization() {
        let creds = FallbackCredentials {
            access_token: Some("test_access".to_string()),
            refresh_token: Some("test_refresh".to_string()),
            device_id: Some("01HQXK7V8G3N5M2R4P6T1W9Y0Z".to_string()),
            session_id: Some("01HQXK8V8G3N5M2R4P6T1W9Y0Z".to_string()),
            mek: Some("0123456789abcdef".repeat(4)),
        };

        let json = serde_json::to_string(&creds).unwrap();
        let parsed: FallbackCredentials = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.access_token, creds.access_token);
        assert_eq!(parsed.refresh_token, creds.refresh_token);
        assert_eq!(parsed.device_id, creds.device_id);
        assert_eq!(parsed.session_id, creds.session_id);
        assert_eq!(parsed.mek, creds.mek);
    }

    /// Tests MEK hex encoding/decoding.
    #[test]
    fn test_mek_hex_encoding() {
        // 32 bytes = 64 hex chars
        let mek_bytes = [0xab; 32];
        let hex = hex::encode(&mek_bytes);
        assert_eq!(hex.len(), 64);

        let decoded = hex::decode(&hex).unwrap();
        assert_eq!(decoded.len(), 32);
        assert_eq!(decoded, mek_bytes.to_vec());
    }

    /// Tests MEK size validation.
    #[test]
    fn test_mek_size_validation() {
        // Valid 32-byte MEK should work
        let valid_mek = [0u8; 32];
        let hex = hex::encode(&valid_mek);
        let decoded = hex::decode(&hex).unwrap();
        assert_eq!(decoded.len(), MEK_SIZE);

        // Invalid sizes should fail validation
        let too_short = [0u8; 16];
        assert_ne!(too_short.len(), MEK_SIZE);

        let too_long = [0u8; 64];
        assert_ne!(too_long.len(), MEK_SIZE);
    }

    /// Tests that get_fallback_path returns a valid path.
    #[test]
    fn test_get_fallback_path() {
        let path = get_fallback_path();
        assert!(path.ends_with("klaas/credentials.json"));
    }
}
