/**
 * End-to-end encryption utilities for the browser.
 *
 * Implements the E2EE scheme:
 * - PBKDF2 for password → auth_key and enc_key derivation
 * - AES-256-GCM for MEK and content encryption
 * - HKDF-SHA256 for MEK → session key derivation
 * - ECDH P-256 for CLI pairing
 *
 * Uses Web Crypto API for all cryptographic operations.
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
 * Encrypted MEK format (stored on server or sent during pairing).
 */
export interface EncryptedMEK {
  /** Format version (always 1) */
  v: 1
  /** AES-GCM nonce, 12 bytes, base64 encoded */
  nonce: string
  /** Encrypted MEK ciphertext, base64 encoded */
  ciphertext: string
  /** Authentication tag, 16 bytes, base64 encoded */
  tag: string
}

// =============================================================================
// Constants
// =============================================================================

/** PBKDF2 iterations for key derivation */
const PBKDF2_ITERATIONS = 100000

/** Key size in bytes (256 bits) */
const KEY_SIZE = 32

/** Nonce size in bytes for AES-GCM (96 bits) */
const NONCE_SIZE = 12

/** Salt size in bytes (128 bits) */
const SALT_SIZE = 16

/** Auth tag size in bytes for AES-GCM (128 bits) */
const TAG_SIZE = 16

/** Domain separation for auth key derivation */
const AUTH_KEY_INFO = 'klaas-auth-v1'

/** Domain separation for encryption key derivation */
const ENC_KEY_INFO = 'klaas-encrypt-v1'

/** Domain separation for session key derivation */
const SESSION_KEY_INFO_PREFIX = 'klaas-session-v1:'

/** Domain separation for ECDH pairing */
const PAIRING_KEY_INFO = 'klaas-pairing-v1'

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
 * Generates a random 128-bit salt.
 */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_SIZE)
}

// =============================================================================
// PBKDF2 Key Derivation
// =============================================================================

/**
 * Derives a key from password using PBKDF2-SHA256.
 */
async function pbkdf2Derive(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const saltBuffer = salt.buffer.slice(
    salt.byteOffset,
    salt.byteOffset + salt.byteLength
  ) as ArrayBuffer

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_SIZE * 8
  )

  return new Uint8Array(bits)
}

/**
 * Expands key material using HKDF-SHA256 with info string.
 */
async function hkdfExpand(
  keyMaterial: Uint8Array,
  info: string
): Promise<Uint8Array> {
  const keyMaterialBuffer = keyMaterial.buffer.slice(
    keyMaterial.byteOffset,
    keyMaterial.byteOffset + keyMaterial.byteLength
  ) as ArrayBuffer

  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterialBuffer,
    'HKDF',
    false,
    ['deriveBits']
  )

  const encoder = new TextEncoder()
  const infoBytes = encoder.encode(info)
  const infoBuffer = infoBytes.buffer.slice(
    infoBytes.byteOffset,
    infoBytes.byteOffset + infoBytes.byteLength
  ) as ArrayBuffer

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new ArrayBuffer(0),
      info: infoBuffer,
    },
    key,
    KEY_SIZE * 8
  )

  return new Uint8Array(bits)
}

/**
 * Derives auth_key from password for server authentication.
 * This key is sent to the server for login verification.
 */
export async function deriveAuthKey(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const baseKey = await pbkdf2Derive(password, salt)
  return hkdfExpand(baseKey, AUTH_KEY_INFO)
}

/**
 * Derives enc_key from password for MEK encryption.
 * This key never leaves the client and encrypts the MEK.
 */
export async function deriveEncKey(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const baseKey = await pbkdf2Derive(password, salt)
  return hkdfExpand(baseKey, ENC_KEY_INFO)
}

/**
 * Derives session key from MEK using HKDF-SHA256.
 * Each session has a unique deterministic key.
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

  const info = `${SESSION_KEY_INFO_PREFIX}${sessionId}`
  const encoder = new TextEncoder()
  const infoBytes = encoder.encode(info)
  const infoBuffer = infoBytes.buffer.slice(
    infoBytes.byteOffset,
    infoBytes.byteOffset + infoBytes.byteLength
  ) as ArrayBuffer

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new ArrayBuffer(0),
      info: infoBuffer,
    },
    keyMaterial,
    KEY_SIZE * 8
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
 * Encrypts the MEK with enc_key for server storage.
 */
export async function encryptMEK(
  encKey: Uint8Array,
  mek: Uint8Array
): Promise<EncryptedMEK> {
  const encrypted = await encrypt(encKey, mek)
  return {
    v: 1,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
    tag: encrypted.tag,
  }
}

/**
 * Decrypts the MEK from server storage.
 */
export async function decryptMEK(
  encKey: Uint8Array,
  encrypted: EncryptedMEK
): Promise<Uint8Array> {
  const decrypted = await decrypt(encKey, {
    v: 1,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
    tag: encrypted.tag,
  })

  if (decrypted.length !== KEY_SIZE) {
    throw new Error('Decrypted MEK has wrong size')
  }

  return decrypted
}

// =============================================================================
// ECDH Key Exchange (for CLI Pairing)
// =============================================================================

/**
 * ECDH keypair for pairing.
 */
export interface ECDHKeypair {
  privateKey: CryptoKey
  publicKey: Uint8Array
}

/**
 * Generates an ephemeral ECDH P-256 keypair for pairing.
 */
export async function generateECDHKeypair(): Promise<ECDHKeypair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )

  const publicKeyRaw = await crypto.subtle.exportKey(
    'raw',
    keyPair.publicKey
  )

  return {
    privateKey: keyPair.privateKey,
    publicKey: new Uint8Array(publicKeyRaw),
  }
}

/**
 * Computes ECDH shared secret and derives a key for MEK encryption.
 */
export async function computeECDHSharedSecret(
  privateKey: CryptoKey,
  theirPublicKeyRaw: Uint8Array
): Promise<Uint8Array> {
  const publicKeyBuffer = theirPublicKeyRaw.buffer.slice(
    theirPublicKeyRaw.byteOffset,
    theirPublicKeyRaw.byteOffset + theirPublicKeyRaw.byteLength
  ) as ArrayBuffer

  const theirPublicKey = await crypto.subtle.importKey(
    'raw',
    publicKeyBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey },
    privateKey,
    256
  )

  // Use HKDF to derive a proper key with domain separation
  return hkdfExpand(new Uint8Array(sharedBits), PAIRING_KEY_INFO)
}

/**
 * Encrypts MEK for CLI pairing using ECDH shared secret.
 */
export async function encryptMEKForPairing(
  privateKey: CryptoKey,
  theirPublicKey: Uint8Array,
  mek: Uint8Array
): Promise<EncryptedMEK> {
  const sharedKey = await computeECDHSharedSecret(privateKey, theirPublicKey)
  return encryptMEK(sharedKey, mek)
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
 * Note: Best-effort in JavaScript due to garbage collection.
 */
export function clearKey(key: Uint8Array): void {
  key.fill(0)
}

// =============================================================================
// IndexedDB Local Storage for MEK
// =============================================================================

/** IndexedDB database name */
const IDB_DB_NAME = 'klaas-encryption'

/** IndexedDB store name */
const IDB_STORE_NAME = 'keys'

/** Key name for stored MEK */
const IDB_MEK_KEY = 'mek'

/**
 * Opens the IndexedDB database for key storage.
 */
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, 1)

    request.onerror = (): void => {
      reject(new Error('Failed to open IndexedDB'))
    }

    request.onsuccess = (): void => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event): void => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

/**
 * Stores the MEK locally in IndexedDB.
 * MEK is stored in plaintext since it's only kept during an active session.
 */
export async function storeMEKLocally(mek: Uint8Array): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(IDB_STORE_NAME)

    const request = store.put({
      id: IDB_MEK_KEY,
      mek: base64Encode(mek),
    })

    request.onerror = (): void => {
      db.close()
      reject(new Error('Failed to store MEK in IndexedDB'))
    }

    request.onsuccess = (): void => {
      db.close()
      resolve()
    }
  })
}

/**
 * Retrieves the MEK from local IndexedDB storage.
 */
export async function getMEKLocally(): Promise<Uint8Array | null> {
  let db: IDBDatabase

  try {
    db = await openDatabase()
  } catch {
    return null
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_STORE_NAME, 'readonly')
    const store = transaction.objectStore(IDB_STORE_NAME)
    const request = store.get(IDB_MEK_KEY)

    request.onerror = (): void => {
      db.close()
      reject(new Error('Failed to read from IndexedDB'))
    }

    request.onsuccess = (): void => {
      db.close()

      const result = request.result as { id: string; mek: string } | undefined
      if (!result?.mek) {
        resolve(null)
        return
      }

      try {
        resolve(base64Decode(result.mek))
      } catch {
        resolve(null)
      }
    }
  })
}

/**
 * Deletes the locally stored MEK from IndexedDB.
 */
export async function deleteMEKLocally(): Promise<void> {
  let db: IDBDatabase

  try {
    db = await openDatabase()
  } catch {
    return
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(IDB_STORE_NAME)
    const request = store.delete(IDB_MEK_KEY)

    request.onerror = (): void => {
      db.close()
      reject(new Error('Failed to delete from IndexedDB'))
    }

    request.onsuccess = (): void => {
      db.close()
      resolve()
    }
  })
}
