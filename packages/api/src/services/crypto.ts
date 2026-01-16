/**
 * Cryptographic utilities for E2EE support.
 *
 * The server is "zero-knowledge" - it stores encrypted blobs but cannot
 * decrypt them. All encryption/decryption happens client-side.
 * This service provides utilities for validation and base64 encoding.
 */

import type { EncryptedContent, StoredMEK } from '../types';

// =============================================================================
// Base64 Utilities
// =============================================================================

/**
 * Encodes binary data to base64 string.
 */
export function base64Encode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

/**
 * Decodes base64 string to binary data.
 */
export function base64Decode(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validates an EncryptedContent structure.
 */
export function isValidEncryptedContent(obj: unknown): obj is EncryptedContent {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const content = obj as Record<string, unknown>;

  if (content.v !== 1) {
    return false;
  }

  if (typeof content.nonce !== 'string' || content.nonce.length === 0) {
    return false;
  }

  if (
    typeof content.ciphertext !== 'string' ||
    content.ciphertext.length === 0
  ) {
    return false;
  }

  if (typeof content.tag !== 'string' || content.tag.length === 0) {
    return false;
  }

  // Validate base64 decoding and sizes
  try {
    const nonce = base64Decode(content.nonce);
    const tag = base64Decode(content.tag);

    // Nonce is 12 bytes (96 bits) for AES-GCM
    if (nonce.length !== 12) {
      return false;
    }

    // Tag is 16 bytes (128 bits) for AES-GCM
    if (tag.length !== 16) {
      return false;
    }

    // Ciphertext can be empty
    base64Decode(content.ciphertext);
  } catch {
    return false;
  }

  return true;
}

/**
 * Validates a StoredMEK structure.
 */
export function isValidStoredMEK(obj: unknown): obj is StoredMEK {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const mek = obj as Record<string, unknown>;

  if (mek.v !== 1) {
    return false;
  }

  if (typeof mek.salt !== 'string' || mek.salt.length === 0) {
    return false;
  }

  if (typeof mek.nonce !== 'string' || mek.nonce.length === 0) {
    return false;
  }

  if (typeof mek.encrypted_mek !== 'string' || mek.encrypted_mek.length === 0) {
    return false;
  }

  if (typeof mek.tag !== 'string' || mek.tag.length === 0) {
    return false;
  }

  // Validate base64 decoding and sizes
  try {
    const salt = base64Decode(mek.salt);
    const nonce = base64Decode(mek.nonce);
    const encryptedMek = base64Decode(mek.encrypted_mek);
    const tag = base64Decode(mek.tag);

    // Salt is 16 bytes for key derivation
    if (salt.length !== 16) {
      return false;
    }

    // Nonce is 12 bytes for AES-GCM
    if (nonce.length !== 12) {
      return false;
    }

    // Encrypted MEK is 32 bytes (256-bit key)
    if (encryptedMek.length !== 32) {
      return false;
    }

    // Tag is 16 bytes for AES-GCM
    if (tag.length !== 16) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

// =============================================================================
// Random Generation
// =============================================================================

/**
 * Generates cryptographically secure random bytes.
 */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Generates a random 256-bit key.
 */
export function generateKey(): Uint8Array {
  return randomBytes(32);
}

/**
 * Generates a random 96-bit nonce for AES-GCM.
 */
export function generateNonce(): Uint8Array {
  return randomBytes(12);
}

/**
 * Generates a random 128-bit salt for key derivation.
 */
export function generateSalt(): Uint8Array {
  return randomBytes(16);
}
