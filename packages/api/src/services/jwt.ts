/**
 * JWT token generation and verification.
 */

import * as jose from 'jose';
import type { JwtPayload } from '../types';

/** Access token expiration (1 hour) */
const ACCESS_TOKEN_EXPIRY = '1h';

/** Refresh token expiration (30 days) */
const REFRESH_TOKEN_EXPIRY = '30d';

/**
 * Generate access and refresh tokens for a user.
 */
export async function generateTokens(
  userId: string,
  secret: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const secretKey = new TextEncoder().encode(secret);

  const accessToken = await new jose.SignJWT({ type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secretKey);

  const refreshToken = await new jose.SignJWT({ type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(secretKey);

  return { accessToken, refreshToken };
}

/**
 * Verify an access token and return the payload.
 */
export async function verifyAccessToken(
  token: string,
  secret: string
): Promise<JwtPayload> {
  const secretKey = new TextEncoder().encode(secret);
  const { payload } = await jose.jwtVerify(token, secretKey);

  if (payload.type !== 'access') {
    throw new Error('Invalid token type');
  }

  return payload as unknown as JwtPayload;
}

/**
 * Verify a refresh token and return the payload.
 */
export async function verifyRefreshToken(
  token: string,
  secret: string
): Promise<JwtPayload> {
  const secretKey = new TextEncoder().encode(secret);
  const { payload } = await jose.jwtVerify(token, secretKey);

  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  return payload as unknown as JwtPayload;
}
