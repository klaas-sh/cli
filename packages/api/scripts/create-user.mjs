#!/usr/bin/env node

/**
 * Creates a user in the local D1 database for testing.
 * Implements the E2EE key derivation scheme matching the dashboard.
 *
 * Key derivation:
 * - salt: random 16 bytes
 * - baseKey = PBKDF2(password, salt, 100k iterations, SHA-256)
 * - auth_key = HKDF(baseKey, "klaas-auth-v1")
 * - enc_key = HKDF(baseKey, "klaas-encrypt-v1")
 * - MEK = random 32 bytes
 * - encrypted_mek = AES-GCM(enc_key, MEK)
 * - password_hash = PBKDF2(auth_key, random_salt) (for storage)
 *
 * Usage:
 *   node scripts/create-user.mjs --email test@example.com --password pwd123
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { green, red, yellow, cyan, bold } from 'barva';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants matching dashboard crypto.ts
const PBKDF2_ITERATIONS = 100000;
const KEY_SIZE = 32;
const NONCE_SIZE = 12;
const SALT_SIZE = 16;
const AUTH_KEY_INFO = 'klaas-auth-v1';
const ENC_KEY_INFO = 'klaas-encrypt-v1';

/**
 * Derives a key from password using PBKDF2-SHA256.
 * @param {string} password - The password
 * @param {Buffer} salt - The salt (16 bytes)
 * @returns {Promise<Buffer>} The derived key (32 bytes)
 */
async function pbkdf2Derive(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256',
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      }
    );
  });
}

/**
 * Expands key material using HKDF-SHA256 with info string.
 * @param {Buffer} keyMaterial - The input key material
 * @param {string} info - The info string for domain separation
 * @returns {Promise<Buffer>} The derived key (32 bytes)
 */
async function hkdfExpand(keyMaterial, info) {
  return new Promise((resolve, reject) => {
    crypto.hkdf('sha256', keyMaterial, Buffer.alloc(0), info, KEY_SIZE,
      (err, key) => {
        if (err) reject(err);
        else resolve(Buffer.from(key));
      }
    );
  });
}

/**
 * Derives auth_key from password for server authentication.
 * @param {string} password - The password
 * @param {Buffer} salt - The salt
 * @returns {Promise<Buffer>} The auth_key
 */
async function deriveAuthKey(password, salt) {
  const baseKey = await pbkdf2Derive(password, salt);
  return hkdfExpand(baseKey, AUTH_KEY_INFO);
}

/**
 * Derives enc_key from password for MEK encryption.
 * @param {string} password - The password
 * @param {Buffer} salt - The salt
 * @returns {Promise<Buffer>} The enc_key
 */
async function deriveEncKey(password, salt) {
  const baseKey = await pbkdf2Derive(password, salt);
  return hkdfExpand(baseKey, ENC_KEY_INFO);
}

/**
 * Encrypts MEK using AES-256-GCM.
 * @param {Buffer} encKey - The encryption key
 * @param {Buffer} mek - The master encryption key to encrypt
 * @returns {Object} The encrypted MEK object
 */
function encryptMEK(encKey, mek) {
  const nonce = crypto.randomBytes(NONCE_SIZE);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, nonce);

  const ciphertext = Buffer.concat([cipher.update(mek), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Hash auth_key using PBKDF2 for storage.
 * Returns the hash in format: salt:hash (hex encoded).
 * @param {Buffer} authKey - The auth key to hash
 * @returns {Promise<string>} The hashed auth key as salt:hash
 */
async function hashAuthKey(authKey) {
  const storageSalt = crypto.randomBytes(SALT_SIZE);

  return new Promise((resolve, reject) => {
    crypto.pbkdf2(authKey, storageSalt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256',
      (err, hash) => {
        if (err) {
          reject(err);
          return;
        }
        const saltHex = storageSalt.toString('hex');
        const hashHex = hash.toString('hex');
        resolve(`${saltHex}:${hashHex}`);
      }
    );
  });
}

/**
 * Creates a user in the local D1 database for testing.
 */
async function createUser() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  const emailIndex = args.indexOf('--email');
  const passwordIndex = args.indexOf('--password');
  const nameIndex = args.indexOf('--name');

  const email = emailIndex !== -1 ? args[emailIndex + 1] : 'test@example.com';
  const password = passwordIndex !== -1 ? args[passwordIndex + 1] : 'password123';
  const name = nameIndex !== -1 ? args[nameIndex + 1] : 'Test User';

  try {
    // Step 1: Generate salt for key derivation
    const salt = crypto.randomBytes(SALT_SIZE);
    const saltBase64 = salt.toString('base64');

    // Step 2: Derive auth_key and enc_key from password
    const [authKey, encKey] = await Promise.all([
      deriveAuthKey(password, salt),
      deriveEncKey(password, salt),
    ]);

    // Step 3: Generate MEK and encrypt with enc_key
    const mek = crypto.randomBytes(KEY_SIZE);
    const encryptedMek = encryptMEK(encKey, mek);

    // Step 4: Hash auth_key for storage
    const authKeyHash = await hashAuthKey(authKey);

    const userId = ulid();

    // Find the local wrangler database
    const apiRoot = path.resolve(__dirname, '..');
    const stateDir = `${apiRoot}/.wrangler/state/v3/d1/miniflare-D1DatabaseObject`;
    const files = execSync(`find "${stateDir}" -name "*.sqlite" 2>/dev/null`, {
      encoding: 'utf8'
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    if (files.length === 0) {
      console.error(
        red`No local database found. Please run "yarn dev:api" first.`
      );
      process.exit(1);
    }

    const dbPath = files[0];
    console.log(cyan`Using database: ${dbPath}`);

    // Open database connection
    const db = new Database(dbPath);

    try {
      // Check if user already exists
      const existingUser = db
        .prepare('SELECT id FROM users WHERE email = ?')
        .get(email);

      if (existingUser) {
        // Update existing user
        const updateStmt = db.prepare(`
          UPDATE users
          SET password_hash = ?,
              salt = ?,
              encrypted_mek = ?
          WHERE email = ?
        `);
        updateStmt.run(
          authKeyHash,
          saltBase64,
          JSON.stringify(encryptedMek),
          email
        );

        console.log(green.bold`Existing user updated!`);
        console.log(cyan`Email: ${email}`);
        console.log(yellow`Password: ${password}`);
        console.log(cyan`Name: ${name}`);
        console.log(cyan`User ID: ${existingUser.id}`);
      } else {
        // Create user
        const githubId = `local-${userId}`;
        const githubUsername = name.toLowerCase().replace(/\s+/g, '-');

        const insertUserStmt = db.prepare(`
          INSERT INTO users (
            id, github_id, github_username, email, password_hash,
            salt, encrypted_mek, created_at
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, datetime('now')
          )
        `);
        insertUserStmt.run(
          userId,
          githubId,
          githubUsername,
          email,
          authKeyHash,
          saltBase64,
          JSON.stringify(encryptedMek)
        );

        console.log(green.bold`User created successfully!`);
        console.log(cyan`Email: ${email}`);
        console.log(yellow`Password: ${password}`);
        console.log(cyan`Name: ${name}`);
        console.log(cyan`User ID: ${userId}`);
      }

      console.log(
        bold`\nYou can now login to the dashboard at http://localhost:3001`
      );

    } finally {
      db.close();
    }

  } catch (error) {
    console.error(red`Error creating user: ${error.message}`);
    if (error.message.includes('no such table: users')) {
      console.error(
        yellow`\nThe users table doesn't exist. Please run migrations first:`
      );
      console.error('   yarn workspace @klaas/api db:migrate');
    }
    if (error.message.includes('no such column')) {
      console.error(
        yellow`\nMissing column. Please check migrations are up to date.`
      );
    }
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createUser();
}

export { createUser };
