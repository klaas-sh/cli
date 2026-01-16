'use client'

import { create } from 'zustand'

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
 * Manually typed to avoid importing the actual module at build time.
 */
interface CryptoModule {
  generateMEK: () => Uint8Array
  deriveSessionKey: (
    mek: Uint8Array,
    sessionId: string
  ) => Promise<Uint8Array>
  encrypt: (
    key: Uint8Array,
    plaintext: Uint8Array
  ) => Promise<EncryptedContent>
  decrypt: (
    key: Uint8Array,
    encrypted: EncryptedContent
  ) => Promise<Uint8Array>
  clearKey: (key: Uint8Array) => void
  storeMEKLocally: (mek: Uint8Array) => Promise<void>
  getMEKLocally: () => Promise<Uint8Array | null>
}

/**
 * Lazy-loads the crypto module to avoid WASM bundle issues with webpack.
 * Uses webpack magic comment to tell webpack to ignore this import during
 * static analysis and only load it at runtime.
 */
async function getCryptoModule(): Promise<CryptoModule> {
  return import(/* webpackIgnore: true */ '../lib/crypto')
}

/**
 * Encryption state interface for automatic E2EE.
 * E2EE is always enabled and unlocked automatically.
 */
interface EncryptionState {
  /** Whether encryption is unlocked (MEK is available in memory) */
  isUnlocked: boolean
  /** Whether encryption state is initializing */
  isLoading: boolean
  /** Error message if any operation failed */
  error: string | null
  /** The decrypted MEK (null before auto-initialization) */
  mek: Uint8Array | null
  /** Cached session keys */
  sessionKeys: Map<string, Uint8Array>
  /** Whether auto-initialization has been attempted */
  initialized: boolean

  /**
   * Auto-initializes encryption by loading or generating MEK.
   * - Checks IndexedDB for existing MEK
   * - If not found, generates new MEK and stores it
   * - Loads MEK into memory automatically
   */
  autoInitialize: () => Promise<void>

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
 * Implements fully automatic E2EE with zero user interaction:
 * - MEK is auto-generated on first use
 * - MEK is stored in IndexedDB encrypted with device-specific key
 * - All encryption/decryption happens transparently
 *
 * All crypto operations are lazy-loaded to avoid WASM bundle issues.
 */
export const useEncryption = create<EncryptionState>()((set, get) => ({
  isUnlocked: false,
  isLoading: true,
  error: null,
  mek: null,
  sessionKeys: new Map(),
  initialized: false,

  autoInitialize: async (): Promise<void> => {
    const state = get()

    // Prevent duplicate initialization
    if (state.initialized || state.mek) {
      return
    }

    set({ isLoading: true, error: null, initialized: true })

    try {
      // Lazy-load crypto module
      const crypto = await getCryptoModule()

      // Try to load existing MEK from IndexedDB
      let mek = await crypto.getMEKLocally()

      if (!mek) {
        // No existing MEK - generate a new one
        mek = crypto.generateMEK()

        // Store in IndexedDB for future sessions
        await crypto.storeMEKLocally(mek)
      }

      set({
        isUnlocked: true,
        mek: mek,
        isLoading: false,
      })
    } catch (error) {
      set({
        error: error instanceof Error
          ? error.message
          : 'Failed to initialize encryption',
        isLoading: false,
      })
    }
  },

  getSessionKey: async (sessionId: string): Promise<Uint8Array> => {
    const state = get()

    // Auto-initialize if not done yet
    if (!state.mek) {
      await get().autoInitialize()
    }

    const currentState = get()
    if (!currentState.mek) {
      throw new Error('Encryption not initialized')
    }

    // Check cache
    let sessionKey = currentState.sessionKeys.get(sessionId)
    if (sessionKey) {
      return sessionKey
    }

    // Lazy-load crypto module
    const crypto = await getCryptoModule()

    // Derive session key
    sessionKey = await crypto.deriveSessionKey(currentState.mek, sessionId)

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
