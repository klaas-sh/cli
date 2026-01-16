/**
 * Hono application setup for Klaas API.
 *
 * Routes:
 * - /v1/* - Public API endpoints
 * - /auth/* - Authentication endpoints (OAuth Device Flow)
 * - /sessions/* - Session management (authenticated)
 * - /dashboard/* - Dashboard routes (user authentication)
 * - /ws - WebSocket upgrade endpoint
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';
import { authRoutes } from './routes/auth';
import { encryptionRoutes } from './routes/encryption';
import { hooksRoutes } from './routes/hooks';
import { sessionsRoutes } from './routes/sessions';
import { healthRoutes } from './routes/health';
import { dashboardRoutes } from './routes/dashboard/index';

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
      origin: (origin) => {
        // Allow any localhost port in development
        if (origin && origin.match(/^http:\/\/localhost:\d+$/)) {
          return origin;
        }
        // Production origins
        const allowedOrigins = [
          'https://klaas.sh',
          'https://app.klaas.sh',
          'https://admin.klaas.sh',
        ];
        return allowedOrigins.includes(origin) ? origin : null;
      },
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

  // Encryption key management routes (authenticated)
  app.route('/v1/users/me/encryption-key', encryptionRoutes);

  // Hooks routes (CLI hook notifications)
  app.route('/v1/hooks', hooksRoutes);

  // Dashboard routes (user authentication)
  app.route('/dashboard', dashboardRoutes);

  // Root endpoint
  app.get('/', (c) => {
    return c.json({
      name: 'Klaas API',
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
