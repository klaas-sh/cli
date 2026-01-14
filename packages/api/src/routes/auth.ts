/**
 * Authentication routes - OAuth Device Flow (RFC 8628).
 *
 * Flow:
 * 1. CLI calls POST /auth/device to get device_code and user_code
 * 2. User visits verification_uri and enters user_code
 * 3. CLI polls POST /auth/token with device_code until authorized
 * 4. On success, CLI receives access_token and refresh_token
 */

import { Hono } from 'hono';
import { ulid } from 'ulid';
import type { Env, DeviceCode, TokenResponse } from '../types';
import {
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken
} from '../services/jwt';

export const authRoutes = new Hono<{ Bindings: Env }>();

/** Device code expiration in seconds */
const DEVICE_CODE_EXPIRES_IN = 600; // 10 minutes

/** Polling interval in seconds */
const POLLING_INTERVAL = 5;

/**
 * POST /auth/device
 * Request a device code for OAuth Device Flow.
 *
 * Response:
 * - device_code: Unique code for polling
 * - user_code: User-facing code to enter (e.g., "ABCD-1234")
 * - verification_uri: URL where user enters the code
 * - expires_in: Seconds until code expires
 * - interval: Polling interval in seconds
 */
authRoutes.post('/device', async (c) => {
  // Generate unique device code
  const deviceCode = ulid();

  // Generate user-friendly code (8 chars, formatted as XXXX-XXXX)
  const userCodeRaw = generateUserCode();
  const userCode = `${userCodeRaw.slice(0, 4)}-${userCodeRaw.slice(4)}`;

  // Store in KV with expiration
  const codeData = {
    device_code: deviceCode,
    user_code: userCode,
    created_at: Date.now(),
    authorized: false,
    user_id: null as string | null,
  };

  await c.env.CACHE_KV.put(`device_code:${deviceCode}`, JSON.stringify(codeData), {
    expirationTtl: DEVICE_CODE_EXPIRES_IN,
  });

  // Also index by user code for lookup during authorization
  await c.env.CACHE_KV.put(`user_code:${userCode}`, deviceCode, {
    expirationTtl: DEVICE_CODE_EXPIRES_IN,
  });

  // Use DASHBOARD_URL from environment or fall back to defaults
  const dashboardUrl = c.env.DASHBOARD_URL
    || (c.env.ENVIRONMENT === 'production'
      ? 'https://app.nexo.dev'
      : 'http://localhost:3001');
  const verificationUri = `${dashboardUrl}/device`;
  const verificationUriComplete = `${dashboardUrl}/device/${userCode}`;

  const response: DeviceCode = {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: DEVICE_CODE_EXPIRES_IN,
    interval: POLLING_INTERVAL,
  };

  return c.json(response);
});

/**
 * POST /auth/token
 * Poll for token after user authorization.
 *
 * Request body:
 * - device_code: The device code from /auth/device
 * - grant_type: Must be "urn:ietf:params:oauth:grant-type:device_code"
 *
 * Response (success):
 * - access_token: JWT for API access
 * - token_type: "Bearer"
 * - expires_in: Token lifetime in seconds
 * - refresh_token: Token for renewal
 *
 * Response (pending):
 * - error: "authorization_pending"
 *
 * Response (expired):
 * - error: "expired_token"
 */
authRoutes.post('/token', async (c) => {
  const body = await c.req.json<{ device_code: string; grant_type: string }>();

  // Validate grant type
  if (body.grant_type !== 'urn:ietf:params:oauth:grant-type:device_code') {
    return c.json({ error: 'unsupported_grant_type' }, 400);
  }

  // Look up device code
  const codeDataStr = await c.env.CACHE_KV.get(`device_code:${body.device_code}`);
  if (!codeDataStr) {
    return c.json({ error: 'expired_token' }, 400);
  }

  const codeData = JSON.parse(codeDataStr) as {
    device_code: string;
    user_code: string;
    created_at: number;
    authorized: boolean;
    user_id: string | null;
  };

  // Check if authorization is pending
  if (!codeData.authorized || !codeData.user_id) {
    return c.json({ error: 'authorization_pending' }, 400);
  }

  // Generate tokens
  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-change-in-production';
  const tokens = await generateTokens(codeData.user_id, jwtSecret);

  // Clean up device code
  await c.env.CACHE_KV.delete(`device_code:${body.device_code}`);
  await c.env.CACHE_KV.delete(`user_code:${codeData.user_code}`);

  const response: TokenResponse = {
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: 3600, // 1 hour
    refresh_token: tokens.refreshToken,
  };

  return c.json(response);
});

/**
 * POST /auth/refresh
 * Refresh an expired access token.
 *
 * Request body:
 * - refresh_token: The refresh token
 *
 * Response:
 * - access_token: New JWT
 * - token_type: "Bearer"
 * - expires_in: Token lifetime in seconds
 * - refresh_token: New refresh token
 */
authRoutes.post('/refresh', async (c) => {
  const body = await c.req.json<{ refresh_token: string }>();

  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-change-in-production';

  try {
    const payload = await verifyRefreshToken(body.refresh_token, jwtSecret);
    const tokens = await generateTokens(payload.sub, jwtSecret);

    const response: TokenResponse = {
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: tokens.refreshToken,
    };

    return c.json(response);
  } catch {
    return c.json({ error: 'invalid_grant' }, 400);
  }
});

/**
 * POST /auth/authorize
 * Authorize a device code (called by dashboard after user logs in).
 *
 * Requires: Authorization header with valid JWT
 *
 * Request body:
 * - user_code: The user-facing code (e.g., "XXXX-XXXX")
 */
authRoutes.post('/authorize', async (c) => {
  // Extract and verify JWT from Authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-change-in-production';

  let userId: string;
  try {
    const payload = await verifyAccessToken(token, jwtSecret);
    userId = payload.sub;
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const body = await c.req.json<{ user_code: string }>();

  // Look up device code by user code
  const deviceCode = await c.env.CACHE_KV.get(`user_code:${body.user_code}`);
  if (!deviceCode) {
    return c.json({ error: 'invalid_code' }, 400);
  }

  // Get code data
  const codeDataStr = await c.env.CACHE_KV.get(`device_code:${deviceCode}`);
  if (!codeDataStr) {
    return c.json({ error: 'expired_code' }, 400);
  }

  // Update with authorization
  const codeData = JSON.parse(codeDataStr);
  codeData.authorized = true;
  codeData.user_id = userId;

  await c.env.CACHE_KV.put(
    `device_code:${deviceCode}`,
    JSON.stringify(codeData),
    { expirationTtl: DEVICE_CODE_EXPIRES_IN }
  );

  return c.json({ success: true });
});

/**
 * Generate a random user-friendly code (8 uppercase letters/numbers).
 * Excludes confusing characters: 0, O, I, L, 1
 */
function generateUserCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
