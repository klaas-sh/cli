/**
 * Dashboard Authentication Routes with E2EE Support
 *
 * Implements client-side key derivation for true E2EE:
 * - Client derives auth_key and enc_key from password
 * - Server only sees auth_key (never the password)
 * - enc_key encrypts MEK, which encrypts session content
 *
 * Routes:
 * - GET /auth/salt - Get salt for client-side key derivation
 * - POST /auth/signup - Create account with E2EE
 * - POST /auth/login - Authenticate with auth_key
 * - GET /auth/check - Verify current token
 * - POST /auth/pair/request - CLI initiates pairing
 * - GET /auth/pair/info/:code - Get pairing info (authenticated)
 * - POST /auth/pair/approve/:code - Approve pairing (authenticated)
 * - GET /auth/pair/status/:code - Poll pairing status
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { ulid } from 'ulid';
import type { Env } from '../../types';
import { generateTokens } from '../../services/jwt';
import {
  userAuthMiddleware,
  type UserContextVariables
} from '../../middleware/user-auth';

// =============================================================================
// Types
// =============================================================================

/** Encrypted MEK format */
interface EncryptedMEK {
  v: 1;
  nonce: string;
  ciphertext: string;
  tag: string;
}

/** Signup request body */
interface SignupRequest {
  email: string;
  auth_key: string;
  salt: string;
  encrypted_mek: EncryptedMEK;
}

/** Login request body */
interface LoginRequest {
  email: string;
  auth_key: string;
}

/** Pairing request body */
interface PairingRequest {
  device_name: string;
  public_key: string;
}

/** Pairing approval body */
interface PairingApprovalRequest {
  public_key: string;
  encrypted_mek: EncryptedMEK;
}

/** API response format */
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Hash auth_key using PBKDF2 for storage.
 * This adds another layer of hashing so even auth_key isn't stored directly.
 */
async function hashAuthKey(authKey: string): Promise<string> {
  const authKeyBytes = base64ToBytes(authKey);

  // Generate random salt for storage hash
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    authKeyBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  const hash = bytesToHex(new Uint8Array(derivedBits));
  const saltHex = bytesToHex(salt);

  return `${saltHex}:${hash}`;
}

/**
 * Verify auth_key against stored hash.
 */
async function verifyAuthKey(
  authKey: string,
  storedHash: string
): Promise<boolean> {
  const [saltHex, hash] = storedHash.split(':');
  if (!saltHex || !hash) {
    return false;
  }

  const authKeyBytes = base64ToBytes(authKey);
  const salt = hexToBytes(saltHex);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    authKeyBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  const derivedHash = bytesToHex(new Uint8Array(derivedBits));
  return timingSafeEqual(derivedHash, hash);
}

/**
 * Timing-safe string comparison.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Generate a random pairing code.
 * Uses uppercase letters and digits, excluding confusing characters.
 */
function generatePairingCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Generate a random salt for key derivation.
 * Returns base64-encoded 16 bytes.
 */
function generateSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64(bytes);
}

/**
 * Convert hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert base64 string to Uint8Array.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64 string.
 */
function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Validate encrypted MEK structure.
 */
function isValidEncryptedMEK(obj: unknown): obj is EncryptedMEK {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const mek = obj as Record<string, unknown>;
  return (
    mek.v === 1 &&
    typeof mek.nonce === 'string' &&
    typeof mek.ciphertext === 'string' &&
    typeof mek.tag === 'string'
  );
}

// =============================================================================
// Routes
// =============================================================================

/**
 * Create dashboard auth routes.
 */
export function createAuthRoutes() {
  const app = new Hono<{
    Bindings: Env;
    Variables: UserContextVariables;
  }>();

  /**
   * GET /auth/salt
   * Get salt for client-side key derivation.
   * Returns random salt if user doesn't exist (to prevent enumeration).
   */
  app.get('/salt', async (c: Context<{ Bindings: Env }>) => {
    try {
      const email = c.req.query('email');

      if (!email) {
        const response: ApiResponse = {
          success: false,
          error: 'Email is required'
        };
        return c.json(response, 400);
      }

      // Find user's salt
      const user = await c.env.DB.prepare(
        `SELECT salt FROM users WHERE email = ?`
      )
        .bind(email.toLowerCase())
        .first<{ salt: string | null }>();

      // Return user's salt or generate random one to prevent enumeration
      const salt = user?.salt || generateSalt();

      const response: ApiResponse<{ salt: string }> = {
        success: true,
        data: { salt }
      };

      return c.json(response);
    } catch (error) {
      console.error('Salt fetch error:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch salt'
      };
      return c.json(response, 500);
    }
  });

  /**
   * POST /auth/signup
   * Create new user account with E2EE.
   */
  app.post('/signup', async (c: Context<{ Bindings: Env }>) => {
    try {
      const body = await c.req.json<SignupRequest>();
      const { email, auth_key, salt, encrypted_mek } = body;

      // Validate required fields
      if (!email || !auth_key || !salt || !encrypted_mek) {
        const response: ApiResponse = {
          success: false,
          error: 'Email, auth_key, salt, and encrypted_mek are required'
        };
        return c.json(response, 400);
      }

      // Validate email format
      if (!email.includes('@')) {
        const response: ApiResponse = {
          success: false,
          error: 'Invalid email format'
        };
        return c.json(response, 400);
      }

      // Validate encrypted MEK structure
      if (!isValidEncryptedMEK(encrypted_mek)) {
        const response: ApiResponse = {
          success: false,
          error: 'Invalid encrypted_mek format'
        };
        return c.json(response, 400);
      }

      // Check if user already exists
      const existing = await c.env.DB.prepare(
        `SELECT id FROM users WHERE email = ?`
      )
        .bind(email.toLowerCase())
        .first();

      if (existing) {
        const response: ApiResponse = {
          success: false,
          error: 'Email already registered'
        };
        return c.json(response, 409);
      }

      // Hash auth_key for storage
      const authKeyHash = await hashAuthKey(auth_key);

      // Create user
      const userId = ulid();
      const now = new Date().toISOString();

      await c.env.DB.prepare(
        `INSERT INTO users (
          id, github_id, github_username, email, password_hash,
          salt, encrypted_mek, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          userId,
          `local_${userId}`, // Placeholder for github_id (required by schema)
          email.split('@')[0], // Use email prefix as username
          email.toLowerCase(),
          authKeyHash,
          salt,
          JSON.stringify(encrypted_mek),
          now
        )
        .run();

      // Generate tokens
      const jwtSecret =
        c.env.JWT_SECRET || 'dev-secret-change-in-production';
      const { accessToken, refreshToken } = await generateTokens(
        userId,
        jwtSecret
      );

      const response: ApiResponse<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; email: string };
      }> = {
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: { id: userId, email: email.toLowerCase() }
        },
        message: 'Account created successfully'
      };

      return c.json(response, 201);
    } catch (error) {
      console.error('Signup error:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Signup failed'
      };
      return c.json(response, 500);
    }
  });

  /**
   * POST /auth/login
   * Authenticate user with auth_key.
   * Returns encrypted MEK for client-side decryption.
   */
  app.post('/login', async (c: Context<{ Bindings: Env }>) => {
    try {
      const body = await c.req.json<LoginRequest>();
      const { email, auth_key } = body;

      if (!email || !auth_key) {
        const response: ApiResponse = {
          success: false,
          error: 'Email and auth_key are required'
        };
        return c.json(response, 400);
      }

      // Find user by email
      const user = await c.env.DB.prepare(
        `SELECT id, email, password_hash, encrypted_mek
         FROM users WHERE email = ?`
      )
        .bind(email.toLowerCase())
        .first<{
          id: string;
          email: string;
          password_hash: string | null;
          encrypted_mek: string | null;
        }>();

      if (!user || !user.password_hash) {
        const response: ApiResponse = {
          success: false,
          error: 'Invalid email or password'
        };
        return c.json(response, 401);
      }

      // Verify auth_key
      const isValid = await verifyAuthKey(auth_key, user.password_hash);
      if (!isValid) {
        const response: ApiResponse = {
          success: false,
          error: 'Invalid email or password'
        };
        return c.json(response, 401);
      }

      // Generate tokens
      const jwtSecret =
        c.env.JWT_SECRET || 'dev-secret-change-in-production';
      const { accessToken, refreshToken } = await generateTokens(
        user.id,
        jwtSecret
      );

      // Parse encrypted MEK
      let encryptedMek: EncryptedMEK | null = null;
      if (user.encrypted_mek) {
        try {
          encryptedMek = JSON.parse(user.encrypted_mek);
        } catch {
          console.error('Failed to parse encrypted_mek');
        }
      }

      const response: ApiResponse<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; email: string };
        encrypted_mek: EncryptedMEK | null;
      }> = {
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: { id: user.id, email: user.email },
          encrypted_mek: encryptedMek
        },
        message: 'Login successful'
      };

      return c.json(response);
    } catch (error) {
      console.error('Login error:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Login failed'
      };
      return c.json(response, 500);
    }
  });

  /**
   * GET /auth/check
   * Verify current token is valid.
   */
  app.get(
    '/check',
    userAuthMiddleware,
    async (
      c: Context<{ Bindings: Env; Variables: UserContextVariables }>
    ) => {
      try {
        const userId = c.get('userId');

        // Get fresh user data
        const user = await c.env.DB.prepare(
          `SELECT id, email, github_username, created_at
           FROM users WHERE id = ?`
        )
          .bind(userId)
          .first<{
            id: string;
            email: string;
            github_username: string | null;
            created_at: string;
          }>();

        if (!user) {
          const response: ApiResponse = {
            success: false,
            error: 'User not found'
          };
          return c.json(response, 404);
        }

        const response: ApiResponse<{
          id: string;
          email: string;
          githubUsername: string | null;
          createdAt: string;
        }> = {
          success: true,
          data: {
            id: user.id,
            email: user.email,
            githubUsername: user.github_username,
            createdAt: user.created_at
          }
        };

        return c.json(response);
      } catch (error) {
        console.error('Auth check error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Authentication check failed'
        };
        return c.json(response, 500);
      }
    }
  );

  // ===========================================================================
  // CLI Pairing Routes
  // ===========================================================================

  /**
   * POST /auth/pair/request
   * CLI initiates pairing by registering its ECDH public key.
   */
  app.post('/pair/request', async (c: Context<{ Bindings: Env }>) => {
    try {
      const body = await c.req.json<PairingRequest>();
      const { device_name, public_key } = body;

      if (!device_name || !public_key) {
        const response: ApiResponse = {
          success: false,
          error: 'device_name and public_key are required'
        };
        return c.json(response, 400);
      }

      // Generate pairing code and ID
      const id = ulid();
      const pairingCode = generatePairingCode();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

      // Store pairing request
      await c.env.DB.prepare(
        `INSERT INTO pairing_requests (
          id, pairing_code, device_name, cli_public_key,
          status, created_at, expires_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`
      )
        .bind(
          id,
          pairingCode,
          device_name,
          public_key,
          now.toISOString(),
          expiresAt.toISOString()
        )
        .run();

      const response: ApiResponse<{
        pairing_code: string;
        expires_in: number;
      }> = {
        success: true,
        data: {
          pairing_code: pairingCode,
          expires_in: 600 // 10 minutes in seconds
        }
      };

      return c.json(response, 201);
    } catch (error) {
      console.error('Pairing request error:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to create pairing request'
      };
      return c.json(response, 500);
    }
  });

  /**
   * GET /auth/pair/info/:code
   * Get pairing request info (requires authentication).
   */
  app.get(
    '/pair/info/:code',
    userAuthMiddleware,
    async (
      c: Context<{ Bindings: Env; Variables: UserContextVariables }>
    ) => {
      try {
        const code = c.req.param('code');

        const request = await c.env.DB.prepare(
          `SELECT device_name, cli_public_key, created_at, expires_at, status
           FROM pairing_requests
           WHERE pairing_code = ?`
        )
          .bind(code)
          .first<{
            device_name: string;
            cli_public_key: string;
            created_at: string;
            expires_at: string;
            status: string;
          }>();

        if (!request) {
          const response: ApiResponse = {
            success: false,
            error: 'Pairing request not found'
          };
          return c.json(response, 404);
        }

        // Check if expired
        if (new Date(request.expires_at) < new Date()) {
          const response: ApiResponse = {
            success: false,
            error: 'Pairing request has expired'
          };
          return c.json(response, 410);
        }

        // Check if already completed
        if (request.status !== 'pending') {
          const response: ApiResponse = {
            success: false,
            error: 'Pairing request is no longer pending'
          };
          return c.json(response, 410);
        }

        const response: ApiResponse<{
          device_name: string;
          public_key: string;
          created_at: string;
        }> = {
          success: true,
          data: {
            device_name: request.device_name,
            public_key: request.cli_public_key,
            created_at: request.created_at
          }
        };

        return c.json(response);
      } catch (error) {
        console.error('Pairing info error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to get pairing info'
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * POST /auth/pair/approve/:code
   * Approve pairing and send encrypted MEK (requires authentication).
   */
  app.post(
    '/pair/approve/:code',
    userAuthMiddleware,
    async (
      c: Context<{ Bindings: Env; Variables: UserContextVariables }>
    ) => {
      try {
        const code = c.req.param('code');
        const userId = c.get('userId');
        const body = await c.req.json<PairingApprovalRequest>();
        const { public_key, encrypted_mek } = body;

        if (!public_key || !encrypted_mek) {
          const response: ApiResponse = {
            success: false,
            error: 'public_key and encrypted_mek are required'
          };
          return c.json(response, 400);
        }

        if (!isValidEncryptedMEK(encrypted_mek)) {
          const response: ApiResponse = {
            success: false,
            error: 'Invalid encrypted_mek format'
          };
          return c.json(response, 400);
        }

        // Find and validate pairing request
        const request = await c.env.DB.prepare(
          `SELECT id, status, expires_at
           FROM pairing_requests
           WHERE pairing_code = ?`
        )
          .bind(code)
          .first<{
            id: string;
            status: string;
            expires_at: string;
          }>();

        if (!request) {
          const response: ApiResponse = {
            success: false,
            error: 'Pairing request not found'
          };
          return c.json(response, 404);
        }

        if (new Date(request.expires_at) < new Date()) {
          const response: ApiResponse = {
            success: false,
            error: 'Pairing request has expired'
          };
          return c.json(response, 410);
        }

        if (request.status !== 'pending') {
          const response: ApiResponse = {
            success: false,
            error: 'Pairing request is no longer pending'
          };
          return c.json(response, 410);
        }

        // Update pairing request with approval
        await c.env.DB.prepare(
          `UPDATE pairing_requests
           SET dash_public_key = ?,
               encrypted_mek = ?,
               status = 'completed',
               approved_by = ?
           WHERE id = ?`
        )
          .bind(
            public_key,
            JSON.stringify(encrypted_mek),
            userId,
            request.id
          )
          .run();

        const response: ApiResponse = {
          success: true,
          message: 'Pairing approved'
        };

        return c.json(response);
      } catch (error) {
        console.error('Pairing approval error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to approve pairing'
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * GET /auth/pair/status/:code
   * Poll for pairing completion (CLI calls this).
   */
  app.get('/pair/status/:code', async (c: Context<{ Bindings: Env }>) => {
    try {
      const code = c.req.param('code');

      const request = await c.env.DB.prepare(
        `SELECT status, dash_public_key, encrypted_mek, expires_at
         FROM pairing_requests
         WHERE pairing_code = ?`
      )
        .bind(code)
        .first<{
          status: string;
          dash_public_key: string | null;
          encrypted_mek: string | null;
          expires_at: string;
        }>();

      if (!request) {
        const response: ApiResponse = {
          success: false,
          error: 'Pairing request not found'
        };
        return c.json(response, 404);
      }

      // Check if expired
      if (new Date(request.expires_at) < new Date()) {
        const response: ApiResponse<{ status: string }> = {
          success: true,
          data: { status: 'expired' }
        };
        return c.json(response);
      }

      if (request.status === 'pending') {
        const response: ApiResponse<{ status: string }> = {
          success: true,
          data: { status: 'pending' }
        };
        return c.json(response);
      }

      if (request.status === 'completed') {
        // Parse encrypted MEK
        let encryptedMek: EncryptedMEK | null = null;
        if (request.encrypted_mek) {
          try {
            encryptedMek = JSON.parse(request.encrypted_mek);
          } catch {
            console.error('Failed to parse encrypted_mek');
          }
        }

        const response: ApiResponse<{
          status: string;
          public_key: string;
          encrypted_mek: EncryptedMEK | null;
        }> = {
          success: true,
          data: {
            status: 'completed',
            public_key: request.dash_public_key || '',
            encrypted_mek: encryptedMek
          }
        };

        return c.json(response);
      }

      // Unknown status
      const response: ApiResponse<{ status: string }> = {
        success: true,
        data: { status: request.status }
      };
      return c.json(response);
    } catch (error) {
      console.error('Pairing status error:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to get pairing status'
      };
      return c.json(response, 500);
    }
  });

  return app;
}

export const authRoutes = createAuthRoutes();
