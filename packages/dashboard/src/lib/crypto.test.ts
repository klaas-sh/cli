/**
 * Tests for the browser crypto utilities.
 *
 * Note: These tests use the Web Crypto API which is available in Node.js
 * via the global crypto object. Argon2id tests require the WASM module
 * which may not work in all test environments.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  base64Encode,
  base64Decode,
  randomBytes,
  generateKey,
  generateNonce,
  generateSalt,
  encrypt,
  decrypt,
  deriveSessionKey,
  encryptContent,
  decryptContent,
  encryptMessage,
  decryptMessage,
  clearKey,
} from './crypto'

// Web Crypto API is available in Node.js 15+ globally
beforeAll(() => {
  // Ensure crypto is available
  if (typeof crypto === 'undefined') {
    throw new Error('Web Crypto API not available')
  }
})

describe('base64 utilities', () => {
  it('should encode and decode round-trip', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128])
    const encoded = base64Encode(original)
    const decoded = base64Decode(encoded)

    expect(decoded).toEqual(original)
  })

  it('should handle empty array', () => {
    const empty = new Uint8Array(0)
    const encoded = base64Encode(empty)
    const decoded = base64Decode(encoded)

    expect(decoded).toEqual(empty)
  })

  it('should decode standard base64', () => {
    const decoded = base64Decode('SGVsbG8gV29ybGQ=')
    const text = new TextDecoder().decode(decoded)

    expect(text).toBe('Hello World')
  })
})

describe('random generation', () => {
  it('should generate 32-byte keys', () => {
    const key = generateKey()
    expect(key.length).toBe(32)
  })

  it('should generate 12-byte nonces', () => {
    const nonce = generateNonce()
    expect(nonce.length).toBe(12)
  })

  it('should generate 16-byte salts', () => {
    const salt = generateSalt()
    expect(salt.length).toBe(16)
  })

  it('should generate different values each time', () => {
    const key1 = generateKey()
    const key2 = generateKey()

    // With 32 random bytes, collision probability is negligible
    expect(key1).not.toEqual(key2)
  })

  it('should generate specified length', () => {
    expect(randomBytes(10).length).toBe(10)
    expect(randomBytes(100).length).toBe(100)
    expect(randomBytes(0).length).toBe(0)
  })
})

describe('AES-256-GCM encryption', () => {
  it('should encrypt and decrypt round-trip', async () => {
    const key = generateKey()
    const plaintext = new TextEncoder().encode('Hello, World!')

    const encrypted = await encrypt(key, plaintext)
    const decrypted = await decrypt(key, encrypted)

    // Compare as arrays since Uint8Array toEqual can be flaky
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext))
  })

  it('should produce valid encrypted content structure', async () => {
    const key = generateKey()
    const plaintext = new Uint8Array([1, 2, 3])

    const encrypted = await encrypt(key, plaintext)

    expect(encrypted.v).toBe(1)
    expect(typeof encrypted.nonce).toBe('string')
    expect(typeof encrypted.ciphertext).toBe('string')
    expect(typeof encrypted.tag).toBe('string')

    // Nonce should be 12 bytes
    expect(base64Decode(encrypted.nonce).length).toBe(12)

    // Tag should be 16 bytes
    expect(base64Decode(encrypted.tag).length).toBe(16)
  })

  it('should fail decryption with wrong key', async () => {
    const key1 = generateKey()
    const key2 = generateKey()
    const plaintext = new TextEncoder().encode('Secret')

    const encrypted = await encrypt(key1, plaintext)

    await expect(decrypt(key2, encrypted)).rejects.toThrow()
  })

  it('should fail decryption with tampered ciphertext', async () => {
    const key = generateKey()
    const plaintext = new TextEncoder().encode('Secret')

    const encrypted = await encrypt(key, plaintext)

    // Tamper with ciphertext
    const ciphertextBytes = base64Decode(encrypted.ciphertext)
    ciphertextBytes[0] ^= 0xff
    encrypted.ciphertext = base64Encode(ciphertextBytes)

    await expect(decrypt(key, encrypted)).rejects.toThrow()
  })

  it('should fail decryption with tampered tag', async () => {
    const key = generateKey()
    const plaintext = new TextEncoder().encode('Secret')

    const encrypted = await encrypt(key, plaintext)

    // Tamper with tag
    const tagBytes = base64Decode(encrypted.tag)
    tagBytes[0] ^= 0xff
    encrypted.tag = base64Encode(tagBytes)

    await expect(decrypt(key, encrypted)).rejects.toThrow()
  })

  it('should handle empty plaintext', async () => {
    const key = generateKey()
    const plaintext = new Uint8Array(0)

    const encrypted = await encrypt(key, plaintext)
    const decrypted = await decrypt(key, encrypted)

    expect(decrypted).toEqual(plaintext)
  })

  it('should handle large plaintext', async () => {
    const key = generateKey()
    // crypto.getRandomValues has a 65536 byte limit, so use smaller size
    const plaintext = randomBytes(1024 * 50) // 50KB

    const encrypted = await encrypt(key, plaintext)
    const decrypted = await decrypt(key, encrypted)

    // Compare as arrays since Uint8Array toEqual can be flaky
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext))
  })
})

describe('session key derivation', () => {
  it('should derive deterministic session keys', async () => {
    const mek = generateKey()
    const sessionId = '01HQXK7V8G3N5M2R4P6T1W9Y0Z'

    const key1 = await deriveSessionKey(mek, sessionId)
    const key2 = await deriveSessionKey(mek, sessionId)

    expect(key1).toEqual(key2)
  })

  it('should derive different keys for different sessions', async () => {
    const mek = generateKey()

    const key1 = await deriveSessionKey(mek, 'session1')
    const key2 = await deriveSessionKey(mek, 'session2')

    expect(key1).not.toEqual(key2)
  })

  it('should derive different keys for different MEKs', async () => {
    const mek1 = generateKey()
    const mek2 = generateKey()
    const sessionId = 'same-session'

    const key1 = await deriveSessionKey(mek1, sessionId)
    const key2 = await deriveSessionKey(mek2, sessionId)

    expect(key1).not.toEqual(key2)
  })

  it('should produce 32-byte keys', async () => {
    const mek = generateKey()
    const sessionKey = await deriveSessionKey(mek, 'test-session')

    expect(sessionKey.length).toBe(32)
  })
})

describe('content encryption helpers', () => {
  it('should encrypt and decrypt content', async () => {
    const sessionKey = generateKey()
    const plaintext = new TextEncoder().encode('Terminal output')

    const encrypted = await encryptContent(sessionKey, plaintext)
    const decrypted = await decryptContent(sessionKey, encrypted)

    // Compare as arrays since Uint8Array toEqual can be flaky
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext))
  })
})

describe('message encryption helpers', () => {
  it('should encrypt and decrypt string messages', async () => {
    const sessionKey = generateKey()
    const message = 'Hello from device 1'

    const encrypted = await encryptMessage(sessionKey, message)
    const decrypted = await decryptMessage(sessionKey, encrypted)

    expect(decrypted).toBe(message)
  })

  it('should handle unicode messages', async () => {
    const sessionKey = generateKey()
    const message = 'Hello 世界 🌍 مرحبا'

    const encrypted = await encryptMessage(sessionKey, message)
    const decrypted = await decryptMessage(sessionKey, encrypted)

    expect(decrypted).toBe(message)
  })

  it('should handle empty messages', async () => {
    const sessionKey = generateKey()
    const message = ''

    const encrypted = await encryptMessage(sessionKey, message)
    const decrypted = await decryptMessage(sessionKey, encrypted)

    expect(decrypted).toBe(message)
  })
})

describe('clearKey', () => {
  it('should zero out key bytes', () => {
    const key = new Uint8Array([1, 2, 3, 4, 5])

    clearKey(key)

    expect(key).toEqual(new Uint8Array([0, 0, 0, 0, 0]))
  })
})

describe('multi-device access scenario', () => {
  it('should allow two devices to communicate securely', async () => {
    // Shared MEK (in real scenario, encrypted with password on server)
    const sharedMek = generateKey()
    const sessionId = 'session-123'

    // Device 1: Encrypt a message
    const sessionKey1 = await deriveSessionKey(sharedMek, sessionId)
    const encrypted = await encryptMessage(sessionKey1, 'Hello from device 1')

    // Device 2: Decrypt the same message (using same MEK and session ID)
    const sessionKey2 = await deriveSessionKey(sharedMek, sessionId)
    const decrypted = await decryptMessage(sessionKey2, encrypted)

    expect(decrypted).toBe('Hello from device 1')
  })
})
