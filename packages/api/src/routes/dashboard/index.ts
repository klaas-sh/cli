/**
 * Dashboard Routes Aggregator
 *
 * Combines all dashboard routes under a single router.
 *
 * Routes:
 * - /dashboard/auth/* - Authentication routes
 * - /dashboard/sessions/* - Session management routes
 */

import { Hono } from 'hono';
import type { Env } from '../../types';
import type { UserContextVariables } from '../../middleware/user-auth';
import { authRoutes } from './auth';
import { sessionsRoutes } from './sessions';

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

  return app;
}

export const dashboardRoutes = createDashboardRoutes();
