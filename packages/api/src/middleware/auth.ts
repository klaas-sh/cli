/**
 * Authentication middleware.
 *
 * Validates JWT tokens and sets userId in context.
 */

import type { Context, Next } from 'hono';
import type { Env } from '../types';
import { verifyAccessToken } from '../services/jwt';

/**
 * Middleware to require valid JWT authentication.
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: { userId: string } }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-change-in-production';

  try {
    const payload = await verifyAccessToken(token, jwtSecret);
    c.set('userId', payload.sub);
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}
