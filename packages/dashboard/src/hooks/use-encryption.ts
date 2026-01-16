'use client'

import { create } from 'zustand'
import { apiClient } from '../lib/api-client'

/**
 * Stored MEK format (as received from/sent to server).
 * Exported for use by components that need to work with encrypted data.
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

/**
 * Encrypted content format for session data.
 * Exported for use by components that need to work with encrypted data.
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
 * Type definition for the crypto module.
 * This is manually typed to avoid importing the actual module at build time.
 */
interface CryptoModule {
  generateMEK: () => Uint8Array
  encryptMEK: (password: string, mek: Uint8Array) => Promise<StoredMEK>
  decryptMEK: (stored: StoredMEK, password: string) => Promise<Uint8Array>
  deriveSessionKey: (mek: Uint8Array, sessionId: string) => Promise<Uint8Array>
  encrypt: (key: Uint8Array, plaintext: Uint8Array) => Promise<EncryptedContent>
  decrypt: (key: Uint8Array, encrypted: EncryptedContent) => Promise<Uint8Array>
  clearKey: (key: Uint8Array) => void
}

/**
 * Lazy-loads the crypto module to avoid WASM bundle issues with webpack.
 * The crypto module uses argon2-browser which requires WASM support.
 *
 * Uses webpack magic comment to tell webpack to ignore this import during
 * static analysis and only load it at runtime.
 */
async function getCryptoModule(): Promise<CryptoModule> {
  // Use webpackIgnore to prevent webpack from bundling the crypto module
  // This is necessary because argon2-browser uses WASM which causes build errors
  return import(/* webpackIgnore: true */ '../lib/crypto')
}

/**
 * Encryption state interface
 */
interface EncryptionState {
  /** Whether encryption is unlocked (MEK is available) */
  isUnlocked: boolean
  /** Whether E2EE is enabled for the user */
  isEnabled: boolean
  /** Whether encryption state is loading */
  isLoading: boolean
  /** Error message if any operation failed */
  error: string | null
  /** The decrypted MEK (null when locked) */
  mek: Uint8Array | null
  /** Cached session keys */
  sessionKeys: Map<string, Uint8Array>

  /**
   * Initializes encryption state by checking if E2EE is enabled.
   */
  initialize: () => Promise<void>

  /**
   * Enables E2EE for the user with the given password.
   * Generates a new MEK, encrypts it with the password, and stores it.
   */
  enable: (password: string) => Promise<void>

  /**
   * Unlocks encryption with the user's password.
   * Fetches the encrypted MEK from the server and decrypts it.
   */
  unlock: (password: string) => Promise<boolean>

  /**
   * Locks encryption by clearing the MEK from memory.
   */
  lock: () => Promise<void>

  /**
   * Changes the encryption password.
   * Re-encrypts the MEK with the new password.
   */
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>

  /**
   * Encrypts data for a session.
   */
  encryptForSession: (
    sessionId: string,
    data: Uint8Array
  ) => Promise<EncryptedContent>

  /**
   * Decrypts data for a session.
   */
  decryptForSession: (
    sessionId: string,
    encrypted: EncryptedContent
  ) => Promise<Uint8Array>

  /**
   * Gets or derives a session key.
   */
  getSessionKey: (sessionId: string) => Promise<Uint8Array>
}

/**
 * Encryption hook using Zustand for state management.
 *
 * Manages the Master Encryption Key (MEK) and session keys for E2EE.
 * The MEK is kept in memory when unlocked and cleared when locked.
 *
 * All crypto operations are lazy-loaded to avoid WASM bundle issues
 * with webpack/Next.js. The crypto module (which includes argon2-browser)
 * is only loaded when encryption operations are actually performed.
 */
export const useEncryption = create<EncryptionState>()((set, get) => ({
  isUnlocked: false,
  isEnabled: false,
  isLoading: true,
  error: null,
  mek: null,
  sessionKeys: new Map(),

  initialize: async (): Promise<void> => {
    set({ isLoading: true, error: null })

    try {
      // Check if E2EE is enabled for the user
      const response = await apiClient.request<{ enabled: boolean }>(
        '/v1/users/me/encryption-key/status'
      )

      set({
        isEnabled: response.enabled,
        isLoading: false,
      })
    } catch {
      // If endpoint fails, assume E2EE is not enabled
      set({
        isEnabled: false,
        isLoading: false,
      })
    }
  },

  enable: async (password: string): Promise<void> => {
    set({ isLoading: true, error: null })

    try {
      // Lazy-load crypto module
      const crypto = await getCryptoModule()

      // Generate a new MEK
      const mek = crypto.generateMEK()

      // Encrypt MEK with password
      const storedMek = await crypto.encryptMEK(password, mek)

      // Store on server
      await apiClient.request('/v1/users/me/encryption-key', {
        method: 'PUT',
        body: JSON.stringify(storedMek),
      })

      set({
        isEnabled: true,
        isUnlocked: true,
        mek: mek,
        isLoading: false,
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to enable E2EE',
        isLoading: false,
      })
      throw error
    }
  },

  unlock: async (password: string): Promise<boolean> => {
    set({ isLoading: true, error: null })

    try {
      // Fetch encrypted MEK from server
      const storedMek = await apiClient.request<StoredMEK>(
        '/v1/users/me/encryption-key'
      )

      // Lazy-load crypto module
      const crypto = await getCryptoModule()

      // Decrypt MEK with password
      const mek = await crypto.decryptMEK(storedMek, password)

      set({
        isUnlocked: true,
        mek: mek,
        isLoading: false,
      })

      return true
    } catch {
      set({
        error: 'Failed to unlock - wrong password or corrupted key',
        isLoading: false,
      })
      return false
    }
  },

  lock: async (): Promise<void> => {
    const state = get()

    // Lazy-load crypto module
    const crypto = await getCryptoModule()

    // Clear MEK from memory
    if (state.mek) {
      crypto.clearKey(state.mek)
    }

    // Clear all session keys
    state.sessionKeys.forEach((key) => crypto.clearKey(key))

    set({
      isUnlocked: false,
      mek: null,
      sessionKeys: new Map(),
      error: null,
    })
  },

  changePassword: async (
    oldPassword: string,
    newPassword: string
  ): Promise<void> => {
    set({ isLoading: true, error: null })

    try {
      // Fetch current encrypted MEK
      const storedMek = await apiClient.request<StoredMEK>(
        '/v1/users/me/encryption-key'
      )

      // Lazy-load crypto module
      const crypto = await getCryptoModule()

      // Decrypt with old password
      const mek = await crypto.decryptMEK(storedMek, oldPassword)

      // Re-encrypt with new password
      const newStoredMek = await crypto.encryptMEK(newPassword, mek)

      // Store new encrypted MEK
      await apiClient.request('/v1/users/me/encryption-key', {
        method: 'PUT',
        body: JSON.stringify(newStoredMek),
      })

      // Keep MEK in memory if it was already unlocked
      set({
        mek: get().isUnlocked ? mek : null,
        isLoading: false,
      })
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to change password',
        isLoading: false,
      })
      throw error
    }
  },

  getSessionKey: async (sessionId: string): Promise<Uint8Array> => {
    const state = get()

    if (!state.mek) {
      throw new Error('Encryption not unlocked')
    }

    // Check cache
    let sessionKey = state.sessionKeys.get(sessionId)
    if (sessionKey) {
      return sessionKey
    }

    // Lazy-load crypto module
    const crypto = await getCryptoModule()

    // Derive session key
    sessionKey = await crypto.deriveSessionKey(state.mek, sessionId)

    // Cache it
    set((prev) => ({
      sessionKeys: new Map(prev.sessionKeys).set(sessionId, sessionKey!),
    }))

    return sessionKey
  },

  encryptForSession: async (
    sessionId: string,
    data: Uint8Array
  ): Promise<EncryptedContent> => {
    const sessionKey = await get().getSessionKey(sessionId)

    // Lazy-load crypto module
    const crypto = await getCryptoModule()

    return crypto.encrypt(sessionKey, data)
  },

  decryptForSession: async (
    sessionId: string,
    encrypted: EncryptedContent
  ): Promise<Uint8Array> => {
    const sessionKey = await get().getSessionKey(sessionId)

    // Lazy-load crypto module
    const crypto = await getCryptoModule()

    return crypto.decrypt(sessionKey, encrypted)
  },
}))
