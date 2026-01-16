//! Cryptographic utilities for end-to-end encryption.
//!
//! This module implements the E2EE scheme described in the implementation
//! guide:
//! - Argon2id for password → KEK derivation
//! - AES-256-GCM for MEK and content encryption
//! - HKDF-SHA256 for MEK → session key derivation
//!
//! All keys are 256 bits (32 bytes).

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use p256::{
    ecdh::EphemeralSecret,
    elliptic_curve::sec1::{FromEncodedPoint, ToEncodedPoint},
    EncodedPoint, PublicKey,
};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::CliError;

// =============================================================================
// Constants
// =============================================================================

/// Argon2id memory parameter (64 MB).
const ARGON2_MEMORY_KB: u32 = 65536;

/// Argon2id iterations.
const ARGON2_ITERATIONS: u32 = 3;

/// Argon2id parallelism.
const ARGON2_PARALLELISM: u32 = 4;

/// Key size in bytes (256 bits).
const KEY_SIZE: usize = 32;

/// Nonce size in bytes for AES-GCM (96 bits).
const NONCE_SIZE: usize = 12;

/// Salt size in bytes for Argon2id (128 bits).
const SALT_SIZE: usize = 16;

/// Auth tag size in bytes for AES-GCM (128 bits).
const TAG_SIZE: usize = 16;

/// Version prefix for session key derivation info.
const SESSION_KEY_INFO_PREFIX: &str = "klaas-session-v1:";

/// Domain separation for ECDH pairing key derivation.
const PAIRING_KEY_INFO: &str = "klaas-pairing-v1";

// =============================================================================
// Types
// =============================================================================

/// A 256-bit cryptographic key that is securely zeroed when dropped.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SecretKey([u8; KEY_SIZE]);

impl SecretKey {
    /// Creates a new random key.
    pub fn random() -> Self {
        let mut bytes = [0u8; KEY_SIZE];
        rand::Rng::fill(&mut rand::thread_rng(), &mut bytes);
        Self(bytes)
    }

    /// Creates a key from existing bytes.
    pub fn from_bytes(bytes: [u8; KEY_SIZE]) -> Self {
        Self(bytes)
    }

    /// Returns a reference to the raw bytes.
    pub fn as_bytes(&self) -> &[u8; KEY_SIZE] {
        &self.0
    }
}

impl AsRef<[u8]> for SecretKey {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

/// Encrypted content format for session data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedContent {
    /// Format version (always 1).
    pub v: u8,
    /// 12-byte nonce, base64 encoded.
    pub nonce: String,
    /// Ciphertext, base64 encoded.
    pub ciphertext: String,
    /// 16-byte authentication tag, base64 encoded.
    pub tag: String,
}

/// Stored MEK format (as received from/sent to server).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMEK {
    /// Format version (always 1).
    pub v: u8,
    /// Argon2id salt, 16 bytes, base64 encoded.
    pub salt: String,
    /// AES-GCM nonce, 12 bytes, base64 encoded.
    pub nonce: String,
    /// Encrypted MEK, 32 bytes, base64 encoded.
    pub encrypted_mek: String,
    /// Authentication tag, 16 bytes, base64 encoded.
    pub tag: String,
}

/// Encrypted MEK format for pairing (no salt, uses ECDH shared secret).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedMEK {
    /// Format version (always 1).
    pub v: u8,
    /// AES-GCM nonce, 12 bytes, base64 encoded.
    pub nonce: String,
    /// Encrypted MEK ciphertext, base64 encoded.
    pub ciphertext: String,
    /// Authentication tag, 16 bytes, base64 encoded.
    pub tag: String,
}

/// ECDH P-256 keypair for pairing.
///
/// The private key is an ephemeral secret that is consumed during
/// shared secret derivation. The public key can be shared with the
/// pairing partner (Dashboard).
pub struct ECDHKeypair {
    /// Ephemeral private key (consumed on use).
    pub private_key: EphemeralSecret,
    /// Public key as uncompressed bytes (65 bytes).
    pub public_key: Vec<u8>,
}

// =============================================================================
// Key Derivation Functions
// =============================================================================

/// Derives a Key Encryption Key (KEK) from a password using Argon2id.
///
/// The KEK is used to encrypt/decrypt the Master Encryption Key (MEK).
pub fn derive_kek(password: &str, salt: &[u8; SALT_SIZE]) -> Result<SecretKey, CliError> {
    let params = Params::new(
        ARGON2_MEMORY_KB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
        Some(KEY_SIZE),
    )
    .map_err(|e| CliError::CryptoError(format!("Invalid Argon2 params: {}", e)))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut kek = [0u8; KEY_SIZE];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut kek)
        .map_err(|e| CliError::CryptoError(format!("Argon2 hashing failed: {}", e)))?;

    Ok(SecretKey::from_bytes(kek))
}

/// Derives a session key from the MEK using HKDF-SHA256.
///
/// Each session has a unique deterministic key derived from the MEK and
/// session ID. This allows any device with the MEK to derive the same
/// session key.
pub fn derive_session_key(mek: &SecretKey, session_id: &str) -> SecretKey {
    let hk = Hkdf::<Sha256>::new(None, mek.as_bytes());
    let info = format!("{}{}", SESSION_KEY_INFO_PREFIX, session_id);

    let mut session_key = [0u8; KEY_SIZE];
    // HKDF expand cannot fail with valid inputs
    hk.expand(info.as_bytes(), &mut session_key)
        .expect("HKDF expand failed");

    SecretKey::from_bytes(session_key)
}

// =============================================================================
// Encryption Functions
// =============================================================================

/// Generates a random salt for Argon2id.
pub fn generate_salt() -> [u8; SALT_SIZE] {
    let mut salt = [0u8; SALT_SIZE];
    rand::Rng::fill(&mut rand::thread_rng(), &mut salt);
    salt
}

/// Generates a random nonce for AES-GCM.
fn generate_nonce() -> [u8; NONCE_SIZE] {
    let mut nonce = [0u8; NONCE_SIZE];
    rand::Rng::fill(&mut rand::thread_rng(), &mut nonce);
    nonce
}

/// Result of AES-GCM encryption: (ciphertext, nonce, tag).
type AesGcmResult = (Vec<u8>, [u8; NONCE_SIZE], [u8; TAG_SIZE]);

/// Encrypts data using AES-256-GCM.
fn aes_gcm_encrypt(key: &SecretKey, plaintext: &[u8]) -> Result<AesGcmResult, CliError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));
    let nonce_bytes = generate_nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext_with_tag = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| CliError::CryptoError(format!("AES-GCM encryption failed: {}", e)))?;

    // AES-GCM appends the 16-byte tag to the ciphertext
    let (ciphertext, tag) = ciphertext_with_tag.split_at(ciphertext_with_tag.len() - TAG_SIZE);

    let mut tag_arr = [0u8; TAG_SIZE];
    tag_arr.copy_from_slice(tag);

    Ok((ciphertext.to_vec(), nonce_bytes, tag_arr))
}

/// Decrypts data using AES-256-GCM.
fn aes_gcm_decrypt(
    key: &SecretKey,
    ciphertext: &[u8],
    nonce: &[u8; NONCE_SIZE],
    tag: &[u8; TAG_SIZE],
) -> Result<Vec<u8>, CliError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));
    let nonce = Nonce::from_slice(nonce);

    // Concatenate ciphertext + tag for decryption
    let mut ct_with_tag = ciphertext.to_vec();
    ct_with_tag.extend_from_slice(tag);

    cipher.decrypt(nonce, ct_with_tag.as_ref()).map_err(|_| {
        CliError::CryptoError("Decryption failed (wrong key or corrupted data)".into())
    })
}

// =============================================================================
// MEK Management
// =============================================================================

/// Generates a new Master Encryption Key.
pub fn generate_mek() -> SecretKey {
    SecretKey::random()
}

/// Encrypts the MEK with a KEK (derived from password).
///
/// Returns a StoredMEK structure that can be sent to the server.
pub fn encrypt_mek(kek: &SecretKey, mek: &SecretKey, salt: &[u8; SALT_SIZE]) -> StoredMEK {
    let (ciphertext, nonce, tag) =
        aes_gcm_encrypt(kek, mek.as_bytes()).expect("MEK encryption should not fail");

    StoredMEK {
        v: 1,
        salt: base64_encode(salt),
        nonce: base64_encode(&nonce),
        encrypted_mek: base64_encode(&ciphertext),
        tag: base64_encode(&tag),
    }
}

/// Decrypts the MEK from a StoredMEK structure.
///
/// Requires the user's password to derive the KEK.
pub fn decrypt_mek(stored: &StoredMEK, password: &str) -> Result<SecretKey, CliError> {
    if stored.v != 1 {
        return Err(CliError::CryptoError(format!(
            "Unsupported MEK format version: {}",
            stored.v
        )));
    }

    // Decode base64 fields
    let salt = base64_decode(&stored.salt)?;
    let nonce = base64_decode(&stored.nonce)?;
    let encrypted_mek = base64_decode(&stored.encrypted_mek)?;
    let tag = base64_decode(&stored.tag)?;

    // Validate sizes
    if salt.len() != SALT_SIZE {
        return Err(CliError::CryptoError("Invalid salt size".into()));
    }
    if nonce.len() != NONCE_SIZE {
        return Err(CliError::CryptoError("Invalid nonce size".into()));
    }
    if encrypted_mek.len() != KEY_SIZE {
        return Err(CliError::CryptoError("Invalid encrypted MEK size".into()));
    }
    if tag.len() != TAG_SIZE {
        return Err(CliError::CryptoError("Invalid tag size".into()));
    }

    let mut salt_arr = [0u8; SALT_SIZE];
    salt_arr.copy_from_slice(&salt);

    let mut nonce_arr = [0u8; NONCE_SIZE];
    nonce_arr.copy_from_slice(&nonce);

    let mut tag_arr = [0u8; TAG_SIZE];
    tag_arr.copy_from_slice(&tag);

    // Derive KEK from password
    let kek = derive_kek(password, &salt_arr)?;

    // Decrypt MEK
    let mek_bytes = aes_gcm_decrypt(&kek, &encrypted_mek, &nonce_arr, &tag_arr)?;

    if mek_bytes.len() != KEY_SIZE {
        return Err(CliError::CryptoError("Decrypted MEK has wrong size".into()));
    }

    let mut mek_arr = [0u8; KEY_SIZE];
    mek_arr.copy_from_slice(&mek_bytes);
    Ok(SecretKey::from_bytes(mek_arr))
}

// =============================================================================
// Content Encryption
// =============================================================================

/// Encrypts session content using the session key.
pub fn encrypt_content(session_key: &SecretKey, plaintext: &[u8]) -> EncryptedContent {
    let (ciphertext, nonce, tag) =
        aes_gcm_encrypt(session_key, plaintext).expect("Content encryption should not fail");

    EncryptedContent {
        v: 1,
        nonce: base64_encode(&nonce),
        ciphertext: base64_encode(&ciphertext),
        tag: base64_encode(&tag),
    }
}

/// Decrypts session content using the session key.
pub fn decrypt_content(
    session_key: &SecretKey,
    encrypted: &EncryptedContent,
) -> Result<Vec<u8>, CliError> {
    if encrypted.v != 1 {
        return Err(CliError::CryptoError(format!(
            "Unsupported encryption version: {}",
            encrypted.v
        )));
    }

    let nonce = base64_decode(&encrypted.nonce)?;
    let ciphertext = base64_decode(&encrypted.ciphertext)?;
    let tag = base64_decode(&encrypted.tag)?;

    if nonce.len() != NONCE_SIZE {
        return Err(CliError::CryptoError("Invalid nonce size".into()));
    }
    if tag.len() != TAG_SIZE {
        return Err(CliError::CryptoError("Invalid tag size".into()));
    }

    let mut nonce_arr = [0u8; NONCE_SIZE];
    nonce_arr.copy_from_slice(&nonce);

    let mut tag_arr = [0u8; TAG_SIZE];
    tag_arr.copy_from_slice(&tag);

    aes_gcm_decrypt(session_key, &ciphertext, &nonce_arr, &tag_arr)
}

// =============================================================================
// Base64 Utilities
// =============================================================================

/// Encodes bytes to base64 string.
fn base64_encode(data: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(data)
}

/// Decodes base64 string to bytes.
fn base64_decode(encoded: &str) -> Result<Vec<u8>, CliError> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD
        .decode(encoded)
        .map_err(|e| CliError::CryptoError(format!("Base64 decode failed: {}", e)))
}

/// Public base64 encode for use in pairing flow.
pub fn encode_base64(data: &[u8]) -> String {
    base64_encode(data)
}

/// Public base64 decode for use in pairing flow.
pub fn decode_base64(encoded: &str) -> Result<Vec<u8>, CliError> {
    base64_decode(encoded)
}

// =============================================================================
// ECDH Key Exchange (for CLI Pairing)
// =============================================================================

/// Generates an ephemeral ECDH P-256 keypair for pairing.
///
/// The keypair is used for secure key exchange with the Dashboard.
/// The private key is consumed when computing the shared secret.
pub fn generate_ecdh_keypair() -> ECDHKeypair {
    let private_key = EphemeralSecret::random(&mut rand::thread_rng());
    let public_key = private_key.public_key();
    let public_key_bytes = public_key.to_encoded_point(false).as_bytes().to_vec();

    ECDHKeypair {
        private_key,
        public_key: public_key_bytes,
    }
}

/// Computes ECDH shared secret and derives a key for MEK encryption.
///
/// Takes the CLI's private key and Dashboard's public key to compute
/// a shared secret, then derives a 256-bit key using HKDF.
fn compute_ecdh_shared_key(
    private_key: EphemeralSecret,
    their_public_key_bytes: &[u8],
) -> Result<SecretKey, CliError> {
    // Parse the other party's public key
    let encoded_point = EncodedPoint::from_bytes(their_public_key_bytes)
        .map_err(|e| CliError::CryptoError(format!("Invalid public key format: {}", e)))?;

    let their_public_key = PublicKey::from_encoded_point(&encoded_point);
    let their_public_key = Option::from(their_public_key)
        .ok_or_else(|| CliError::CryptoError("Invalid public key point".into()))?;

    // Compute shared secret
    let shared_secret = private_key.diffie_hellman(&their_public_key);

    // Derive key using HKDF with domain separation
    let hk = Hkdf::<Sha256>::new(None, shared_secret.raw_secret_bytes());
    let mut key = [0u8; KEY_SIZE];
    hk.expand(PAIRING_KEY_INFO.as_bytes(), &mut key)
        .map_err(|_| CliError::CryptoError("HKDF expand failed".into()))?;

    Ok(SecretKey::from_bytes(key))
}

/// Decrypts MEK received during pairing using ECDH shared secret.
///
/// Takes the CLI's private key, Dashboard's public key, and the
/// encrypted MEK, then decrypts and returns the MEK.
pub fn decrypt_mek_from_pairing(
    private_key: EphemeralSecret,
    dash_public_key: &[u8],
    encrypted_mek: &EncryptedMEK,
) -> Result<SecretKey, CliError> {
    if encrypted_mek.v != 1 {
        return Err(CliError::CryptoError(format!(
            "Unsupported encrypted MEK version: {}",
            encrypted_mek.v
        )));
    }

    // Compute shared key from ECDH
    let shared_key = compute_ecdh_shared_key(private_key, dash_public_key)?;

    // Decode encrypted MEK fields
    let nonce = base64_decode(&encrypted_mek.nonce)?;
    let ciphertext = base64_decode(&encrypted_mek.ciphertext)?;
    let tag = base64_decode(&encrypted_mek.tag)?;

    // Validate sizes
    if nonce.len() != NONCE_SIZE {
        return Err(CliError::CryptoError("Invalid nonce size".into()));
    }
    if tag.len() != TAG_SIZE {
        return Err(CliError::CryptoError("Invalid tag size".into()));
    }

    let mut nonce_arr = [0u8; NONCE_SIZE];
    nonce_arr.copy_from_slice(&nonce);

    let mut tag_arr = [0u8; TAG_SIZE];
    tag_arr.copy_from_slice(&tag);

    // Decrypt MEK
    let mek_bytes = aes_gcm_decrypt(&shared_key, &ciphertext, &nonce_arr, &tag_arr)?;

    if mek_bytes.len() != KEY_SIZE {
        return Err(CliError::CryptoError("Decrypted MEK has wrong size".into()));
    }

    let mut mek_arr = [0u8; KEY_SIZE];
    mek_arr.copy_from_slice(&mek_bytes);
    Ok(SecretKey::from_bytes(mek_arr))
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kek_derivation_is_deterministic() {
        let password = "test-password-123";
        let salt = [1u8; SALT_SIZE];

        let kek1 = derive_kek(password, &salt).unwrap();
        let kek2 = derive_kek(password, &salt).unwrap();

        assert_eq!(kek1.as_bytes(), kek2.as_bytes());
    }

    #[test]
    fn test_kek_derivation_differs_with_salt() {
        let password = "test-password-123";
        let salt1 = [1u8; SALT_SIZE];
        let salt2 = [2u8; SALT_SIZE];

        let kek1 = derive_kek(password, &salt1).unwrap();
        let kek2 = derive_kek(password, &salt2).unwrap();

        assert_ne!(kek1.as_bytes(), kek2.as_bytes());
    }

    #[test]
    fn test_session_key_derivation_is_deterministic() {
        let mek = SecretKey::random();
        let session_id = "01HQXK7V8G3N5M2R4P6T1W9Y0Z";

        let key1 = derive_session_key(&mek, session_id);
        let key2 = derive_session_key(&mek, session_id);

        assert_eq!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_session_key_differs_per_session() {
        let mek = SecretKey::random();

        let key1 = derive_session_key(&mek, "session1");
        let key2 = derive_session_key(&mek, "session2");

        assert_ne!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_mek_encrypt_decrypt_roundtrip() {
        let password = "secure-passphrase-123";
        let salt = generate_salt();
        let mek = generate_mek();

        // Derive KEK and encrypt MEK
        let kek = derive_kek(password, &salt).unwrap();
        let stored = encrypt_mek(&kek, &mek, &salt);

        // Decrypt MEK with password
        let decrypted = decrypt_mek(&stored, password).unwrap();

        assert_eq!(mek.as_bytes(), decrypted.as_bytes());
    }

    #[test]
    fn test_mek_decrypt_wrong_password_fails() {
        let password = "correct-password";
        let wrong_password = "wrong-password";
        let salt = generate_salt();
        let mek = generate_mek();

        let kek = derive_kek(password, &salt).unwrap();
        let stored = encrypt_mek(&kek, &mek, &salt);

        let result = decrypt_mek(&stored, wrong_password);
        assert!(result.is_err());
    }

    #[test]
    fn test_content_encrypt_decrypt_roundtrip() {
        let session_key = SecretKey::random();
        let plaintext = b"Hello, World!";

        let encrypted = encrypt_content(&session_key, plaintext);
        let decrypted = decrypt_content(&session_key, &encrypted).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_content_decrypt_wrong_key_fails() {
        let key1 = SecretKey::random();
        let key2 = SecretKey::random();
        let plaintext = b"Secret message";

        let encrypted = encrypt_content(&key1, plaintext);
        let result = decrypt_content(&key2, &encrypted);

        assert!(result.is_err());
    }

    #[test]
    fn test_multi_device_access() {
        // Simulate two devices decrypting the same session
        let password = "shared-password";
        let salt = generate_salt();
        let mek = generate_mek();
        let session_id = "session-1";

        // Device 1: Encrypt a message
        let kek1 = derive_kek(password, &salt).unwrap();
        let stored = encrypt_mek(&kek1, &mek, &salt);
        let session_key1 = derive_session_key(&mek, session_id);
        let encrypted = encrypt_content(&session_key1, b"Hello from device 1");

        // Device 2: Decrypt the same message
        let mek2 = decrypt_mek(&stored, password).unwrap();
        let session_key2 = derive_session_key(&mek2, session_id);
        let decrypted = decrypt_content(&session_key2, &encrypted).unwrap();

        assert_eq!(decrypted, b"Hello from device 1".to_vec());
    }
}
