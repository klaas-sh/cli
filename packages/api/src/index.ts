/**
 * Nexo API - Cloudflare Worker entry point.
 *
 * Exports:
 * - default: Fetch handler for HTTP requests
 * - SessionHub: Durable Object for WebSocket management
 */

import { createApp } from './app';
import { verifyAccessToken } from './services/jwt';
import type { Env } from './types';

// Re-export Durable Objects
export { SessionHub } from './durable-objects/session-hub';

const app = createApp();

export default {
  /**
   * Handle incoming HTTP requests.
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Handle WebSocket upgrade requests
    if (request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocketUpgrade(request, env);
    }

    // Handle regular HTTP requests
    return app.fetch(request, env, ctx);
  },
};

/**
 * Handle WebSocket upgrade requests by routing to the SessionHub Durable Object.
 * Creates/updates device and session records in D1 for CLI connections.
 */
async function handleWebSocketUpgrade(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);

  // Validate JWT and extract user ID
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const token = authHeader.slice(7);
  const jwtSecret = env.JWT_SECRET || 'dev-secret-change-in-production';

  let userId: string;
  try {
    const payload = await verifyAccessToken(token, jwtSecret);
    userId = payload.sub;
  } catch {
    return new Response('Invalid token', { status: 401 });
  }

  // Get session ID from query param or header
  const sessionId = url.searchParams.get('session_id') ||
    request.headers.get('X-Session-ID');

  if (!sessionId) {
    return new Response('Missing session_id', { status: 400 });
  }

  // Get client type (cli or web)
  const clientType = url.searchParams.get('client') || 'cli';

  // For CLI connections, create device and session records in D1
  if (clientType === 'cli') {
    const deviceId = url.searchParams.get('device_id');
    const deviceName = url.searchParams.get('device_name') || 'Unknown';
    const cwd = url.searchParams.get('cwd') || '/';

    if (!deviceId) {
      return new Response('Missing device_id', { status: 400 });
    }

    try {
      // Upsert device (create or update last_seen_at)
      await env.DB.prepare(`
        INSERT INTO devices (id, user_id, name, public_key, last_seen_at)
        VALUES (?, ?, ?, '', datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          last_seen_at = datetime('now'),
          name = excluded.name
      `).bind(deviceId, userId, deviceName).run();

      // Create session record (or update if reconnecting)
      await env.DB.prepare(`
        INSERT INTO sessions (id, user_id, device_id, status, cwd, attached_at)
        VALUES (?, ?, ?, 'attached', ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = 'attached',
          attached_at = datetime('now'),
          detached_at = NULL
      `).bind(sessionId, userId, deviceId, cwd).run();
    } catch (error) {
      console.error('Failed to create device/session in D1:', error);
      // Continue anyway - session will work via Durable Object
    }
  }

  // Route to the SessionHub Durable Object for this session
  // Each session gets its own Durable Object instance
  const hubId = env.SESSION_HUB.idFromName(sessionId);
  const hub = env.SESSION_HUB.get(hubId);

  // Forward the request to the Durable Object
  return hub.fetch(request);
}
