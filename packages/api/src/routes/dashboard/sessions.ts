/**
 * Dashboard Sessions Routes
 *
 * CRUD operations for user sessions.
 *
 * Routes:
 * - GET /dashboard/sessions - List user's sessions (paginated)
 * - GET /dashboard/sessions/:id - Get session by ID
 * - DELETE /dashboard/sessions/:id - End session
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, SessionListItem } from '../../types';
import {
  userAuthMiddleware,
  type UserContextVariables
} from '../../middleware/user-auth';

/** API response format */
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/** Paginated list response */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** Session detail response */
interface SessionDetail {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  status: 'attached' | 'detached';
  startedAt: string;
  attachedAt: string | null;
  detachedAt: string | null;
  cwd: string;
}

/**
 * Create dashboard sessions routes.
 */
export function createSessionsRoutes() {
  const app = new Hono<{
    Bindings: Env;
    Variables: UserContextVariables;
  }>();

  // Apply auth middleware to all routes
  app.use('*', userAuthMiddleware);

  /**
   * GET /sessions
   * List user's sessions with pagination.
   */
  app.get(
    '/',
    async (
      c: Context<{ Bindings: Env; Variables: UserContextVariables }>
    ) => {
      try {
        const userId = c.get('userId');
        const page = parseInt(c.req.query('page') ?? '1', 10);
        const limit = Math.min(
          parseInt(c.req.query('limit') ?? '20', 10),
          100
        );
        const status = c.req.query('status'); // Optional filter
        const offset = (page - 1) * limit;

        // Build query with optional status filter
        let query = `
          SELECT
            s.id as session_id,
            s.device_id,
            d.name as device_name,
            s.status,
            s.started_at,
            s.attached_at,
            s.cwd
          FROM sessions s
          JOIN devices d ON s.device_id = d.id
          WHERE s.user_id = ?
        `;
        const params: (string | number)[] = [userId];

        if (status === 'attached' || status === 'detached') {
          query += ' AND s.status = ?';
          params.push(status);
        }

        query += ' ORDER BY s.started_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const sessions = await c.env.DB.prepare(query)
          .bind(...params)
          .all<SessionListItem>();

        // Get total count
        let countQuery = `
          SELECT COUNT(*) as count FROM sessions s
          WHERE s.user_id = ?
        `;
        const countParams: string[] = [userId];

        if (status === 'attached' || status === 'detached') {
          countQuery += ' AND s.status = ?';
          countParams.push(status);
        }

        const countResult = await c.env.DB.prepare(countQuery)
          .bind(...countParams)
          .first<{ count: number }>();

        const total = countResult?.count ?? 0;

        const response: ApiResponse<PaginatedResponse<SessionListItem>> = {
          success: true,
          data: {
            items: sessions.results,
            total,
            page,
            limit,
            hasMore: offset + sessions.results.length < total
          }
        };

        return c.json(response);
      } catch (error) {
        console.error('List sessions error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to list sessions'
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * GET /sessions/:id
   * Get session by ID.
   */
  app.get(
    '/:id',
    async (
      c: Context<{ Bindings: Env; Variables: UserContextVariables }>
    ) => {
      try {
        const userId = c.get('userId');
        const sessionId = c.req.param('id');

        const session = await c.env.DB.prepare(
          `SELECT
            s.id as session_id,
            s.device_id,
            d.name as device_name,
            s.status,
            s.started_at,
            s.attached_at,
            s.detached_at,
            s.cwd
          FROM sessions s
          JOIN devices d ON s.device_id = d.id
          WHERE s.id = ? AND s.user_id = ?`
        )
          .bind(sessionId, userId)
          .first<{
            session_id: string;
            device_id: string;
            device_name: string;
            status: 'attached' | 'detached';
            started_at: string;
            attached_at: string | null;
            detached_at: string | null;
            cwd: string;
          }>();

        if (!session) {
          const response: ApiResponse = {
            success: false,
            error: 'Session not found'
          };
          return c.json(response, 404);
        }

        const response: ApiResponse<SessionDetail> = {
          success: true,
          data: {
            sessionId: session.session_id,
            deviceId: session.device_id,
            deviceName: session.device_name,
            status: session.status,
            startedAt: session.started_at,
            attachedAt: session.attached_at,
            detachedAt: session.detached_at,
            cwd: session.cwd
          }
        };

        return c.json(response);
      } catch (error) {
        console.error('Get session error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to get session'
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * DELETE /sessions/:id
   * End (detach) a session.
   */
  app.delete(
    '/:id',
    async (
      c: Context<{ Bindings: Env; Variables: UserContextVariables }>
    ) => {
      try {
        const userId = c.get('userId');
        const sessionId = c.req.param('id');

        const result = await c.env.DB.prepare(
          `UPDATE sessions
          SET status = 'detached', detached_at = datetime('now')
          WHERE id = ? AND user_id = ?`
        )
          .bind(sessionId, userId)
          .run();

        if (result.meta.changes === 0) {
          const response: ApiResponse = {
            success: false,
            error: 'Session not found'
          };
          return c.json(response, 404);
        }

        const response: ApiResponse = {
          success: true,
          message: 'Session ended successfully'
        };

        return c.json(response);
      } catch (error) {
        console.error('Delete session error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to end session'
        };
        return c.json(response, 500);
      }
    }
  );

  return app;
}

export const sessionsRoutes = createSessionsRoutes();
