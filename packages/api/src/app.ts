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

  // Root endpoint - styled landing page
  app.get('/', (c) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">
  <title>klaas API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #09090b;
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      background-size: 64px 64px;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      color: #fafafa;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .logo {
      display: flex;
      justify-content: center;
      margin-bottom: 1rem;
    }
    .logo svg {
      width: 64px;
      height: 64px;
    }
    .title {
      font-size: 2.5rem;
      font-weight: 700;
      color: #f59e0b;
      margin-bottom: 0.5rem;
      letter-spacing: -0.02em;
    }
    .subtitle {
      font-size: 1rem;
      color: #a1a1aa;
      margin-bottom: 2rem;
    }
    a {
      color: #f59e0b;
      text-decoration: none;
      font-size: 0.875rem;
      padding: 0.5rem 1rem;
      border: 1px solid rgba(245, 158, 11, 0.3);
      border-radius: 6px;
      transition: all 0.2s ease;
    }
    a:hover {
      background: rgba(245, 158, 11, 0.1);
      border-color: #f59e0b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="3" width="20" height="18" rx="2" fill="#92400e"/>
        <rect x="2" y="3" width="20" height="4" rx="2" fill="#f59e0b"/>
        <rect x="2" y="5" width="20" height="2" fill="#f59e0b"/>
        <path d="M6 11L10 14.5L6 18" stroke="#fef3c7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M13 18H18" stroke="#fef3c7" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="title">klaas</div>
    <div class="subtitle">Remote Terminal Access</div>
    <a href="https://klaas.sh">klaas.sh</a>
  </div>
</body>
</html>`.trim();

    return c.html(html);
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
