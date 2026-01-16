/**
 * Encryption key management routes.
 *
 * Handles storage and retrieval of the user's encrypted Master Encryption Key
 * (MEK). The server never sees the unencrypted MEK - it is encrypted
 * client-side with a key derived from the user's password.
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
 * Updates the user's encrypted MEK (used for initial setup and password
 * change).
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
 * DELETE /v1/users/me/encryption-key
 * Removes the user's encrypted MEK (disables E2EE).
 *
 * WARNING: This will make all encrypted sessions unreadable.
 */
encryptionRoutes.delete('/', async (c) => {
  const userId = c.get('userId');

  const result = await c.env.DB.prepare(
    `UPDATE users SET encrypted_mek = NULL WHERE id = ?`
  )
    .bind(userId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ success: true });
});

/**
 * POST /v1/users/me/encryption-key/verify
 * Verifies the user can decrypt their MEK.
 *
 * This endpoint is for client-side verification that the correct password
 * was entered. The server does not actually verify the proof cryptographically
 * since it doesn't know the MEK. The client should call this after
 * successfully decrypting the MEK to confirm the operation.
 */
encryptionRoutes.post('/verify', async (c) => {
  const userId = c.get('userId');

  // Check if user has encryption enabled
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

  // The client has already verified the MEK by decrypting it with their
  // password. This endpoint just confirms encryption is set up.
  return c.json({ valid: true });
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
