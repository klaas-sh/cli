# End-to-End Encryption Implementation Guide

This document provides a comprehensive guide for implementing end-to-end
encryption (E2EE) in Klaas, ensuring that terminal session data can only be
read by authenticated user devices - not by the server or Klaas team.

## Table of Contents

1. [Overview](#overview)
2. [Threat Model](#threat-model)
3. [Cryptographic Primitives](#cryptographic-primitives)
4. [Key Hierarchy](#key-hierarchy)
5. [Authentication with E2EE](#authentication-with-e2ee)
6. [CLI Pairing](#cli-pairing)
7. [Message Encryption](#message-encryption)
8. [API Endpoints](#api-endpoints)
9. [CLI Implementation](#cli-implementation)
10. [Dashboard Implementation](#dashboard-implementation)
11. [Database Schema](#database-schema)
12. [Security Considerations](#security-considerations)

---

## Overview

### Goals

1. **Single password**: User's login password also protects encryption keys
2. **Zero-knowledge server**: Server validates auth but cannot decrypt content
3. **Multi-device access**: Dashboard and CLI can both decrypt all sessions
4. **Seamless CLI pairing**: CLI connects via URL, no password entry in terminal
5. **True E2EE**: Only user's devices can read session content

### Architecture Summary

```
┌──────────────────────────────────────────────────────────────────────┐
│                         USER'S PASSWORD                              │
│                    (entered only in Dashboard)                       │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
        ┌───────────────────────┐     ┌───────────────────────┐
        │   PBKDF2 + "auth"     │     │   PBKDF2 + "encrypt"  │
        │   (password → auth_key)│     │   (password → enc_key)│
        └───────────────────────┘     └───────────────────────┘
                    │                               │
                    ▼                               ▼
        ┌───────────────────────┐     ┌───────────────────────┐
        │      AUTH_KEY         │     │       ENC_KEY         │
        │  (sent to server)     │     │  (never leaves client)│
        └───────────────────────┘     └───────────────────────┘
                    │                               │
                    ▼                               ▼
        ┌───────────────────────┐     ┌───────────────────────┐
        │   Server validates    │     │   Encrypts/Decrypts   │
        │   hash(auth_key)      │     │   MEK locally         │
        └───────────────────────┘     └───────────────────────┘
                                                    │
                                                    ▼
                              ┌──────────────────────────────────────┐
                              │     MASTER ENCRYPTION KEY (MEK)      │
                              │     256-bit random key               │
                              │     (stored encrypted on server)     │
                              └──────────────────────────────────────┘
                                                    │
                                              derives (HKDF)
                                                    ▼
                              ┌──────────────────────────────────────┐
                              │          SESSION KEYS                │
                              │     HKDF(MEK, session_id)            │
                              └──────────────────────────────────────┘
                                                    │
                                          encrypts/decrypts
                                                    ▼
                              ┌──────────────────────────────────────┐
                              │         SESSION CONTENT              │
                              │     AES-256-GCM encrypted            │
                              └──────────────────────────────────────┘
```

### CLI Pairing Flow

The CLI never asks for passwords. Instead, it pairs with the Dashboard:

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLI                           Server                    Dashboard  │
├─────────────────────────────────────────────────────────────────────┤
│  1. Generate ECDH keypair                                           │
│     (cli_private, cli_public)                                       │
│                                                                     │
│  2. Register pairing ────────> Store cli_public                     │
│     request                    Return pairing_code                  │
│                                                                     │
│  3. Display URL:                                                    │
│     "https://klaas.sh/pair/WXYZ"                                    │
│                                                                     │
│  4. Poll for completion...     ─────────────────> User opens URL    │
│                                                                     │
│                                                   5. Show approval: │
│                                                   "Pair MacBook?"   │
│                                                   [Approve]         │
│                                                                     │
│                                <───────────────── 6. User approves  │
│                                                                     │
│                                                   7. ECDH exchange: │
│                                                   - Generate keypair│
│                                                   - shared = ECDH() │
│                                                   - encrypt MEK     │
│                                                                     │
│                                Store encrypted    <─────────────────│
│                                MEK for pairing                      │
│                                                                     │
│  8. Receive response <─────────                                     │
│     {dash_public, encrypted_mek}                                    │
│                                                                     │
│  9. Compute shared secret                                           │
│     Decrypt MEK                                                     │
│     Store in keychain                                               │
│                                                                     │
│  10. Done! CLI has MEK                                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Threat Model

### What We Protect Against

| Threat | Protection |
|--------|------------|
| Server compromise | Server has auth_key hash, not password; MEK encrypted with enc_key |
| Database leak | Encrypted MEK useless without user's password |
| Network eavesdropping | TLS + E2EE (defense in depth) |
| Malicious Klaas employee | Zero-knowledge: server cannot derive enc_key |
| Stolen CLI device | MEK in keychain; requires device unlock |
| MITM during pairing | ECDH with verification via authenticated session |

### What We Don't Protect Against

| Threat | Reason |
|--------|--------|
| Compromised device (unlocked) | Attacker has same access as user |
| Keylogger capturing password | Endpoint security out of scope |
| User shares password | Social engineering out of scope |
| Weak password | User responsibility; we enforce minimum strength |

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│  TRUSTED (user's devices)                                       │
│  ┌─────────────┐  ┌─────────────┐                               │
│  │ Dashboard   │  │ CLI (Rust)  │                               │
│  │ (password)  │  │ (no password│                               │
│  │             │  │  via ECDH)  │                               │
│  └─────────────┘  └─────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                         TLS + E2EE
                              │
┌─────────────────────────────────────────────────────────────────┐
│  UNTRUSTED (server infrastructure)                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Cloudflare Workers + D1 + Durable Objects               │   │
│  │                                                          │   │
│  │ Server sees:                                             │   │
│  │ - hash(auth_key)  ✓ can validate login                  │   │
│  │ - encrypted_mek   ✗ cannot decrypt (needs enc_key)      │   │
│  │ - session content ✗ cannot decrypt (needs MEK)          │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Cryptographic Primitives

### Selected Algorithms

| Purpose | Algorithm | Parameters | Notes |
|---------|-----------|------------|-------|
| Password → auth_key | PBKDF2-SHA256 | 100k iterations | Web Crypto compatible |
| Password → enc_key | PBKDF2-SHA256 | 100k iterations | Different salt/info |
| MEK encryption | AES-256-GCM | 96-bit nonce | AEAD |
| Session key derivation | HKDF-SHA256 | - | Deterministic |
| Content encryption | AES-256-GCM | 96-bit nonce | AEAD |
| CLI pairing | ECDH P-256 | - | Ephemeral keys |

### Why PBKDF2 Instead of Argon2id

- **Web Crypto API**: PBKDF2 is natively available, no WASM needed
- **Performance**: Faster page loads, no large WASM bundle
- **Security**: 100k iterations provides adequate protection
- **Compatibility**: Works in all browsers without polyfills

---

## Key Hierarchy

### Key Types and Lifecycle

```
Password (user-memorized, entered in Dashboard only)
    │
    ├──▶ PBKDF2(password, salt, "klaas-auth-v1")
    │         │
    │         ▼
    │    Auth Key ─────────▶ Server (hashed)
    │    (sent to server)
    │
    └──▶ PBKDF2(password, salt, "klaas-encrypt-v1")
              │
              ▼
         Enc Key ─────────▶ Never leaves client
         (local only)
              │
              ▼ AES-256-GCM decrypt
         Master Encryption Key (MEK)
         (generated at signup, stored encrypted)
              │
              ▼ HKDF
         Session Keys
         (derived per-session, never stored)
              │
              ▼ AES-256-GCM
         Encrypted Content
```

| Key | Created | Stored | Lifetime |
|-----|---------|--------|----------|
| Password | User signup | User's memory | Until changed |
| Auth Key | Each login | Never (derived) | Request duration |
| Enc Key | Each login | Never (derived) | Session duration |
| MEK | Signup | Server (encrypted) | Account lifetime |
| Session Key | On demand | Never (derived) | Derived as needed |

---

## Authentication with E2EE

### Signup Flow

```
Dashboard                                    Server
    │                                         │
    │  1. User enters email, password         │
    │                                         │
    │  2. Client generates:                   │
    │     - salt = random(16 bytes)           │
    │     - auth_key = PBKDF2(pw, salt,       │
    │                  "klaas-auth-v1")       │
    │     - enc_key = PBKDF2(pw, salt,        │
    │                 "klaas-encrypt-v1")     │
    │     - MEK = random(32 bytes)            │
    │     - encrypted_mek = AES(enc_key, MEK) │
    │                                         │
    │  POST /auth/signup                      │
    │  { email, auth_key, salt,               │
    │    encrypted_mek }                      │
    │  ──────────────────────────────────────>│
    │                                         │  3. Server stores:
    │                                         │     - hash(auth_key)
    │                                         │     - salt
    │                                         │     - encrypted_mek
    │                                         │
    │  <────────────────── { success, token } │
    │                                         │
    │  4. Store MEK in memory for session     │
```

### Login Flow

```
Dashboard                                    Server
    │                                         │
    │  1. User enters email, password         │
    │                                         │
    │  GET /auth/salt?email=...               │
    │  ──────────────────────────────────────>│
    │  <──────────────────────── { salt }     │
    │                                         │
    │  2. Client derives:                     │
    │     - auth_key = PBKDF2(pw, salt,       │
    │                  "klaas-auth-v1")       │
    │     - enc_key = PBKDF2(pw, salt,        │
    │                 "klaas-encrypt-v1")     │
    │                                         │
    │  POST /auth/login                       │
    │  { email, auth_key }                    │
    │  ──────────────────────────────────────>│
    │                                         │  3. Server validates:
    │                                         │     hash(auth_key) == stored?
    │                                         │
    │  <─────── { token, encrypted_mek }      │
    │                                         │
    │  4. Client decrypts:                    │
    │     MEK = AES_decrypt(enc_key,          │
    │                       encrypted_mek)    │
    │                                         │
    │  5. MEK now in memory for session       │
```

### Password Change Flow

```
Dashboard                                    Server
    │                                         │
    │  1. User enters old_password,           │
    │     new_password                        │
    │                                         │
    │  2. Derive old keys, decrypt MEK        │
    │                                         │
    │  3. Generate new salt                   │
    │  4. Derive new auth_key, enc_key        │
    │  5. Re-encrypt MEK with new enc_key     │
    │                                         │
    │  PUT /auth/password                     │
    │  { old_auth_key, new_auth_key,          │
    │    new_salt, new_encrypted_mek }        │
    │  ──────────────────────────────────────>│
    │                                         │  6. Validate old_auth_key
    │                                         │  7. Update stored values
    │  <──────────────────── { success }      │
```

---

## CLI Pairing

### Overview

The CLI pairs with the Dashboard using ECDH key exchange. This allows the
CLI to receive the MEK without ever handling the user's password.

### Pairing Initiation (CLI)

```rust
// CLI generates ephemeral ECDH keypair
let (cli_private, cli_public) = generate_ecdh_keypair();

// Register with server
let response = POST /auth/pair/request {
    device_name: hostname(),
    public_key: base64(cli_public),
};

// Server returns pairing code
let pairing_code = response.pairing_code; // e.g., "WXYZ"

// Display to user
println!("To connect, open: https://klaas.sh/pair/{}", pairing_code);

// Poll for completion
loop {
    let status = GET /auth/pair/status/{pairing_code};
    if status.completed {
        // Received encrypted MEK
        break;
    }
    sleep(2 seconds);
}
```

### Pairing Approval (Dashboard)

```typescript
// User opens https://klaas.sh/pair/WXYZ
const pairingInfo = await GET /auth/pair/info/{pairing_code};
// Returns: { device_name, public_key, created_at }

// Show approval UI
// User clicks [Approve]

// Generate Dashboard's ephemeral ECDH keypair
const { dashPrivate, dashPublic } = await generateECDHKeypair();

// Compute shared secret
const sharedSecret = await ecdh(dashPrivate, pairingInfo.public_key);

// Encrypt MEK with shared secret
const encryptedMEK = await aesGcmEncrypt(sharedSecret, mek);

// Send to server
await POST /auth/pair/approve/{pairing_code} {
    public_key: base64(dashPublic),
    encrypted_mek: encryptedMEK,
};
```

### Pairing Completion (CLI)

```rust
// CLI receives response from polling
let PairingResponse { dash_public, encrypted_mek } = response;

// Compute same shared secret
let shared_secret = ecdh(cli_private, dash_public);

// Decrypt MEK
let mek = aes_gcm_decrypt(shared_secret, encrypted_mek);

// Store in OS keychain
keychain.store("klaas_mek", mek);

println!("✓ Connected! E2EE enabled.");
```

### Security of ECDH Pairing

1. **CLI public key** is registered with server, tied to pairing code
2. **Dashboard fetches** CLI's public key from server (authenticated session)
3. **ECDH shared secret** is computed independently by both parties
4. **Server sees** only public keys and encrypted MEK - cannot decrypt
5. **MITM protection**: Dashboard is authenticated; attacker would need to
   compromise both the HTTPS connection AND the user's session

---

## Message Encryption

### Encrypted Content Format

```typescript
interface EncryptedContent {
  v: 1;                    // Format version
  nonce: string;           // 12 bytes, base64
  ciphertext: string;      // AES-256-GCM output, base64
  tag: string;             // 16 bytes auth tag, base64
}
```

### Session Key Derivation

```typescript
async function deriveSessionKey(
  mek: Uint8Array,
  sessionId: string
): Promise<Uint8Array> {
  const info = `klaas-session-v1:${sessionId}`;
  return hkdfSha256(mek, new Uint8Array(0), info, 32);
}
```

Each session has a unique deterministic key. Any device with the MEK
can derive the same session key.

### Encryption/Decryption

```typescript
async function encryptContent(
  sessionKey: Uint8Array,
  plaintext: Uint8Array
): Promise<EncryptedContent> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextWithTag = await aesGcmEncrypt(sessionKey, nonce, plaintext);

  return {
    v: 1,
    nonce: base64Encode(nonce),
    ciphertext: base64Encode(ciphertextWithTag.slice(0, -16)),
    tag: base64Encode(ciphertextWithTag.slice(-16)),
  };
}

async function decryptContent(
  sessionKey: Uint8Array,
  encrypted: EncryptedContent
): Promise<Uint8Array> {
  const nonce = base64Decode(encrypted.nonce);
  const ciphertext = base64Decode(encrypted.ciphertext);
  const tag = base64Decode(encrypted.tag);

  return aesGcmDecrypt(sessionKey, nonce, concat(ciphertext, tag));
}
```

---

## API Endpoints

### Authentication Endpoints

#### `GET /auth/salt`

Returns the salt for a user's email (for client-side key derivation).

**Query Parameters:**
- `email`: User's email address

**Response:**
```json
{
  "salt": "base64..."
}
```

**Error (user not found):** Returns random salt to prevent enumeration.

#### `POST /auth/signup`

Creates a new user account with E2EE enabled.

**Request:**
```json
{
  "email": "user@example.com",
  "auth_key": "base64...",
  "salt": "base64...",
  "encrypted_mek": {
    "v": 1,
    "nonce": "base64...",
    "ciphertext": "base64...",
    "tag": "base64..."
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "jwt...",
    "user": { "id": "...", "email": "..." }
  }
}
```

#### `POST /auth/login`

Authenticates user and returns encrypted MEK.

**Request:**
```json
{
  "email": "user@example.com",
  "auth_key": "base64..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "jwt...",
    "user": { "id": "...", "email": "..." },
    "encrypted_mek": {
      "v": 1,
      "nonce": "base64...",
      "ciphertext": "base64...",
      "tag": "base64..."
    }
  }
}
```

### CLI Pairing Endpoints

#### `POST /auth/pair/request`

Initiates CLI pairing request.

**Request:**
```json
{
  "device_name": "MacBook Pro",
  "public_key": "base64..."
}
```

**Response:**
```json
{
  "pairing_code": "WXYZ",
  "expires_in": 600
}
```

#### `GET /auth/pair/info/:code`

Gets pairing request info (requires authentication).

**Response:**
```json
{
  "device_name": "MacBook Pro",
  "public_key": "base64...",
  "created_at": "2025-01-16T..."
}
```

#### `POST /auth/pair/approve/:code`

Approves pairing and sends encrypted MEK (requires authentication).

**Request:**
```json
{
  "public_key": "base64...",
  "encrypted_mek": {
    "v": 1,
    "nonce": "base64...",
    "ciphertext": "base64...",
    "tag": "base64..."
  }
}
```

#### `GET /auth/pair/status/:code`

Polls for pairing completion (CLI calls this).

**Response (pending):**
```json
{
  "status": "pending"
}
```

**Response (completed):**
```json
{
  "status": "completed",
  "public_key": "base64...",
  "encrypted_mek": {
    "v": 1,
    "nonce": "base64...",
    "ciphertext": "base64...",
    "tag": "base64..."
  }
}
```

### WebSocket Messages

All content messages use encrypted format:

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

```toml
[dependencies]
aes-gcm = "0.10"         # AES-256-GCM encryption
hkdf = "0.12"            # HKDF-SHA256 key derivation
sha2 = "0.10"            # SHA-256 for HKDF
p256 = "0.13"            # ECDH P-256
rand = "0.8"             # Secure random
base64 = "0.22"          # Encoding
zeroize = "1.8"          # Secure memory clearing
keyring = "3"            # OS keychain access
```

### ECDH Key Exchange

```rust
use p256::{ecdh::EphemeralSecret, PublicKey};
use rand::rngs::OsRng;

pub fn generate_ecdh_keypair() -> (EphemeralSecret, PublicKey) {
    let secret = EphemeralSecret::random(&mut OsRng);
    let public = PublicKey::from(&secret);
    (secret, public)
}

pub fn compute_shared_secret(
    our_secret: &EphemeralSecret,
    their_public: &PublicKey
) -> [u8; 32] {
    let shared = our_secret.diffie_hellman(their_public);
    // Use HKDF to derive a proper key from the shared secret
    let hk = Hkdf::<Sha256>::new(None, shared.raw_secret_bytes());
    let mut key = [0u8; 32];
    hk.expand(b"klaas-pairing-v1", &mut key).unwrap();
    key
}
```

### MEK Storage

```rust
use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "sh.klaas.cli";
const MEK_KEY: &str = "encryption_key";

pub fn store_mek(mek: &[u8; 32]) -> Result<()> {
    let entry = Entry::new(KEYCHAIN_SERVICE, MEK_KEY)?;
    entry.set_password(&hex::encode(mek))?;
    Ok(())
}

pub fn get_mek() -> Result<Option<[u8; 32]>> {
    let entry = Entry::new(KEYCHAIN_SERVICE, MEK_KEY)?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(&hex)?;
            let mut mek = [0u8; 32];
            mek.copy_from_slice(&bytes);
            Ok(Some(mek))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
```

---

## Dashboard Implementation

### Client-Side Key Derivation

```typescript
// lib/crypto.ts

const PBKDF2_ITERATIONS = 100000;

export async function deriveAuthKey(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  // Add domain separation
  return hkdfExpand(new Uint8Array(bits), 'klaas-auth-v1');
}

export async function deriveEncKey(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  // Add domain separation
  return hkdfExpand(new Uint8Array(bits), 'klaas-encrypt-v1');
}
```

### Login with E2EE

```typescript
// hooks/use-auth.ts

async function login(email: string, password: string) {
  // 1. Fetch salt
  const { salt } = await api.getSalt(email);
  const saltBytes = base64Decode(salt);

  // 2. Derive keys
  const authKey = await deriveAuthKey(password, saltBytes);
  const encKey = await deriveEncKey(password, saltBytes);

  // 3. Login with auth_key
  const response = await api.login({
    email,
    auth_key: base64Encode(authKey),
  });

  // 4. Decrypt MEK
  const mek = await aesGcmDecrypt(encKey, response.encrypted_mek);

  // 5. Store in memory
  setMEK(mek);
  setToken(response.token);
}
```

### ECDH for CLI Pairing

```typescript
// lib/crypto.ts

export async function generateECDHKeypair(): Promise<{
  privateKey: CryptoKey;
  publicKey: Uint8Array;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const publicKeyRaw = await crypto.subtle.exportKey(
    'raw',
    keyPair.publicKey
  );

  return {
    privateKey: keyPair.privateKey,
    publicKey: new Uint8Array(publicKeyRaw),
  };
}

export async function computeECDHSharedSecret(
  privateKey: CryptoKey,
  theirPublicKeyRaw: Uint8Array
): Promise<Uint8Array> {
  const theirPublicKey = await crypto.subtle.importKey(
    'raw',
    theirPublicKeyRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey },
    privateKey,
    256
  );

  // Use HKDF for domain separation
  return hkdfExpand(new Uint8Array(sharedBits), 'klaas-pairing-v1');
}
```

---

## Database Schema

### Users Table

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,                    -- ULID
  email TEXT UNIQUE NOT NULL,
  auth_key_hash TEXT NOT NULL,            -- PBKDF2(auth_key)
  salt TEXT NOT NULL,                     -- Base64, for key derivation
  encrypted_mek TEXT NOT NULL,            -- JSON blob with encrypted MEK
  mfa_enabled INTEGER DEFAULT 0,
  mfa_secret TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Pairing Requests Table

```sql
CREATE TABLE pairing_requests (
  id TEXT PRIMARY KEY,                    -- ULID
  pairing_code TEXT UNIQUE NOT NULL,      -- 4-8 char code
  device_name TEXT NOT NULL,
  cli_public_key TEXT NOT NULL,           -- Base64
  dash_public_key TEXT,                   -- Base64, set on approval
  encrypted_mek TEXT,                     -- JSON, set on approval
  status TEXT DEFAULT 'pending',          -- pending, completed, expired
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_by TEXT,                       -- User ID who approved
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE INDEX idx_pairing_code ON pairing_requests(pairing_code);
CREATE INDEX idx_pairing_status ON pairing_requests(status, expires_at);
```

---

## Security Considerations

### Password Strength

Enforce minimum requirements:
- Minimum 12 characters
- Check against common password lists
- Encourage passphrase usage

### Key Derivation Timing

PBKDF2 with 100k iterations takes ~100-200ms. This is intentional to slow
brute-force attacks while remaining usable.

### Memory Security

Clear sensitive data when no longer needed:

```typescript
function clearKey(key: Uint8Array): void {
  key.fill(0);
}
```

```rust
use zeroize::Zeroize;
let mut key = [0u8; 32];
// ... use key ...
key.zeroize();
```

### Nonce Uniqueness

AES-GCM requires unique nonces. Random 96-bit nonces have negligible
collision probability for practical message volumes.

### Pairing Security

1. Pairing codes expire after 10 minutes
2. Dashboard must be authenticated to approve
3. ECDH prevents server from learning MEK
4. One-time use: pairing request deleted after completion

### Forward Secrecy

Session keys are derived from MEK using HKDF. Compromising one session key
does not reveal other session keys or the MEK.

---

## Testing

### Unit Tests

```typescript
describe('Key Derivation', () => {
  it('derives different keys for auth and encrypt', async () => {
    const password = 'test-password';
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const authKey = await deriveAuthKey(password, salt);
    const encKey = await deriveEncKey(password, salt);

    expect(authKey).not.toEqual(encKey);
  });

  it('derives same keys for same inputs', async () => {
    const password = 'test-password';
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const key1 = await deriveAuthKey(password, salt);
    const key2 = await deriveAuthKey(password, salt);

    expect(key1).toEqual(key2);
  });
});

describe('ECDH Pairing', () => {
  it('computes same shared secret on both sides', async () => {
    const cli = await generateECDHKeypair();
    const dash = await generateECDHKeypair();

    const cliShared = await computeECDHSharedSecret(cli.privateKey, dash.publicKey);
    const dashShared = await computeECDHSharedSecret(dash.privateKey, cli.publicKey);

    expect(cliShared).toEqual(dashShared);
  });
});
```

### Integration Tests

```typescript
describe('E2EE Flow', () => {
  it('allows login and MEK decryption', async () => {
    const password = 'secure-passphrase-123';

    // Signup
    await signup('test@example.com', password);

    // Login on different "device"
    clearMemory();
    await login('test@example.com', password);

    // MEK should be available
    expect(getMEK()).toBeDefined();
  });

  it('allows CLI pairing', async () => {
    // CLI initiates
    const { pairingCode, cliKeypair } = await cliInitiatePairing();

    // Dashboard approves
    await dashboardApprovePairing(pairingCode);

    // CLI receives MEK
    const cliMEK = await cliCompletePairing(cliKeypair);

    // Both have same MEK
    expect(cliMEK).toEqual(getDashboardMEK());
  });
});
```
