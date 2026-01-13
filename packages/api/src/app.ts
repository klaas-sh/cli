/**
 * Hono application setup for Nexo API.
 *
 * Routes:
 * - /v1/* - Public API endpoints
 * - /auth/* - Authentication endpoints (OAuth Device Flow)
 * - /sessions/* - Session management (authenticated)
 * - /ws - WebSocket upgrade endpoint
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';
import { authRoutes } from './routes/auth';
import { sessionsRoutes } from './routes/sessions';
import { healthRoutes } from './routes/health';

/** Hono app type with environment bindings */
export type AppType = Hono<{ Bindings: Env }>;

/**
 * Creates and configures the Hono application.
 */
export function createApp(): AppType {
  const app = new Hono<{ Bindings: Env }>();

  // Global middleware
  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://nexo.dev',
        'https://app.nexo.dev',
        'https://admin.nexo.dev',
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Device-ID', 'X-Session-ID'],
      credentials: true,
    })
  );

  // Health check (no auth required)
  app.route('/health', healthRoutes);

  // Authentication routes (OAuth Device Flow)
  app.route('/auth', authRoutes);

  // Session management routes (authenticated)
  app.route('/sessions', sessionsRoutes);

  // Root endpoint
  app.get('/', (c) => {
    return c.json({
      name: 'Nexo API',
      version: c.env.API_VERSION,
      environment: c.env.ENVIRONMENT,
    });
  });

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: 'Not Found', path: c.req.path }, 404);
  });

  // Error handler
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json(
      {
        error: 'Internal Server Error',
        message: c.env.ENVIRONMENT === 'development' ? err.message : undefined,
      },
      500
    );
  });

  return app;
}
