/**
 * Dashboard Routes Aggregator
 *
 * Combines all dashboard routes under a single router.
 *
 * Routes:
 * - /dashboard/auth/* - Authentication routes
 * - /dashboard/sessions/* - Session management routes
 * - /dashboard/support/* - Support ticket routes
 * - /dashboard/profile - User profile
 */

import { Hono } from 'hono';
import type { Env } from '../../types';
import type { UserContextVariables } from '../../middleware/user-auth';
import { userAuthMiddleware } from '../../middleware/user-auth';
import { authRoutes } from './auth';
import { sessionsRoutes } from './sessions';
import supportRoutes from './support';

/**
 * Create dashboard routes.
 */
export function createDashboardRoutes() {
  const app = new Hono<{
    Bindings: Env;
    Variables: UserContextVariables;
  }>();

  // Mount auth routes
  app.route('/auth', authRoutes);

  // Mount sessions routes
  app.route('/sessions', sessionsRoutes);

  // Mount support routes
  app.route('/support', supportRoutes);

  /**
   * GET /dashboard/profile
   * Get current user's profile
   */
  app.get('/profile', userAuthMiddleware, async (c) => {
    try {
      const userId = c.get('userId');

      const user = await c.env.DB.prepare(
        `SELECT id, email, created_at FROM users WHERE id = ?`
      )
        .bind(userId)
        .first<{
          id: string;
          email: string;
          created_at: string;
        }>();

      if (!user) {
        return c.json({
          success: false,
          error: 'User not found',
        }, 404);
      }

      return c.json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          createdAt: user.created_at,
        },
      });
    } catch (error) {
      console.error('Profile fetch error:', error);
      return c.json({
        success: false,
        error: 'Failed to fetch profile',
      }, 500);
    }
  });

  return app;
}

export const dashboardRoutes = createDashboardRoutes();
