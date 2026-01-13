/**
 * Dashboard routes for web client authentication and session access.
 *
 * These routes are used by the dashboard web application to:
 * - Authenticate users via GitHub OAuth
 * - Access session information
 * - Manage user settings
 */

import { Hono } from 'hono';
import type { Env, SessionListItem } from '../types';
import { authMiddleware } from '../middleware/auth';

export const dashboardRoutes = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

/**
 * GET /dashboard/sessions
 * List all sessions for the authenticated user (dashboard view).
 * Includes additional metadata for the web interface.
 */
dashboardRoutes.get('/sessions', authMiddleware, async (c) => {
  const userId = c.get('userId');

  const sessions = await c.env.DB.prepare(
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
    WHERE s.user_id = ?
    ORDER BY s.started_at DESC
    LIMIT 100`
  )
    .bind(userId)
    .all<SessionListItem & { detached_at: string | null }>();

  return c.json({
    sessions: sessions.results,
    count: sessions.results.length,
  });
});

/**
 * GET /dashboard/sessions/:id
 * Get detailed session information for the dashboard.
 */
dashboardRoutes.get('/sessions/:id', authMiddleware, async (c) => {
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
 * GET /dashboard/devices
 * List all devices for the authenticated user.
 */
dashboardRoutes.get('/devices', authMiddleware, async (c) => {
  const userId = c.get('userId');

  const devices = await c.env.DB.prepare(
    `SELECT
      id,
      name,
      created_at,
      last_seen_at
    FROM devices
    WHERE user_id = ?
    ORDER BY last_seen_at DESC
    LIMIT 100`
  )
    .bind(userId)
    .all();

  return c.json({
    devices: devices.results,
    count: devices.results.length,
  });
});

/**
 * GET /dashboard/me
 * Get current user information.
 */
dashboardRoutes.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');

  const user = await c.env.DB.prepare(
    `SELECT
      id,
      github_username,
      email,
      created_at
    FROM users
    WHERE id = ?`
  )
    .bind(userId)
    .first();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Get session and device counts
  const stats = await c.env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM sessions WHERE user_id = ?) as session_count,
      (SELECT COUNT(*) FROM devices WHERE user_id = ?) as device_count,
      (SELECT COUNT(*) FROM sessions
        WHERE user_id = ? AND status = 'attached') as active_sessions`
  )
    .bind(userId, userId, userId)
    .first<{
      session_count: number;
      device_count: number;
      active_sessions: number;
    }>();

  return c.json({
    user,
    stats: {
      sessionCount: stats?.session_count ?? 0,
      deviceCount: stats?.device_count ?? 0,
      activeSessions: stats?.active_sessions ?? 0,
    },
  });
});

/**
 * DELETE /dashboard/devices/:id
 * Remove a device from the user's account.
 */
dashboardRoutes.delete('/devices/:id', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const deviceId = c.req.param('id');

  // First terminate all sessions for this device
  await c.env.DB.prepare(
    `UPDATE sessions
    SET status = 'detached', detached_at = datetime('now')
    WHERE device_id = ? AND user_id = ? AND status = 'attached'`
  )
    .bind(deviceId, userId)
    .run();

  // Then delete the device
  const result = await c.env.DB.prepare(
    `DELETE FROM devices WHERE id = ? AND user_id = ?`
  )
    .bind(deviceId, userId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Device not found' }, 404);
  }

  return c.json({ success: true });
});
