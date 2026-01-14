#!/usr/bin/env node

/**
 * Creates a user in the local D1 database for testing.
 * Skips email verification - user is created with verified email.
 * Uses PBKDF2 with SHA-256 for password hashing (matching the API auth).
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

/**
 * Hash password using PBKDF2 with SHA-256.
 * Returns the hash in format: salt:hash (hex encoded).
 * @param {string} password - The plain text password
 * @returns {Promise<string>} The hashed password as salt:hash
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(32);
  const iterations = 100000;
  const keyLength = 32;

  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, keyLength, 'sha256', (err, key) => {
      if (err) {
        reject(err);
        return;
      }
      const saltHex = salt.toString('hex');
      const hashHex = key.toString('hex');
      resolve(`${saltHex}:${hashHex}`);
    });
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
    // Hash the password using PBKDF2
    const hashedPassword = await hashPassword(password);
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
        // Update existing user's password
        const updateStmt = db.prepare(`
          UPDATE users
          SET password_hash = ?
          WHERE email = ?
        `);
        updateStmt.run(hashedPassword, email);

        console.log(green.bold`Existing user updated!`);
        console.log(cyan`Email: ${email}`);
        console.log(yellow`Password: ${password}`);
        console.log(cyan`Name: ${name}`);
        console.log(cyan`User ID: ${existingUser.id}`);
      } else {
        // Create user with password hash
        // The schema has github_id as NOT NULL, so we generate a placeholder
        const githubId = `local-${userId}`;
        const githubUsername = name.toLowerCase().replace(/\s+/g, '-');

        const insertUserStmt = db.prepare(`
          INSERT INTO users (
            id, github_id, github_username, email, password_hash,
            created_at
          ) VALUES (
            ?, ?, ?, ?, ?,
            datetime('now')
          )
        `);
        insertUserStmt.run(userId, githubId, githubUsername, email, hashedPassword);

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
    if (error.message.includes('no such column: password_hash')) {
      console.error(
        yellow`\nThe password_hash column doesn't exist on users table.`
      );
      console.error(
        'A migration may be needed to add password_hash to the users table.'
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
