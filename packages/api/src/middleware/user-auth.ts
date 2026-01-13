/**
 * User Authentication Middleware for Dashboard
 *
 * Validates user JWT tokens and adds user info to context.
 * Used for dashboard routes where users authenticate with email/password.
 */

import type { Context, Next } from 'hono';
import type { Env } from '../types';
import { verifyAccessToken } from '../services/jwt';

/**
 * User context variables added by authentication middleware.
 */
export interface UserContextVariables {
  /** User ID from JWT */
  userId: string;
  /** User email from JWT (if available) */
  userEmail?: string;
}

/**
 * User authentication middleware.
 *
 * Validates JWT tokens from Authorization header and sets user info
 * in context. Returns 401 if token is missing or invalid.
 */
export async function userAuthMiddleware(
  c: Context<{ Bindings: Env; Variables: UserContextVariables }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      { success: false, error: 'Unauthorized' },
      401
    );
  }

  const token = authHeader.slice(7);
  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-change-in-production';

  try {
    const payload = await verifyAccessToken(token, jwtSecret);

    // Verify user exists in database
    const user = await c.env.DB.prepare(
      `SELECT id, email FROM users WHERE id = ?`
    )
      .bind(payload.sub)
      .first<{ id: string; email: string }>();

    if (!user) {
      return c.json(
        { success: false, error: 'User not found' },
        401
      );
    }

    c.set('userId', user.id);
    c.set('userEmail', user.email);

    await next();
  } catch (error) {
    console.error('User auth middleware error:', error);
    return c.json(
      { success: false, error: 'Invalid token' },
      401
    );
  }
}
