import { describe, it, expect } from 'vitest';
import {
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
} from './jwt';

const TEST_SECRET = 'test-secret-key-for-jwt-testing';
const TEST_USER_ID = '01HQXK7V8G3N5M2R4P6T1W9Y0Z';

describe('JWT Service', () => {
  describe('generateTokens', () => {
    it('should generate access and refresh tokens', async () => {
      const tokens = await generateTokens(TEST_USER_ID, TEST_SECRET);

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(typeof tokens.accessToken).toBe('string');
      expect(typeof tokens.refreshToken).toBe('string');
    });

    it('should generate different tokens for different users', async () => {
      const tokens1 = await generateTokens('user1', TEST_SECRET);
      const tokens2 = await generateTokens('user2', TEST_SECRET);

      expect(tokens1.accessToken).not.toBe(tokens2.accessToken);
      expect(tokens1.refreshToken).not.toBe(tokens2.refreshToken);
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify valid access token', async () => {
      const tokens = await generateTokens(TEST_USER_ID, TEST_SECRET);
      const payload = await verifyAccessToken(tokens.accessToken, TEST_SECRET);

      expect(payload.sub).toBe(TEST_USER_ID);
      expect(payload.type).toBe('access');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it('should reject invalid token', async () => {
      await expect(
        verifyAccessToken('invalid-token', TEST_SECRET)
      ).rejects.toThrow();
    });

    it('should reject token with wrong secret', async () => {
      const tokens = await generateTokens(TEST_USER_ID, TEST_SECRET);

      await expect(
        verifyAccessToken(tokens.accessToken, 'wrong-secret')
      ).rejects.toThrow();
    });

    it('should reject refresh token as access token', async () => {
      const tokens = await generateTokens(TEST_USER_ID, TEST_SECRET);

      await expect(
        verifyAccessToken(tokens.refreshToken, TEST_SECRET)
      ).rejects.toThrow('Invalid token type');
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify valid refresh token', async () => {
      const tokens = await generateTokens(TEST_USER_ID, TEST_SECRET);
      const payload = await verifyRefreshToken(tokens.refreshToken, TEST_SECRET);

      expect(payload.sub).toBe(TEST_USER_ID);
      expect(payload.type).toBe('refresh');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it('should reject invalid token', async () => {
      await expect(
        verifyRefreshToken('invalid-token', TEST_SECRET)
      ).rejects.toThrow();
    });

    it('should reject access token as refresh token', async () => {
      const tokens = await generateTokens(TEST_USER_ID, TEST_SECRET);

      await expect(
        verifyRefreshToken(tokens.accessToken, TEST_SECRET)
      ).rejects.toThrow('Invalid token type');
    });
  });
});
