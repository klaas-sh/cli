/**
 * Session management routes.
 *
 * All routes require authentication via JWT.
 */

import { Hono } from 'hono';
import type { Env, SessionListItem } from '../types';
import { authMiddleware } from '../middleware/auth';

export const sessionsRoutes = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

// Apply auth middleware to all routes
sessionsRoutes.use('*', authMiddleware);

/**
 * GET /sessions
 * List all sessions for the authenticated user.
 */
sessionsRoutes.get('/', async (c) => {
  const userId = c.get('userId');

  const sessions = await c.env.DB.prepare(
    `SELECT
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
    ORDER BY s.started_at DESC
    LIMIT 100`
  )
    .bind(userId)
    .all<SessionListItem>();

  return c.json({ sessions: sessions.results });
});

/**
 * GET /sessions/:id
 * Get details of a specific session.
 */
sessionsRoutes.get('/:id', async (c) => {
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
    .first();

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json(session);
});

/**
 * DELETE /sessions/:id
 * Terminate a session.
 */
sessionsRoutes.delete('/:id', async (c) => {
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
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json({ success: true });
});
