/**
 * Dashboard Authentication Routes
 *
 * Handles user login and token verification for the dashboard.
 *
 * Routes:
 * - POST /dashboard/auth/login - Authenticate with email/password
 * - GET /dashboard/auth/check - Verify current token is valid
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../types';
import { generateTokens } from '../../services/jwt';
import {
  userAuthMiddleware,
  type UserContextVariables
} from '../../middleware/user-auth';

/** Login request body */
interface LoginRequest {
  email: string;
  password: string;
}

/** API response format */
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Verify password using Web Crypto API.
 * Uses PBKDF2 with SHA-256 for secure password hashing.
 */
async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  // Parse stored hash (format: salt:hash)
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) {
    return false;
  }

  // Derive key using PBKDF2
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  const derivedHash = bytesToHex(new Uint8Array(derivedBits));
  return derivedHash === hash;
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
 * Create dashboard auth routes.
 */
export function createAuthRoutes() {
  const app = new Hono<{
    Bindings: Env;
    Variables: UserContextVariables;
  }>();

  /**
   * POST /auth/login
   * Authenticate user with email and password.
   */
  app.post('/login', async (c: Context<{ Bindings: Env }>) => {
    try {
      const body = await c.req.json<LoginRequest>();
      const { email, password } = body;

      if (!email || !password) {
        const response: ApiResponse = {
          success: false,
          error: 'Email and password are required'
        };
        return c.json(response, 400);
      }

      // Find user by email
      const user = await c.env.DB.prepare(
        `SELECT id, email, password_hash FROM users WHERE email = ?`
      )
        .bind(email.toLowerCase())
        .first<{
          id: string;
          email: string;
          password_hash: string | null;
        }>();

      if (!user || !user.password_hash) {
        const response: ApiResponse = {
          success: false,
          error: 'Invalid email or password'
        };
        return c.json(response, 401);
      }

      // Verify password
      const isValid = await verifyPassword(password, user.password_hash);
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

      const response: ApiResponse<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; email: string };
      }> = {
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            email: user.email
          }
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

  return app;
}

export const authRoutes = createAuthRoutes();
