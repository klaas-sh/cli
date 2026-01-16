/**
 * Type declarations for argon2-browser.
 *
 * The argon2-browser package provides Argon2 password hashing using WASM.
 */

declare module 'argon2-browser' {
  export enum ArgonType {
    Argon2d = 0,
    Argon2i = 1,
    Argon2id = 2,
  }

  export interface HashOptions {
    /** Password to hash */
    pass: string | Uint8Array
    /** Salt for hashing */
    salt: string | Uint8Array
    /** Argon2 type (Argon2d, Argon2i, or Argon2id) */
    type?: ArgonType
    /** Number of iterations */
    time?: number
    /** Memory usage in KB */
    mem?: number
    /** Parallelism */
    parallelism?: number
    /** Output hash length in bytes */
    hashLen?: number
  }

  export interface HashResult {
    /** Raw hash bytes */
    hash: Uint8Array
    /** Encoded hash string */
    hashHex: string
    /** Encoded hash with params */
    encoded: string
  }

  export interface VerifyOptions {
    /** Password to verify */
    pass: string | Uint8Array
    /** Encoded hash to verify against */
    encoded: string
    /** Argon2 type */
    type?: ArgonType
  }

  /**
   * Hash a password using Argon2.
   */
  export function hash(options: HashOptions): Promise<HashResult>

  /**
   * Verify a password against an encoded hash.
   */
  export function verify(options: VerifyOptions): Promise<boolean>
}
