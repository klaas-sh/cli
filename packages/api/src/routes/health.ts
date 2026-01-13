/**
 * Health check routes.
 */

import { Hono } from 'hono';
import type { Env } from '../types';

export const healthRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /health
 * Basic health check endpoint.
 */
healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT,
  });
});

/**
 * GET /health/db
 * Database connectivity check.
 */
healthRoutes.get('/db', async (c) => {
  try {
    const result = await c.env.DB.prepare('SELECT 1 as ok').first();
    return c.json({
      status: 'ok',
      database: result ? 'connected' : 'error',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(
      {
        status: 'error',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});
