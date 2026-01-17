/**
 * User Dashboard Support Ticket Routes
 *
 * Provides authenticated user access to their support tickets,
 * messaging, and support availability status.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../types';
import {
  userAuthMiddleware,
  type UserContextVariables
} from '../../middleware/user-auth';
import {
  createTicket,
  getTicketById,
  listUserTickets,
  getTicketDetailForUser,
  updateTicketStatus,
  createMessage,
  markMessageRead,
  getSupportStatus,
  type TicketStatus,
} from '../../services/support.service';

/** API response format */
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/** Create ticket request */
interface CreateTicketRequest {
  subject: string;
  body: string;
}

/** Create message request */
interface CreateMessageRequest {
  body: string;
}

/**
 * Create support routes.
 */
export function createSupportRoutes() {
  const app = new Hono<{
    Bindings: Env;
    Variables: UserContextVariables;
  }>();

  // Apply auth middleware to all routes
  app.use('/*', userAuthMiddleware);

  /**
   * GET /dashboard/support
   * List user's support tickets
   */
  app.get(
    '/',
    async (c: Context<{ Bindings: Env; Variables: UserContextVariables }>) => {
      const userId = c.get('userId');
      const url = new URL(c.req.url);

      const status = url.searchParams.get('status') || 'all';
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const cursor = url.searchParams.get('cursor') || undefined;
      const sortBy = url.searchParams.get('sortBy') || 'updated_at';
      const sortOrder = url.searchParams.get('sortOrder') || 'desc';

      try {
        const result = await listUserTickets(c.env, userId, {
          status: status as 'all' | 'open' | 'resolved',
          limit,
          cursor,
          sort: sortBy as 'created_at' | 'updated_at',
          order: sortOrder as 'asc' | 'desc',
        });

        return c.json({
          success: true,
          data: result.data,
          meta: {
            total: result.meta.total,
            page: 1,
            limit,
            totalPages: Math.ceil(result.meta.total / limit),
          },
        });
      } catch (error) {
        console.error('List tickets error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to list tickets',
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * GET /dashboard/support/status
   * Get current support availability status
   */
  app.get(
    '/status',
    async (c: Context<{ Bindings: Env; Variables: UserContextVariables }>) => {
      try {
        const status = await getSupportStatus();

        return c.json({
          success: true,
          data: status,
        });
      } catch (error) {
        console.error('Get support status error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to get support status',
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * GET /dashboard/support/:ticketId
   * Get ticket details with messages
   */
  app.get(
    '/:ticketId',
    async (c: Context<{ Bindings: Env; Variables: UserContextVariables }>) => {
      const userId = c.get('userId');
      const ticketId = c.req.param('ticketId');

      try {
        const result = await getTicketDetailForUser(c.env, ticketId, userId);

        if (!result) {
          const response: ApiResponse = {
            success: false,
            error: 'Ticket not found',
          };
          return c.json(response, 404);
        }

        return c.json({
          success: true,
          data: result,
        });
      } catch (error) {
        console.error('Get ticket error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to get ticket',
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * POST /dashboard/support
   * Create a new support ticket
   */
  app.post(
    '/',
    async (c: Context<{ Bindings: Env; Variables: UserContextVariables }>) => {
      const userId = c.get('userId');

      try {
        const body = await c.req.json<CreateTicketRequest>();
        const { subject, body: messageBody } = body;

        // Validate required fields
        if (!subject || !messageBody) {
          const response: ApiResponse = {
            success: false,
            error: 'Subject and body are required',
          };
          return c.json(response, 400);
        }

        // Validate lengths
        if (subject.length > 200) {
          const response: ApiResponse = {
            success: false,
            error: 'Subject must be 200 characters or less',
          };
          return c.json(response, 400);
        }

        if (messageBody.length > 5000) {
          const response: ApiResponse = {
            success: false,
            error: 'Message must be 5000 characters or less',
          };
          return c.json(response, 400);
        }

        const result = await createTicket(c.env, userId, {
          subject,
          body: messageBody,
        });

        return c.json(
          {
            success: true,
            ticket: result.ticket,
          },
          201
        );
      } catch (error) {
        console.error('Create ticket error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to create ticket',
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * POST /dashboard/support/:ticketId/messages
   * Reply to a ticket
   */
  app.post(
    '/:ticketId/messages',
    async (c: Context<{ Bindings: Env; Variables: UserContextVariables }>) => {
      const userId = c.get('userId');
      const ticketId = c.req.param('ticketId');

      try {
        const data = await c.req.json<CreateMessageRequest>();
        const { body: messageBody } = data;

        // Validate
        if (!messageBody) {
          const response: ApiResponse = {
            success: false,
            error: 'Message body is required',
          };
          return c.json(response, 400);
        }

        if (messageBody.length > 5000) {
          const response: ApiResponse = {
            success: false,
            error: 'Message must be 5000 characters or less',
          };
          return c.json(response, 400);
        }

        // Verify ownership
        const ticket = await getTicketById(c.env, ticketId);
        if (!ticket || ticket.userId !== userId) {
          const response: ApiResponse = {
            success: false,
            error: 'Ticket not found',
          };
          return c.json(response, 404);
        }

        const message = await createMessage(
          c.env,
          ticketId,
          'user',
          userId,
          { body: messageBody }
        );

        if (!message) {
          const response: ApiResponse = {
            success: false,
            error: 'Failed to create message',
          };
          return c.json(response, 500);
        }

        // Get updated ticket
        const updatedTicket = await getTicketById(c.env, ticketId);

        return c.json(
          {
            success: true,
            message,
            ticket: updatedTicket
              ? {
                  status: updatedTicket.status,
                  updatedAt: updatedTicket.updatedAt,
                }
              : undefined,
          },
          201
        );
      } catch (error) {
        console.error('Create message error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to create message',
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * POST /dashboard/support/:ticketId/resolve
   * Mark ticket as resolved
   */
  app.post(
    '/:ticketId/resolve',
    async (c: Context<{ Bindings: Env; Variables: UserContextVariables }>) => {
      const userId = c.get('userId');
      const ticketId = c.req.param('ticketId');

      try {
        // Verify ownership
        const ticket = await getTicketById(c.env, ticketId);
        if (!ticket || ticket.userId !== userId) {
          const response: ApiResponse = {
            success: false,
            error: 'Ticket not found',
          };
          return c.json(response, 404);
        }

        const updated = await updateTicketStatus(
          c.env,
          ticketId,
          'resolved' as TicketStatus,
          'user',
          userId
        );

        return c.json({
          success: true,
          ticket: updated,
        });
      } catch (error) {
        console.error('Resolve ticket error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to resolve ticket',
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * POST /dashboard/support/:ticketId/reopen
   * Reopen a resolved ticket
   */
  app.post(
    '/:ticketId/reopen',
    async (c: Context<{ Bindings: Env; Variables: UserContextVariables }>) => {
      const userId = c.get('userId');
      const ticketId = c.req.param('ticketId');

      try {
        // Verify ownership
        const ticket = await getTicketById(c.env, ticketId);
        if (!ticket || ticket.userId !== userId) {
          const response: ApiResponse = {
            success: false,
            error: 'Ticket not found',
          };
          return c.json(response, 404);
        }

        const updated = await updateTicketStatus(
          c.env,
          ticketId,
          'open' as TicketStatus,
          'user',
          userId
        );

        return c.json({
          success: true,
          ticket: updated,
        });
      } catch (error) {
        console.error('Reopen ticket error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to reopen ticket',
        };
        return c.json(response, 500);
      }
    }
  );

  /**
   * POST /dashboard/support/:ticketId/messages/:messageId/read
   * Mark a message as read
   */
  app.post(
    '/:ticketId/messages/:messageId/read',
    async (c: Context<{ Bindings: Env; Variables: UserContextVariables }>) => {
      const userId = c.get('userId');
      const ticketId = c.req.param('ticketId');
      const messageId = c.req.param('messageId');

      try {
        // Verify ownership
        const ticket = await getTicketById(c.env, ticketId);
        if (!ticket || ticket.userId !== userId) {
          const response: ApiResponse = {
            success: false,
            error: 'Ticket not found',
          };
          return c.json(response, 404);
        }

        const success = await markMessageRead(c.env, messageId, userId);

        return c.json({
          success: true,
          data: {
            message: {
              id: messageId,
              isRead: true,
              readAt: success ? new Date().toISOString() : null,
            },
          },
        });
      } catch (error) {
        console.error('Mark read error:', error);
        const response: ApiResponse = {
          success: false,
          error: 'Failed to mark message as read',
        };
        return c.json(response, 500);
      }
    }
  );

  return app;
}

export default createSupportRoutes();
