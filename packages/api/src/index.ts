/**
 * Nexo API - Cloudflare Worker entry point.
 *
 * Exports:
 * - default: Fetch handler for HTTP requests
 * - SessionHub: Durable Object for WebSocket management
 */

import { createApp } from './app';
import type { Env } from './types';

// Re-export Durable Objects
export { SessionHub } from './durable-objects/session-hub';

const app = createApp();

export default {
  /**
   * Handle incoming HTTP requests.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
 */
async function handleWebSocketUpgrade(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Get user ID from JWT (will be validated in the Durable Object)
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Get session ID from query param or header
  const sessionId = url.searchParams.get('session_id') ||
    request.headers.get('X-Session-ID');

  if (!sessionId) {
    return new Response('Missing session_id', { status: 400 });
  }

  // Route to the SessionHub Durable Object for this session
  // Each session gets its own Durable Object instance
  const hubId = env.SESSION_HUB.idFromName(sessionId);
  const hub = env.SESSION_HUB.get(hubId);

  // Forward the request to the Durable Object
  return hub.fetch(request);
}
