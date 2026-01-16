# End-to-End Encryption Implementation Guide

This document provides a comprehensive guide for implementing end-to-end
encryption (E2EE) in klaas, ensuring that terminal session data can only be
read by authenticated user devices - not by the server or klaas team.

## Table of Contents

1. [Overview](#overview)
2. [Threat Model](#threat-model)
3. [Cryptographic Primitives](#cryptographic-primitives)
4. [Key Hierarchy](#key-hierarchy)
5. [Key Derivation](#key-derivation)
6. [Message Encryption](#message-encryption)
7. [Multi-Device Support](#multi-device-support)
8. [API Changes](#api-changes)
9. [CLI Implementation](#cli-implementation)
10. [Web Implementation](#web-implementation)
11. [Database Schema](#database-schema)
12. [Migration Strategy](#migration-strategy)
13. [Security Considerations](#security-considerations)

---

## Overview

### Goals

1. **Confidentiality**: Only the user's authenticated devices can decrypt
   session content
2. **Multi-device access**: All user devices can read all session history
3. **Zero-knowledge server**: Server cannot decrypt any session content
4. **Forward secrecy**: Compromised keys don't expose past sessions
5. **Usability**: Seamless experience without manual key management

### Non-Goals (MVP)

- Perfect forward secrecy per-message (session-level is sufficient)
- Deniability
- Post-quantum cryptography
- Hardware security module (HSM) support

### Architecture Summary

```
┌──────────────────────────────────────────────────────────────────────┐
│                           USER'S PASSWORD                            │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │   Argon2id KDF        │
                        │   (password → KEK)    │
                        └───────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    KEY ENCRYPTION KEY (KEK)                          │
│                    256-bit derived key                               │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                          encrypts/decrypts
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    MASTER ENCRYPTION KEY (MEK)                       │
│                    256-bit random key                                │
│                    (stored encrypted on server)                      │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                              derives
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    SESSION KEYS                                      │
│                    HKDF(MEK, session_id) → session_key               │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                          encrypts/decrypts
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    SESSION CONTENT                                   │
│                    Terminal I/O encrypted with AES-256-GCM           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Threat Model

### What We Protect Against

| Threat | Protection |
|--------|------------|
| Server compromise | All content encrypted; server has no keys |
| Database leak | Encrypted blobs + encrypted MEK (useless without password) |
| Network eavesdropping | TLS + E2EE (defense in depth) |
| Malicious klaas employee | Zero-knowledge architecture |
| Stolen device (locked) | MEK not stored on device; requires password |

### What We Don't Protect Against

| Threat | Reason |
|--------|--------|
| Compromised device (unlocked) | Attacker has same access as user |
| Keylogger on user's machine | Out of scope (endpoint security) |
| User shares password | Social engineering out of scope |
| Weak password | User responsibility; we enforce minimum strength |

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│  TRUSTED (user's devices)                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ CLI (Rust)  │  │ Web Browser │  │ Mobile App  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                         TLS + E2EE
                              │
┌─────────────────────────────────────────────────────────────────┐
│  UNTRUSTED (server infrastructure)                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Cloudflare Workers + D1 + Durable Objects               │   │
│  │ (sees only encrypted blobs)                              │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Cryptographic Primitives

### Selected Algorithms

| Purpose | Algorithm | Key Size | Notes |
|---------|-----------|----------|-------|
| Password → KEK | Argon2id | 256-bit output | Memory-hard, side-channel resistant |
| MEK encryption | AES-256-GCM | 256-bit | AEAD with authentication |
| Session key derivation | HKDF-SHA256 | 256-bit | Deterministic, one-way |
| Content encryption | AES-256-GCM | 256-bit | AEAD with authentication |
| Nonce generation | Random | 96-bit | Unique per encryption |

### Why These Choices

**Argon2id** for password hashing:
- Winner of Password Hashing Competition (2015)
- Resistant to GPU/ASIC attacks (memory-hard)
- Resistant to side-channel attacks (hybrid mode)
- Parameters: 64 MB memory, 3 iterations, 4 parallelism

**AES-256-GCM** for encryption:
- Industry standard, hardware-accelerated on modern CPUs
- Authenticated encryption (integrity + confidentiality)
- Available in Web Crypto API (browser) and ring (Rust)

**HKDF-SHA256** for key derivation:
- RFC 5869 standard
- Deterministic: same inputs → same output
- One-way: can't recover MEK from session key

---

## Key Hierarchy

### Key Types

```
Password (user-memorized)
    │
    ▼ Argon2id
Key Encryption Key (KEK)     ─── ephemeral, derived on-demand
    │
    ▼ AES-256-GCM decrypt
Master Encryption Key (MEK)  ─── stored encrypted on server
    │
    ▼ HKDF
Session Key                  ─── derived per-session
    │
    ▼ AES-256-GCM
Encrypted Content            ─── stored on server
```

### Key Lifecycle

| Key | Created | Stored | Lifetime |
|-----|---------|--------|----------|
| Password | User registration | User's memory | Until changed |
| KEK | Each authentication | Never stored | Request duration |
| MEK | User registration | Server (encrypted) | Account lifetime |
| Session Key | Session start | Never stored | Derived on-demand |

---

## Key Derivation

### Password to KEK (Argon2id)

```typescript
interface Argon2idParams {
  memory: 65536;      // 64 MB
  iterations: 3;
  parallelism: 4;
  hashLength: 32;     // 256 bits
}

function deriveKEK(password: string, salt: Uint8Array): Uint8Array {
  return argon2id(password, salt, params);
}
```

**Salt**: 16 random bytes, stored alongside encrypted MEK.

### MEK to Session Key (HKDF)

```typescript
function deriveSessionKey(mek: Uint8Array, sessionId: string): Uint8Array {
  const info = new TextEncoder().encode(`klaas-session-v1:${sessionId}`);
  return hkdf(mek, /* salt */ null, info, 32);
}
```

**Info string format**: `klaas-session-v1:<session_id>`

This ensures:
- Each session has a unique key
- Keys are deterministic (any device derives the same key)
- Version prefix allows future algorithm changes

---

## Message Encryption

### Encrypted Message Format

```typescript
interface EncryptedMessage {
  v: 1;                    // Format version
  nonce: string;           // 12 bytes, base64
  ciphertext: string;      // AES-256-GCM output, base64
  tag: string;             // 16 bytes auth tag, base64
}
```

**Wire format** (JSON):
```json
{
  "v": 1,
  "nonce": "base64...",
  "ciphertext": "base64...",
  "tag": "base64..."
}
```

### Encryption Process

```typescript
async function encryptMessage(
  sessionKey: Uint8Array,
  plaintext: Uint8Array
): Promise<EncryptedMessage> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  const key = await crypto.subtle.importKey(
    'raw', sessionKey, 'AES-GCM', false, ['encrypt']
  );

  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    plaintext
  );

  // AES-GCM appends 16-byte tag to ciphertext
  const ciphertext = ciphertextWithTag.slice(0, -16);
  const tag = ciphertextWithTag.slice(-16);

  return {
    v: 1,
    nonce: base64Encode(nonce),
    ciphertext: base64Encode(ciphertext),
    tag: base64Encode(tag),
  };
}
```

### Decryption Process

```typescript
async function decryptMessage(
  sessionKey: Uint8Array,
  encrypted: EncryptedMessage
): Promise<Uint8Array> {
  if (encrypted.v !== 1) {
    throw new Error(`Unsupported encryption version: ${encrypted.v}`);
  }

  const nonce = base64Decode(encrypted.nonce);
  const ciphertext = base64Decode(encrypted.ciphertext);
  const tag = base64Decode(encrypted.tag);

  const key = await crypto.subtle.importKey(
    'raw', sessionKey, 'AES-GCM', false, ['decrypt']
  );

  // Concatenate ciphertext + tag for Web Crypto API
  const ciphertextWithTag = new Uint8Array([...ciphertext, ...tag]);

  return await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertextWithTag
  );
}
```

---

## Multi-Device Support

### The Challenge

All user devices need to decrypt all session data, including historical
sessions. This requires a shared secret (MEK) accessible to all devices.

### Solution: Password-Protected MEK

1. **Registration**: Generate random MEK, encrypt with KEK (from password),
   store on server
2. **Login**: Fetch encrypted MEK, derive KEK from password, decrypt MEK
3. **New device**: Same as login - password unlocks MEK

### MEK Storage Format

```typescript
interface StoredMEK {
  v: 1;                    // Format version
  salt: string;            // Argon2id salt, 16 bytes, base64
  nonce: string;           // AES-GCM nonce, 12 bytes, base64
  encrypted_mek: string;   // Encrypted MEK, 32 bytes, base64
  tag: string;             // Auth tag, 16 bytes, base64
}
```

### Registration Flow

```
User                          Server
  │                              │
  │  1. Register(email, password)│
  │─────────────────────────────►│
  │                              │
  │  [Client generates:]         │
  │  - salt = random(16)         │
  │  - MEK = random(32)          │
  │  - KEK = argon2id(pw, salt)  │
  │  - encrypted = AES(KEK, MEK) │
  │                              │
  │  2. StoreMEK(encrypted_mek)  │
  │─────────────────────────────►│
  │                              │  [Server stores encrypted_mek]
  │                              │  [Server CANNOT decrypt]
  │  3. Success                  │
  │◄─────────────────────────────│
  │                              │
```

### Login Flow (New Device)

```
User                          Server
  │                              │
  │  1. Login(email, password)   │
  │─────────────────────────────►│
  │                              │
  │  2. Return encrypted_mek     │
  │◄─────────────────────────────│
  │                              │
  │  [Client decrypts:]          │
  │  - KEK = argon2id(pw, salt)  │
  │  - MEK = AES_decrypt(KEK,    │
  │          encrypted_mek)      │
  │                              │
  │  [MEK now available for      │
  │   session decryption]        │
  │                              │
```

### Password Change

When user changes password:

1. Decrypt MEK with old password
2. Generate new salt
3. Derive new KEK from new password
4. Re-encrypt MEK with new KEK
5. Store new encrypted MEK on server

**Note**: MEK itself doesn't change, so all historical sessions remain
accessible.

---

## API Changes

### New Endpoints

#### `GET /v1/users/me/encryption-key`

Returns the user's encrypted MEK.

**Response**:
```json
{
  "v": 1,
  "salt": "base64...",
  "nonce": "base64...",
  "encrypted_mek": "base64...",
  "tag": "base64..."
}
```

#### `PUT /v1/users/me/encryption-key`

Updates the user's encrypted MEK (password change).

**Request**:
```json
{
  "v": 1,
  "salt": "base64...",
  "nonce": "base64...",
  "encrypted_mek": "base64...",
  "tag": "base64..."
}
```

#### `POST /v1/users/me/encryption-key/verify`

Verifies the user can decrypt their MEK (password validation).

**Request**:
```json
{
  "proof": "base64..."  // HMAC(MEK, "klaas-verify")
}
```

**Response**:
```json
{
  "valid": true
}
```

### Modified Endpoints

#### WebSocket Messages

**Before** (plaintext):
```json
{
  "type": "output",
  "session_id": "01ABC...",
  "data": "base64_plaintext...",
  "timestamp": "2025-01-16T..."
}
```

**After** (encrypted):
```json
{
  "type": "output",
  "session_id": "01ABC...",
  "encrypted": {
    "v": 1,
    "nonce": "base64...",
    "ciphertext": "base64...",
    "tag": "base64..."
  },
  "timestamp": "2025-01-16T..."
}
```

---

## CLI Implementation

### Rust Dependencies

Add to `Cargo.toml`:
```toml
[dependencies]
argon2 = "0.5"           # Argon2id
aes-gcm = "0.10"         # AES-256-GCM
hkdf = "0.12"            # HKDF-SHA256
sha2 = "0.10"            # SHA-256 for HKDF
rand = "0.8"             # Secure random
base64 = "0.22"          # Encoding
zeroize = "1.8"          # Secure memory clearing
```

### Key Management Module

```rust
// src/crypto.rs

use argon2::{Argon2, Algorithm, Version, Params};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroize;

const ARGON2_MEMORY: u32 = 65536;  // 64 MB
const ARGON2_ITERATIONS: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;

/// Derives KEK from password using Argon2id
pub fn derive_kek(password: &str, salt: &[u8; 16]) -> [u8; 32] {
    let params = Params::new(
        ARGON2_MEMORY,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
        Some(32)
    ).unwrap();

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut kek = [0u8; 32];
    argon2.hash_password_into(password.as_bytes(), salt, &mut kek).unwrap();
    kek
}

/// Encrypts MEK with KEK using AES-256-GCM
pub fn encrypt_mek(kek: &[u8; 32], mek: &[u8; 32]) -> EncryptedMEK {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(kek));
    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, mek.as_ref()).unwrap();

    // AES-GCM appends tag to ciphertext
    let (ct, tag) = ciphertext.split_at(ciphertext.len() - 16);

    EncryptedMEK {
        v: 1,
        salt: salt.to_vec(),
        nonce: nonce_bytes.to_vec(),
        encrypted_mek: ct.to_vec(),
        tag: tag.to_vec(),
    }
}

/// Derives session key from MEK using HKDF
pub fn derive_session_key(mek: &[u8; 32], session_id: &str) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, mek);
    let info = format!("klaas-session-v1:{}", session_id);

    let mut session_key = [0u8; 32];
    hk.expand(info.as_bytes(), &mut session_key).unwrap();
    session_key
}

/// Encrypts message content for a session
pub fn encrypt_content(session_key: &[u8; 32], plaintext: &[u8]) -> EncryptedContent {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(session_key));
    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext).unwrap();
    let (ct, tag) = ciphertext.split_at(ciphertext.len() - 16);

    EncryptedContent {
        v: 1,
        nonce: nonce_bytes.to_vec(),
        ciphertext: ct.to_vec(),
        tag: tag.to_vec(),
    }
}

/// Decrypts message content for a session
pub fn decrypt_content(
    session_key: &[u8; 32],
    encrypted: &EncryptedContent
) -> Result<Vec<u8>, CryptoError> {
    if encrypted.v != 1 {
        return Err(CryptoError::UnsupportedVersion(encrypted.v));
    }

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(session_key));
    let nonce = Nonce::from_slice(&encrypted.nonce);

    // Concatenate ciphertext + tag
    let mut ct_with_tag = encrypted.ciphertext.clone();
    ct_with_tag.extend(&encrypted.tag);

    cipher.decrypt(nonce, ct_with_tag.as_ref())
        .map_err(|_| CryptoError::DecryptionFailed)
}
```

### Integration with WebSocket

```rust
// src/websocket.rs (modified)

impl WebSocketClient {
    pub async fn send_output(&self, data: &[u8]) -> Result<()> {
        // Encrypt before sending
        let encrypted = encrypt_content(&self.session_key, data);

        let msg = OutgoingMessage::Output {
            session_id: self.session_id.clone(),
            encrypted,
            timestamp: Utc::now().to_rfc3339(),
        };

        self.send_message(&msg).await
    }

    pub async fn handle_input(&self, encrypted: EncryptedContent) -> Result<Vec<u8>> {
        // Decrypt received input
        decrypt_content(&self.session_key, &encrypted)
    }
}
```

---

## Web Implementation

### Browser Crypto

The Web Crypto API provides all required primitives:

```typescript
// lib/crypto.ts

const ARGON2_PARAMS = {
  memory: 65536,
  iterations: 3,
  parallelism: 4,
  hashLength: 32,
};

/**
 * Derives KEK from password using Argon2id.
 * Uses argon2-browser WASM implementation.
 */
export async function deriveKEK(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const { hash } = await import('argon2-browser');

  const result = await hash({
    pass: password,
    salt: salt,
    type: ArgonType.Argon2id,
    ...ARGON2_PARAMS,
  });

  return result.hash;
}

/**
 * Encrypts data using AES-256-GCM.
 */
export async function encrypt(
  key: Uint8Array,
  plaintext: Uint8Array
): Promise<EncryptedData> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    'AES-GCM',
    false,
    ['encrypt']
  );

  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    plaintext
  );

  const ciphertext = new Uint8Array(ciphertextWithTag.slice(0, -16));
  const tag = new Uint8Array(ciphertextWithTag.slice(-16));

  return { v: 1, nonce, ciphertext, tag };
}

/**
 * Decrypts data using AES-256-GCM.
 */
export async function decrypt(
  key: Uint8Array,
  encrypted: EncryptedData
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    'AES-GCM',
    false,
    ['decrypt']
  );

  const ciphertextWithTag = new Uint8Array([
    ...encrypted.ciphertext,
    ...encrypted.tag,
  ]);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encrypted.nonce },
    cryptoKey,
    ciphertextWithTag
  );

  return new Uint8Array(plaintext);
}

/**
 * Derives session key from MEK using HKDF.
 */
export async function deriveSessionKey(
  mek: Uint8Array,
  sessionId: string
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    mek,
    'HKDF',
    false,
    ['deriveBits']
  );

  const info = new TextEncoder().encode(`klaas-session-v1:${sessionId}`);

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: info,
    },
    keyMaterial,
    256
  );

  return new Uint8Array(bits);
}
```

### React Context for Encryption

```typescript
// contexts/encryption-context.tsx

interface EncryptionContextValue {
  isUnlocked: boolean;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  encryptForSession: (sessionId: string, data: Uint8Array) => Promise<EncryptedData>;
  decryptForSession: (sessionId: string, encrypted: EncryptedData) => Promise<Uint8Array>;
}

export const EncryptionContext = createContext<EncryptionContextValue | null>(null);

export function EncryptionProvider({ children }: { children: React.ReactNode }) {
  const [mek, setMek] = useState<Uint8Array | null>(null);
  const [sessionKeys, setSessionKeys] = useState<Map<string, Uint8Array>>(new Map());

  const unlock = async (password: string): Promise<boolean> => {
    try {
      // Fetch encrypted MEK from server
      const response = await fetch('/api/v1/users/me/encryption-key');
      const stored: StoredMEK = await response.json();

      // Derive KEK from password
      const salt = base64Decode(stored.salt);
      const kek = await deriveKEK(password, salt);

      // Decrypt MEK
      const decryptedMek = await decrypt(kek, {
        v: stored.v,
        nonce: base64Decode(stored.nonce),
        ciphertext: base64Decode(stored.encrypted_mek),
        tag: base64Decode(stored.tag),
      });

      setMek(decryptedMek);
      return true;
    } catch {
      return false;
    }
  };

  const lock = () => {
    // Securely clear keys from memory
    if (mek) {
      mek.fill(0);
    }
    sessionKeys.forEach(key => key.fill(0));

    setMek(null);
    setSessionKeys(new Map());
  };

  const getSessionKey = async (sessionId: string): Promise<Uint8Array> => {
    if (!mek) throw new Error('Encryption not unlocked');

    let key = sessionKeys.get(sessionId);
    if (!key) {
      key = await deriveSessionKey(mek, sessionId);
      setSessionKeys(prev => new Map(prev).set(sessionId, key!));
    }
    return key;
  };

  const encryptForSession = async (
    sessionId: string,
    data: Uint8Array
  ): Promise<EncryptedData> => {
    const key = await getSessionKey(sessionId);
    return encrypt(key, data);
  };

  const decryptForSession = async (
    sessionId: string,
    encrypted: EncryptedData
  ): Promise<Uint8Array> => {
    const key = await getSessionKey(sessionId);
    return decrypt(key, encrypted);
  };

  return (
    <EncryptionContext.Provider value={{
      isUnlocked: mek !== null,
      unlock,
      lock,
      encryptForSession,
      decryptForSession,
    }}>
      {children}
    </EncryptionContext.Provider>
  );
}
```

---

## Database Schema

### Migration: Add Encrypted MEK Column

```sql
-- migrations/0005_add_encryption.sql

-- Add encrypted MEK storage to users table
ALTER TABLE users ADD COLUMN encrypted_mek TEXT;

-- Index for encryption key lookup
CREATE INDEX idx_users_encrypted_mek ON users(id) WHERE encrypted_mek IS NOT NULL;
```

### Updated Users Table

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- ULID
  github_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  encrypted_mek TEXT,               -- NEW: JSON blob with encrypted MEK
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Message Storage

Messages are already stored with the `data` field. We modify this to store
encrypted content:

**Before**:
```json
{"type": "output", "data": "base64_plaintext..."}
```

**After**:
```json
{"type": "output", "encrypted": {"v": 1, "nonce": "...", "ciphertext": "...", "tag": "..."}}
```

---

## Migration Strategy

### Phase 1: Add Infrastructure (Non-Breaking)

1. Add `encrypted_mek` column to users table
2. Add encryption endpoints to API
3. Add crypto modules to CLI and web (unused)
4. Deploy and verify

### Phase 2: Opt-In Encryption

1. Add "Enable E2EE" button in dashboard settings
2. When enabled:
   - Generate MEK
   - Encrypt with password
   - Store on server
3. New sessions use encryption if enabled
4. Old sessions remain plaintext (readable)

### Phase 3: Migration Tool

1. Add CLI command: `klaas migrate-sessions`
2. Downloads all plaintext sessions
3. Encrypts locally with MEK
4. Re-uploads encrypted versions
5. Deletes plaintext versions

### Phase 4: Enforce Encryption

1. Require E2EE for new accounts
2. Prompt existing users to migrate
3. Eventually: reject plaintext messages

---

## Security Considerations

### Password Strength

Enforce minimum password requirements:
- Minimum 12 characters
- Check against common password lists
- Encourage passphrase usage

```typescript
function validatePassword(password: string): ValidationResult {
  if (password.length < 12) {
    return { valid: false, error: 'Password must be at least 12 characters' };
  }

  if (isCommonPassword(password)) {
    return { valid: false, error: 'Password is too common' };
  }

  return { valid: true };
}
```

### Memory Security

Clear sensitive data from memory when no longer needed:

**Rust**:
```rust
use zeroize::Zeroize;

let mut mek: [u8; 32] = derive_mek(...);
// Use mek...
mek.zeroize();  // Securely clear
```

**JavaScript**:
```typescript
function clearKey(key: Uint8Array): void {
  key.fill(0);
}
```

### Nonce Uniqueness

AES-GCM requires unique nonces. We use random 96-bit nonces:
- Collision probability: negligible for < 2^32 messages per key
- Each session has its own key, further reducing collision risk

### Side-Channel Protection

- Use constant-time comparison for auth tags
- Argon2id is designed to resist timing attacks
- Don't branch on secret data

### Key Rotation

Future enhancement: periodic MEK rotation
1. Generate new MEK
2. Re-encrypt all sessions with new MEK
3. Update encrypted MEK on server

---

## Testing

### Unit Tests

```typescript
describe('Encryption', () => {
  it('should encrypt and decrypt round-trip', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode('Hello, World!');

    const encrypted = await encrypt(key, plaintext);
    const decrypted = await decrypt(key, encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it('should derive same session key deterministically', async () => {
    const mek = crypto.getRandomValues(new Uint8Array(32));
    const sessionId = '01ABC123';

    const key1 = await deriveSessionKey(mek, sessionId);
    const key2 = await deriveSessionKey(mek, sessionId);

    expect(key1).toEqual(key2);
  });

  it('should fail decryption with wrong key', async () => {
    const key1 = crypto.getRandomValues(new Uint8Array(32));
    const key2 = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode('Secret');

    const encrypted = await encrypt(key1, plaintext);

    await expect(decrypt(key2, encrypted)).rejects.toThrow();
  });
});
```

### Integration Tests

```typescript
describe('E2EE Flow', () => {
  it('should allow multi-device access', async () => {
    // Register user with password
    const password = 'secure-passphrase-123';
    const { encryptedMek, salt } = await registerWithE2EE(password);

    // Device 1: Unlock and encrypt message
    const mek1 = await unlockMEK(password, salt, encryptedMek);
    const sessionKey1 = await deriveSessionKey(mek1, 'session-1');
    const encrypted = await encrypt(sessionKey1, 'Hello from device 1');

    // Device 2: Unlock with same password, decrypt message
    const mek2 = await unlockMEK(password, salt, encryptedMek);
    const sessionKey2 = await deriveSessionKey(mek2, 'session-1');
    const decrypted = await decrypt(sessionKey2, encrypted);

    expect(decrypted).toBe('Hello from device 1');
  });
});
```

---

## Appendix: Wire Format Examples

### Encrypted MEK (stored on server)

```json
{
  "v": 1,
  "salt": "3q2+7w==",
  "nonce": "AAAAAAAAAAAAAAAA",
  "encrypted_mek": "xK0g3JkR...",
  "tag": "5m2n8p=="
}
```

### Encrypted WebSocket Message

```json
{
  "type": "output",
  "session_id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
  "encrypted": {
    "v": 1,
    "nonce": "BBBBBBBBBBBBBBBB",
    "ciphertext": "encrypted_terminal_output...",
    "tag": "auth_tag_here=="
  },
  "timestamp": "2025-01-16T10:30:00Z"
}
```

### Session Key Derivation Info

```
Input:  MEK (32 bytes)
Salt:   (empty)
Info:   "klaas-session-v1:01HQXK7V8G3N5M2R4P6T1W9Y0Z"
Output: Session Key (32 bytes)
```
