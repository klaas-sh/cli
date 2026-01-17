import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from './app';
import type { Env } from './types';

/**
 * Generic JSON response type for tests.
 */
interface JsonResponse {
  name?: string;
  version?: string;
  environment?: string;
  status?: string;
  timestamp?: string;
  database?: unknown;
  error?: string;
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
}

/**
 * Mock KV namespace for testing.
 */
const mockKV = {
  get: async () => null,
  put: async () => undefined,
  delete: async () => undefined,
  list: async () => ({ keys: [], list_complete: true, cursor: '' }),
} as unknown as KVNamespace;

/**
 * Mock D1 database for testing.
 */
const mockDB = {
  prepare: () => ({
    bind: () => ({
      first: async () => null,
      all: async () => ({ results: [], success: true }),
      run: async () => ({ success: true, meta: { changes: 0 } }),
    }),
    first: async () => null,
    all: async () => ({ results: [], success: true }),
    run: async () => ({ success: true, meta: { changes: 0 } }),
  }),
  batch: async () => [],
  exec: async () => ({ results: [], success: true }),
} as unknown as D1Database;

/**
 * Mock Durable Object namespace for testing.
 */
const mockDurableObject = {
  idFromName: () => ({ toString: () => 'mock-id' }),
  get: () => ({
    fetch: async () => new Response('OK'),
  }),
} as unknown as DurableObjectNamespace;

/**
 * Mock environment for testing.
 */
const mockEnv: Env = {
  DB: mockDB,
  RATE_LIMIT_KV: mockKV,
  CACHE_KV: mockKV,
  SESSION_HUB: mockDurableObject,
  ENVIRONMENT: 'development',
  API_VERSION: 'v1',
  JWT_SECRET: 'test-secret',
};

describe('Klaas API', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  describe('Root endpoint', () => {
    it('should return styled landing page', async () => {
      const request = new Request('http://localhost/');
      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();
      expect(html).toContain('klaas');
      expect(html).toContain('Remote Terminal Access');
      expect(html).toContain('https://klaas.sh');
    });
  });

  describe('Health endpoints', () => {
    it('should return health status', async () => {
      const request = new Request('http://localhost/health');
      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(200);

      const data = await response.json() as JsonResponse;
      expect(data.status).toBe('ok');
      expect(data.environment).toBe('development');
      expect(data.timestamp).toBeDefined();
    });

    it('should return database health status', async () => {
      const request = new Request('http://localhost/health/db');
      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(200);

      const data = await response.json() as JsonResponse;
      expect(data.status).toBe('ok');
      expect(data.database).toBeDefined();
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const request = new Request('http://localhost/unknown');
      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(404);

      const data = await response.json() as JsonResponse;
      expect(data.error).toBe('Not Found');
    });
  });

  describe('CORS handling', () => {
    it('should handle CORS preflight requests', async () => {
      const request = new Request('http://localhost/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'GET',
        },
      });

      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
        'http://localhost:3000'
      );
    });
  });
});

describe('Auth endpoints', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  describe('POST /auth/device', () => {
    it('should return device code for OAuth flow', async () => {
      const request = new Request('http://localhost/auth/device', {
        method: 'POST',
      });

      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(200);

      const data = await response.json() as JsonResponse;
      expect(data.device_code).toBeDefined();
      expect(data.user_code).toBeDefined();
      expect(data.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(data.verification_uri).toBeDefined();
      expect(data.expires_in).toBe(600);
      expect(data.interval).toBe(5);
    });
  });

  describe('POST /auth/token', () => {
    it('should reject invalid grant type', async () => {
      const request = new Request('http://localhost/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_code: 'test-device-code',
          grant_type: 'invalid',
        }),
      });

      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(400);

      const data = await response.json() as JsonResponse;
      expect(data.error).toBe('unsupported_grant_type');
    });

    it('should return expired_token for unknown device code', async () => {
      const request = new Request('http://localhost/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_code: 'unknown-device-code',
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(400);

      const data = await response.json() as JsonResponse;
      expect(data.error).toBe('expired_token');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should reject invalid refresh token', async () => {
      const request = new Request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh_token: 'invalid-token',
        }),
      });

      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(400);

      const data = await response.json() as JsonResponse;
      expect(data.error).toBe('invalid_grant');
    });
  });
});

describe('Sessions endpoints', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  describe('GET /sessions', () => {
    it('should require authentication', async () => {
      const request = new Request('http://localhost/sessions');

      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(401);

      const data = await response.json() as JsonResponse;
      expect(data.error).toContain('Authorization');
    });

    it('should reject invalid token', async () => {
      const request = new Request('http://localhost/sessions', {
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      });

      const response = await app.fetch(request, mockEnv, {} as ExecutionContext);

      expect(response.status).toBe(401);

      const data = await response.json() as JsonResponse;
      expect(data.error).toContain('Invalid');
    });
  });
});
