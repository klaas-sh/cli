/**
 * Tests for the crypto service utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  base64Encode,
  base64Decode,
  isValidEncryptedContent,
  isValidStoredMEK,
  randomBytes,
  generateKey,
  generateNonce,
  generateSalt,
} from './crypto';

describe('base64 utilities', () => {
  it('should encode and decode round-trip', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const encoded = base64Encode(original);
    const decoded = base64Decode(encoded);

    expect(decoded).toEqual(original);
  });

  it('should encode empty array', () => {
    const empty = new Uint8Array(0);
    const encoded = base64Encode(empty);
    const decoded = base64Decode(encoded);

    expect(decoded).toEqual(empty);
  });

  it('should handle standard base64 strings', () => {
    const decoded = base64Decode('SGVsbG8gV29ybGQ=');
    const text = new TextDecoder().decode(decoded);

    expect(text).toBe('Hello World');
  });
});

describe('isValidEncryptedContent', () => {
  it('should accept valid encrypted content', () => {
    // Valid content with proper sizes
    const nonce = base64Encode(randomBytes(12));
    const ciphertext = base64Encode(randomBytes(100));
    const tag = base64Encode(randomBytes(16));

    const valid = {
      v: 1,
      nonce,
      ciphertext,
      tag,
    };

    expect(isValidEncryptedContent(valid)).toBe(true);
  });

  it('should reject wrong version', () => {
    const nonce = base64Encode(randomBytes(12));
    const ciphertext = base64Encode(randomBytes(100));
    const tag = base64Encode(randomBytes(16));

    const invalid = {
      v: 2,
      nonce,
      ciphertext,
      tag,
    };

    expect(isValidEncryptedContent(invalid)).toBe(false);
  });

  it('should reject wrong nonce size', () => {
    const nonce = base64Encode(randomBytes(11)); // wrong size
    const ciphertext = base64Encode(randomBytes(100));
    const tag = base64Encode(randomBytes(16));

    const invalid = {
      v: 1,
      nonce,
      ciphertext,
      tag,
    };

    expect(isValidEncryptedContent(invalid)).toBe(false);
  });

  it('should reject wrong tag size', () => {
    const nonce = base64Encode(randomBytes(12));
    const ciphertext = base64Encode(randomBytes(100));
    const tag = base64Encode(randomBytes(15)); // wrong size

    const invalid = {
      v: 1,
      nonce,
      ciphertext,
      tag,
    };

    expect(isValidEncryptedContent(invalid)).toBe(false);
  });

  it('should reject missing fields', () => {
    expect(isValidEncryptedContent({})).toBe(false);
    expect(isValidEncryptedContent(null)).toBe(false);
    expect(isValidEncryptedContent(undefined)).toBe(false);
    expect(isValidEncryptedContent({ v: 1 })).toBe(false);
  });

  it('should reject invalid base64', () => {
    const invalid = {
      v: 1,
      nonce: 'not-valid-base64!@#',
      ciphertext: base64Encode(randomBytes(100)),
      tag: base64Encode(randomBytes(16)),
    };

    expect(isValidEncryptedContent(invalid)).toBe(false);
  });
});

describe('isValidStoredMEK', () => {
  it('should accept valid stored MEK', () => {
    const salt = base64Encode(randomBytes(16));
    const nonce = base64Encode(randomBytes(12));
    const encryptedMek = base64Encode(randomBytes(32));
    const tag = base64Encode(randomBytes(16));

    const valid = {
      v: 1,
      salt,
      nonce,
      encrypted_mek: encryptedMek,
      tag,
    };

    expect(isValidStoredMEK(valid)).toBe(true);
  });

  it('should reject wrong salt size', () => {
    const salt = base64Encode(randomBytes(15)); // wrong size
    const nonce = base64Encode(randomBytes(12));
    const encryptedMek = base64Encode(randomBytes(32));
    const tag = base64Encode(randomBytes(16));

    const invalid = {
      v: 1,
      salt,
      nonce,
      encrypted_mek: encryptedMek,
      tag,
    };

    expect(isValidStoredMEK(invalid)).toBe(false);
  });

  it('should reject wrong encrypted MEK size', () => {
    const salt = base64Encode(randomBytes(16));
    const nonce = base64Encode(randomBytes(12));
    const encryptedMek = base64Encode(randomBytes(31)); // wrong size
    const tag = base64Encode(randomBytes(16));

    const invalid = {
      v: 1,
      salt,
      nonce,
      encrypted_mek: encryptedMek,
      tag,
    };

    expect(isValidStoredMEK(invalid)).toBe(false);
  });

  it('should reject missing fields', () => {
    expect(isValidStoredMEK({})).toBe(false);
    expect(isValidStoredMEK(null)).toBe(false);
  });
});

describe('random generation', () => {
  it('should generate 32-byte keys', () => {
    const key = generateKey();
    expect(key.length).toBe(32);
  });

  it('should generate 12-byte nonces', () => {
    const nonce = generateNonce();
    expect(nonce.length).toBe(12);
  });

  it('should generate 16-byte salts', () => {
    const salt = generateSalt();
    expect(salt.length).toBe(16);
  });

  it('should generate different values each time', () => {
    const key1 = generateKey();
    const key2 = generateKey();

    // With 32 random bytes, collision probability is negligible
    expect(key1).not.toEqual(key2);
  });

  it('should generate specified length', () => {
    expect(randomBytes(10).length).toBe(10);
    expect(randomBytes(100).length).toBe(100);
    expect(randomBytes(0).length).toBe(0);
  });
});
