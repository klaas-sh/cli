/**
 * End-to-end encryption utilities for the browser.
 *
 * Implements the E2EE scheme:
 * - Argon2id for password → KEK derivation
 * - AES-256-GCM for MEK and content encryption
 * - HKDF-SHA256 for MEK → session key derivation
 *
 * Uses Web Crypto API for all cryptographic operations except Argon2id,
 * which requires the argon2-browser WASM library.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Encrypted content format for session data.
 */
export interface EncryptedContent {
  /** Format version (always 1) */
  v: 1
  /** 12-byte nonce, base64 encoded */
  nonce: string
  /** Ciphertext, base64 encoded */
  ciphertext: string
  /** 16-byte authentication tag, base64 encoded */
  tag: string
}

/**
 * Stored MEK format (as received from/sent to server).
 */
export interface StoredMEK {
  /** Format version (always 1) */
  v: 1
  /** Argon2id salt, 16 bytes, base64 encoded */
  salt: string
  /** AES-GCM nonce, 12 bytes, base64 encoded */
  nonce: string
  /** Encrypted MEK, 32 bytes, base64 encoded */
  encrypted_mek: string
  /** Authentication tag, 16 bytes, base64 encoded */
  tag: string
}

// =============================================================================
// Constants
// =============================================================================

/** Argon2id memory parameter (64 MB in KB) */
const ARGON2_MEMORY_KB = 65536

/** Argon2id iterations */
const ARGON2_ITERATIONS = 3

/** Argon2id parallelism */
const ARGON2_PARALLELISM = 4

/** Key size in bytes (256 bits) */
const KEY_SIZE = 32

/** Nonce size in bytes for AES-GCM (96 bits) */
const NONCE_SIZE = 12

/** Salt size in bytes for Argon2id (128 bits) */
const SALT_SIZE = 16

/** Auth tag size in bytes for AES-GCM (128 bits) */
const TAG_SIZE = 16

/** Version prefix for session key derivation info */
const SESSION_KEY_INFO_PREFIX = 'klaas-session-v1:'

// =============================================================================
// Base64 Utilities
// =============================================================================

/**
 * Encodes binary data to base64 string.
 */
export function base64Encode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
}

/**
 * Decodes base64 string to binary data.
 */
export function base64Decode(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// =============================================================================
// Random Generation
// =============================================================================

/**
 * Generates cryptographically secure random bytes.
 */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

/**
 * Generates a random 256-bit key.
 */
export function generateKey(): Uint8Array {
  return randomBytes(KEY_SIZE)
}

/**
 * Generates a random 96-bit nonce for AES-GCM.
 */
export function generateNonce(): Uint8Array {
  return randomBytes(NONCE_SIZE)
}

/**
 * Generates a random 128-bit salt for Argon2id.
 */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_SIZE)
}

// =============================================================================
// Key Derivation Functions
// =============================================================================

/**
 * Derives a Key Encryption Key (KEK) from a password using Argon2id.
 *
 * The KEK is used to encrypt/decrypt the Master Encryption Key (MEK).
 * Uses argon2-browser WASM implementation.
 */
export async function deriveKEK(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  // Dynamic import to avoid SSR issues (WASM)
  const argon2 = await import('argon2-browser')

  const result = await argon2.hash({
    pass: password,
    salt: salt,
    type: argon2.ArgonType.Argon2id,
    time: ARGON2_ITERATIONS,
    mem: ARGON2_MEMORY_KB,
    parallelism: ARGON2_PARALLELISM,
    hashLen: KEY_SIZE,
  })

  return result.hash
}

/**
 * Derives a session key from the MEK using HKDF-SHA256.
 *
 * Each session has a unique deterministic key derived from the MEK and
 * session ID. This allows any device with the MEK to derive the same
 * session key.
 */
export async function deriveSessionKey(
  mek: Uint8Array,
  sessionId: string
): Promise<Uint8Array> {
  const mekBuffer = mek.buffer.slice(
    mek.byteOffset,
    mek.byteOffset + mek.byteLength
  ) as ArrayBuffer

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    mekBuffer,
    'HKDF',
    false,
    ['deriveBits']
  )

  const info = new TextEncoder().encode(`${SESSION_KEY_INFO_PREFIX}${sessionId}`)

  const infoBuffer = info.buffer.slice(
    info.byteOffset,
    info.byteOffset + info.byteLength
  ) as ArrayBuffer

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new ArrayBuffer(0),
      info: infoBuffer,
    },
    keyMaterial,
    KEY_SIZE * 8 // bits
  )

  return new Uint8Array(bits)
}

// =============================================================================
// AES-256-GCM Encryption
// =============================================================================

/**
 * Encrypts data using AES-256-GCM.
 */
export async function encrypt(
  key: Uint8Array,
  plaintext: Uint8Array
): Promise<EncryptedContent> {
  const nonce = generateNonce()

  const keyBuffer = key.buffer.slice(
    key.byteOffset,
    key.byteOffset + key.byteLength
  ) as ArrayBuffer

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    'AES-GCM',
    false,
    ['encrypt']
  )

  const nonceBuffer = nonce.buffer.slice(
    nonce.byteOffset,
    nonce.byteOffset + nonce.byteLength
  ) as ArrayBuffer
  const plaintextBuffer = plaintext.buffer.slice(
    plaintext.byteOffset,
    plaintext.byteOffset + plaintext.byteLength
  ) as ArrayBuffer

  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonceBuffer },
    cryptoKey,
    plaintextBuffer
  )

  // AES-GCM appends 16-byte tag to ciphertext
  const ciphertext = new Uint8Array(ciphertextWithTag.slice(0, -TAG_SIZE))
  const tag = new Uint8Array(ciphertextWithTag.slice(-TAG_SIZE))

  return {
    v: 1,
    nonce: base64Encode(nonce),
    ciphertext: base64Encode(ciphertext),
    tag: base64Encode(tag),
  }
}

/**
 * Decrypts data using AES-256-GCM.
 */
export async function decrypt(
  key: Uint8Array,
  encrypted: EncryptedContent
): Promise<Uint8Array> {
  if (encrypted.v !== 1) {
    throw new Error(`Unsupported encryption version: ${encrypted.v}`)
  }

  const nonce = base64Decode(encrypted.nonce)
  const ciphertext = base64Decode(encrypted.ciphertext)
  const tag = base64Decode(encrypted.tag)

  // Validate sizes
  if (nonce.length !== NONCE_SIZE) {
    throw new Error('Invalid nonce size')
  }
  if (tag.length !== TAG_SIZE) {
    throw new Error('Invalid tag size')
  }

  const keyBuffer = key.buffer.slice(
    key.byteOffset,
    key.byteOffset + key.byteLength
  ) as ArrayBuffer

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    'AES-GCM',
    false,
    ['decrypt']
  )

  // Concatenate ciphertext + tag for Web Crypto API
  const ciphertextWithTag = new Uint8Array(ciphertext.length + tag.length)
  ciphertextWithTag.set(ciphertext)
  ciphertextWithTag.set(tag, ciphertext.length)

  const nonceBuffer = nonce.buffer.slice(
    nonce.byteOffset,
    nonce.byteOffset + nonce.byteLength
  ) as ArrayBuffer
  const ctBuffer = ciphertextWithTag.buffer.slice(
    ciphertextWithTag.byteOffset,
    ciphertextWithTag.byteOffset + ciphertextWithTag.byteLength
  ) as ArrayBuffer

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonceBuffer },
    cryptoKey,
    ctBuffer
  )

  return new Uint8Array(plaintext)
}

// =============================================================================
// MEK Management
// =============================================================================

/**
 * Generates a new Master Encryption Key.
 */
export function generateMEK(): Uint8Array {
  return generateKey()
}

/**
 * Encrypts the MEK with a KEK (derived from password).
 *
 * Returns a StoredMEK structure that can be sent to the server.
 */
export async function encryptMEK(
  password: string,
  mek: Uint8Array
): Promise<StoredMEK> {
  const salt = generateSalt()
  const kek = await deriveKEK(password, salt)

  const encrypted = await encrypt(kek, mek)

  return {
    v: 1,
    salt: base64Encode(salt),
    nonce: encrypted.nonce,
    encrypted_mek: encrypted.ciphertext,
    tag: encrypted.tag,
  }
}

/**
 * Decrypts the MEK from a StoredMEK structure.
 *
 * Requires the user's password to derive the KEK.
 */
export async function decryptMEK(
  stored: StoredMEK,
  password: string
): Promise<Uint8Array> {
  if (stored.v !== 1) {
    throw new Error(`Unsupported MEK format version: ${stored.v}`)
  }

  // Decode salt
  const salt = base64Decode(stored.salt)
  if (salt.length !== SALT_SIZE) {
    throw new Error('Invalid salt size')
  }

  // Derive KEK from password
  const kek = await deriveKEK(password, salt)

  // Decrypt MEK
  const decrypted = await decrypt(kek, {
    v: 1,
    nonce: stored.nonce,
    ciphertext: stored.encrypted_mek,
    tag: stored.tag,
  })

  if (decrypted.length !== KEY_SIZE) {
    throw new Error('Decrypted MEK has wrong size')
  }

  return decrypted
}

/**
 * Re-encrypts the MEK with a new password.
 *
 * Used when the user changes their password.
 */
export async function changeMEKPassword(
  stored: StoredMEK,
  oldPassword: string,
  newPassword: string
): Promise<StoredMEK> {
  // Decrypt MEK with old password
  const mek = await decryptMEK(stored, oldPassword)

  // Re-encrypt with new password
  return encryptMEK(newPassword, mek)
}

// =============================================================================
// Content Encryption Helpers
// =============================================================================

/**
 * Encrypts session content using the session key.
 */
export async function encryptContent(
  sessionKey: Uint8Array,
  plaintext: Uint8Array
): Promise<EncryptedContent> {
  return encrypt(sessionKey, plaintext)
}

/**
 * Decrypts session content using the session key.
 */
export async function decryptContent(
  sessionKey: Uint8Array,
  encrypted: EncryptedContent
): Promise<Uint8Array> {
  return decrypt(sessionKey, encrypted)
}

/**
 * Encrypts a string message for a session.
 */
export async function encryptMessage(
  sessionKey: Uint8Array,
  message: string
): Promise<EncryptedContent> {
  const plaintext = new TextEncoder().encode(message)
  return encryptContent(sessionKey, plaintext)
}

/**
 * Decrypts an encrypted message for a session.
 */
export async function decryptMessage(
  sessionKey: Uint8Array,
  encrypted: EncryptedContent
): Promise<string> {
  const plaintext = await decryptContent(sessionKey, encrypted)
  return new TextDecoder().decode(plaintext)
}

// =============================================================================
// Secure Memory Clearing
// =============================================================================

/**
 * Clears sensitive data from a Uint8Array.
 *
 * Note: This is best-effort in JavaScript. The garbage collector may still
 * have copies of the data in memory.
 */
export function clearKey(key: Uint8Array): void {
  key.fill(0)
}
