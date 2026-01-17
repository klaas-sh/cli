/**
 * Hooks API routes for CLI hook notifications.
 *
 * Hooks are shell commands that AI coding agents (Claude Code, Gemini CLI)
 * spawn when events occur. These routes receive notifications from those
 * hooks and forward them to connected Dashboard clients via WebSocket.
 *
 * POST /v1/hooks/notification - Receive hook notification from CLI
 */

import { Hono } from 'hono';
import type { Env, HookNotification } from '../types';

/** Hooks router */
export const hooksRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /v1/hooks/notification
 *
 * Receives a hook notification from the CLI and forwards it to the
 * SessionHub Durable Object, which broadcasts it to connected web clients.
 *
 * Request body:
 * {
 *   "session_id": "01ABC...",
 *   "event": "permission",
 *   "tool": "Bash",
 *   "message": "npm install"
 * }
 *
 * Authentication: Bearer token (optional for now, will be required)
 */
hooksRoutes.post('/notification', async (c) => {
  try {
    const body = await c.req.json<HookNotification>();

    // Validate required fields
    if (!body.session_id) {
      return c.json({ error: 'session_id is required' }, 400);
    }
    if (!body.event) {
      return c.json({ error: 'event is required' }, 400);
    }

    // Get the SessionHub Durable Object for this session
    const sessionHubId = c.env.SESSION_HUB.idFromName(body.session_id);
    const sessionHub = c.env.SESSION_HUB.get(sessionHubId);

    // Forward the notification to the SessionHub
    const response = await sessionHub.fetch(
      new Request('https://internal/notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: body.event,
          tool: body.tool,
          message: body.message,
          timestamp: new Date().toISOString(),
        }),
      })
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('[Hooks] Failed to forward notification:', error);
      return c.json({ error: 'Failed to forward notification' }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('[Hooks] Error processing notification:', error);
    return c.json({ error: 'Invalid request' }, 400);
  }
});
