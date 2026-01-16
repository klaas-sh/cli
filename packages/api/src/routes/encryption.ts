/**
 * Encryption key management routes.
 *
 * Handles storage and retrieval of the user's encrypted Master Encryption Key
 * (MEK). The server never sees the unencrypted MEK - it is encrypted
 * client-side with a device-specific key.
 *
 * The MEK is stored server-side for backup/sync across devices. Each device
 * encrypts the MEK with its own key before storage, enabling transparent
 * auto E2EE without password flows.
 *
 * All routes require authentication via JWT.
 */

import { Hono } from 'hono';
import type { Env, StoredMEK, UserWithEncryption } from '../types';
import { authMiddleware } from '../middleware/auth';
import { isValidStoredMEK } from '../services/crypto';

export const encryptionRoutes = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

// Apply auth middleware to all routes
encryptionRoutes.use('*', authMiddleware);

/**
 * GET /v1/users/me/encryption-key
 * Returns the user's encrypted MEK.
 */
encryptionRoutes.get('/', async (c) => {
  const userId = c.get('userId');

  const user = await c.env.DB.prepare(
    `SELECT encrypted_mek FROM users WHERE id = ?`
  )
    .bind(userId)
    .first<Pick<UserWithEncryption, 'encrypted_mek'>>();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  if (!user.encrypted_mek) {
    return c.json({ error: 'Encryption not enabled for this user' }, 404);
  }

  // Parse and return the stored MEK
  try {
    const storedMek: StoredMEK = JSON.parse(user.encrypted_mek);
    return c.json(storedMek);
  } catch {
    return c.json({ error: 'Invalid encryption key format' }, 500);
  }
});

/**
 * PUT /v1/users/me/encryption-key
 * Stores the user's encrypted MEK (for backup/sync across devices).
 */
encryptionRoutes.put('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<StoredMEK>();

  // Validate the stored MEK structure
  if (!isValidStoredMEK(body)) {
    return c.json(
      {
        error: 'Invalid encryption key format',
        details: 'Expected { v: 1, salt, nonce, encrypted_mek, tag }',
      },
      400
    );
  }

  // Store the encrypted MEK as JSON
  const encryptedMekJson = JSON.stringify(body);

  const result = await c.env.DB.prepare(
    `UPDATE users SET encrypted_mek = ? WHERE id = ?`
  )
    .bind(encryptedMekJson, userId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ success: true });
});

/**
 * GET /v1/users/me/encryption-status
 * Returns whether E2EE is enabled for the user.
 */
encryptionRoutes.get('/status', async (c) => {
  const userId = c.get('userId');

  const user = await c.env.DB.prepare(
    `SELECT encrypted_mek FROM users WHERE id = ?`
  )
    .bind(userId)
    .first<Pick<UserWithEncryption, 'encrypted_mek'>>();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    enabled: user.encrypted_mek !== null,
  });
});
