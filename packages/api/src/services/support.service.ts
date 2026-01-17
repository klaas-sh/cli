/**
 * Support Ticket Service
 *
 * Handles support ticket management including creation, listing,
 * messaging, and status updates.
 */

import { ulid } from 'ulid'
import type { Env } from '../types'

// =============================================================================
// Types
// =============================================================================

export type TicketStatus = 'open' | 'resolved'
export type SenderType = 'user' | 'admin' | 'system'
export type TicketEventType = 'created' | 'status_changed' | 'reopened'

export interface SupportTicket {
  id: string
  userId: string
  subject: string
  status: TicketStatus
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  hasUnreadUserMessages: boolean
  hasUnreadAdminMessages: boolean
  lastUserMessageAt: string | null
  lastAdminMessageAt: string | null
  messageCount?: number
}

export interface SupportTicketListItem extends SupportTicket {
  messageCount: number
  hasUnreadMessages: boolean
}

export interface SupportMessage {
  id: string
  ticketId: string
  senderType: SenderType
  senderId: string
  senderName?: string
  body: string
  isInternal: boolean
  isRead: boolean
  readAt: string | null
  createdAt: string
  messageType: 'text' | 'attachment' | 'system_event'
}

export interface CreateTicketRequest {
  subject: string
  body: string
}

export interface CreateMessageRequest {
  body: string
  isInternal?: boolean
}

export interface TicketListResponse<T> {
  data: T[]
  meta: {
    total: number
    hasMore: boolean
    nextCursor: string | null
  }
}

export interface TicketDetailResponse {
  ticket: SupportTicket
  messages: SupportMessage[]
}

export interface SupportStatus {
  isOnline: boolean
  agentCount: number
  expectedResponseTime: string | null
}

// =============================================================================
// Row Mappers
// =============================================================================

/**
 * Maps database row to SupportTicket
 */
function mapTicketRow(row: Record<string, unknown>): SupportTicket {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    subject: row.subject as string,
    status: row.status as TicketStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    resolvedAt: row.resolved_at as string | null,
    hasUnreadUserMessages: (row.has_unread_user_messages as number) === 1,
    hasUnreadAdminMessages: (row.has_unread_admin_messages as number) === 1,
    lastUserMessageAt: row.last_user_message_at as string | null,
    lastAdminMessageAt: row.last_admin_message_at as string | null,
    messageCount: row.message_count as number | undefined,
  }
}

/**
 * Maps database row to SupportMessage
 */
function mapMessageRow(row: Record<string, unknown>): SupportMessage {
  return {
    id: row.id as string,
    ticketId: row.ticket_id as string,
    senderType: row.sender_type as SenderType,
    senderId: row.sender_id as string,
    senderName: row.sender_name as string | undefined,
    body: row.body as string,
    isInternal: (row.is_internal as number) === 1,
    isRead: (row.is_read as number) === 1,
    readAt: row.read_at as string | null,
    createdAt: row.created_at as string,
    messageType: row.message_type as 'text' | 'attachment' | 'system_event',
  }
}

// =============================================================================
// Ticket Operations
// =============================================================================

/**
 * Creates a new support ticket with initial message
 */
export async function createTicket(
  env: Env,
  userId: string,
  data: CreateTicketRequest
): Promise<{ ticket: SupportTicket; message: SupportMessage }> {
  const ticketId = ulid()
  const messageId = ulid()
  const eventId = ulid()
  const now = new Date().toISOString()

  // Create ticket
  await env.DB.prepare(`
    INSERT INTO support_tickets (
      id, user_id, subject, status,
      created_at, updated_at, has_unread_user_messages,
      last_user_message_at, source
    ) VALUES (?, ?, ?, 'open', ?, ?, 1, ?, 'dashboard')
  `).bind(
    ticketId,
    userId,
    data.subject,
    now,
    now,
    now
  ).run()

  // Create initial message
  await env.DB.prepare(`
    INSERT INTO support_messages (
      id, ticket_id, sender_type, sender_id, body,
      is_internal, is_read, created_at, message_type
    ) VALUES (?, ?, 'user', ?, ?, 0, 0, ?, 'text')
  `).bind(
    messageId,
    ticketId,
    userId,
    data.body,
    now
  ).run()

  // Create audit event
  await env.DB.prepare(`
    INSERT INTO support_ticket_events (
      id, ticket_id, event_type, actor_type, actor_id, created_at
    ) VALUES (?, ?, 'created', 'user', ?, ?)
  `).bind(eventId, ticketId, userId, now).run()

  const ticket = await getTicketById(env, ticketId)
  const message = await getMessageById(env, messageId)

  return {
    ticket: ticket!,
    message: message!,
  }
}

/**
 * Gets a ticket by ID
 */
export async function getTicketById(
  env: Env,
  id: string
): Promise<SupportTicket | null> {
  const result = await env.DB.prepare(`
    SELECT st.*,
           (SELECT COUNT(*) FROM support_messages
            WHERE ticket_id = st.id) as message_count
    FROM support_tickets st
    WHERE st.id = ?
  `).bind(id).first()

  return result ? mapTicketRow(result as Record<string, unknown>) : null
}

/**
 * Lists tickets for a user with pagination
 */
export async function listUserTickets(
  env: Env,
  userId: string,
  options: {
    status?: 'all' | 'open' | 'resolved'
    limit?: number
    cursor?: string
    sort?: 'created_at' | 'updated_at'
    order?: 'asc' | 'desc'
  } = {}
): Promise<TicketListResponse<SupportTicketListItem>> {
  const {
    status = 'all',
    limit = 20,
    cursor,
    sort = 'updated_at',
    order = 'desc',
  } = options

  let whereClause = 'WHERE st.user_id = ?'
  const params: (string | number)[] = [userId]

  if (status !== 'all') {
    whereClause += ' AND st.status = ?'
    params.push(status)
  }

  if (cursor) {
    whereClause += order === 'desc'
      ? ` AND st.${sort} < ?`
      : ` AND st.${sort} > ?`
    params.push(cursor)
  }

  // Get total count
  const countResult = await env.DB.prepare(`
    SELECT COUNT(*) as count FROM support_tickets st ${whereClause}
  `).bind(...params).first<{ count: number }>()

  const total = countResult?.count ?? 0

  // Get data (exclude internal notes from message count for users)
  const result = await env.DB.prepare(`
    SELECT st.*,
           (SELECT COUNT(*) FROM support_messages
            WHERE ticket_id = st.id AND is_internal = 0) as message_count
    FROM support_tickets st
    ${whereClause}
    ORDER BY st.${sort} ${order.toUpperCase()}
    LIMIT ?
  `).bind(...params, limit + 1).all()

  const rows = result.results ?? []
  const hasMore = rows.length > limit
  const data = rows.slice(0, limit).map((row) => {
    const ticket = mapTicketRow(row as Record<string, unknown>)
    return {
      ...ticket,
      messageCount: ticket.messageCount ?? 0,
      hasUnreadMessages: ticket.hasUnreadAdminMessages,
    } as SupportTicketListItem
  })

  const lastItem = data[data.length - 1]
  const nextCursor = hasMore && lastItem
    ? (sort === 'created_at' ? lastItem.createdAt : lastItem.updatedAt)
    : null

  return {
    data,
    meta: {
      total,
      hasMore,
      nextCursor,
    },
  }
}

/**
 * Gets ticket details for user view
 */
export async function getTicketDetailForUser(
  env: Env,
  ticketId: string,
  userId: string
): Promise<TicketDetailResponse | null> {
  // Get ticket
  const ticket = await getTicketById(env, ticketId)
  if (!ticket || ticket.userId !== userId) {
    return null
  }

  // Get messages (excluding internal notes)
  const messages = await env.DB.prepare(`
    SELECT sm.*
    FROM support_messages sm
    WHERE sm.ticket_id = ? AND sm.is_internal = 0
    ORDER BY sm.created_at ASC
  `).bind(ticketId).all()

  // Mark admin messages as read
  const now = new Date().toISOString()
  await env.DB.prepare(`
    UPDATE support_messages
    SET is_read = 1, read_at = ?, read_by = ?
    WHERE ticket_id = ? AND sender_type = 'admin' AND is_read = 0
  `).bind(now, userId, ticketId).run()

  // Update ticket unread flag
  await env.DB.prepare(`
    UPDATE support_tickets
    SET has_unread_admin_messages = 0, updated_at = ?
    WHERE id = ?
  `).bind(now, ticketId).run()

  return {
    ticket,
    messages: (messages.results ?? []).map((r) =>
      mapMessageRow(r as Record<string, unknown>)
    ),
  }
}

/**
 * Updates ticket status
 */
export async function updateTicketStatus(
  env: Env,
  ticketId: string,
  status: TicketStatus,
  actorType: SenderType,
  actorId: string
): Promise<SupportTicket | null> {
  const ticket = await getTicketById(env, ticketId)
  if (!ticket) return null

  const now = new Date().toISOString()
  const oldStatus = ticket.status

  // Update ticket
  await env.DB.prepare(`
    UPDATE support_tickets
    SET status = ?,
        resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END,
        updated_at = ?
    WHERE id = ?
  `).bind(status, status, now, now, ticketId).run()

  // Create audit event
  const eventId = ulid()
  await env.DB.prepare(`
    INSERT INTO support_ticket_events (
      id, ticket_id, event_type, actor_type, actor_id,
      old_value, new_value, created_at
    ) VALUES (?, ?, 'status_changed', ?, ?, ?, ?, ?)
  `).bind(eventId, ticketId, actorType, actorId, oldStatus, status, now).run()

  return getTicketById(env, ticketId)
}

// =============================================================================
// Message Operations
// =============================================================================

/**
 * Gets a message by ID
 */
export async function getMessageById(
  env: Env,
  id: string
): Promise<SupportMessage | null> {
  const result = await env.DB.prepare(`
    SELECT * FROM support_messages WHERE id = ?
  `).bind(id).first()

  return result ? mapMessageRow(result as Record<string, unknown>) : null
}

/**
 * Creates a reply message on a ticket
 */
export async function createMessage(
  env: Env,
  ticketId: string,
  senderType: SenderType,
  senderId: string,
  data: CreateMessageRequest
): Promise<SupportMessage | null> {
  const ticket = await getTicketById(env, ticketId)
  if (!ticket) return null

  const messageId = ulid()
  const now = new Date().toISOString()
  const isInternal = data.isInternal ?? false

  // Insert message
  await env.DB.prepare(`
    INSERT INTO support_messages (
      id, ticket_id, sender_type, sender_id, body,
      is_internal, is_read, created_at, message_type
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'text')
  `).bind(
    messageId,
    ticketId,
    senderType,
    senderId,
    data.body,
    isInternal ? 1 : 0,
    now
  ).run()

  // Update ticket
  const updates: string[] = ['updated_at = ?']
  const params: (string | number)[] = [now]

  if (senderType === 'user') {
    updates.push('has_unread_user_messages = 1')
    updates.push('last_user_message_at = ?')
    params.push(now)
    // Reopen if resolved
    if (ticket.status === 'resolved') {
      updates.push("status = 'open'")
      updates.push('resolved_at = NULL')
    }
  } else if (senderType === 'admin' && !isInternal) {
    updates.push('has_unread_admin_messages = 1')
    updates.push('last_admin_message_at = ?')
    params.push(now)
  }

  params.push(ticketId)
  await env.DB.prepare(`
    UPDATE support_tickets
    SET ${updates.join(', ')}
    WHERE id = ?
  `).bind(...params).run()

  // Create status changed event if ticket was reopened
  if (senderType === 'user' && ticket.status === 'resolved') {
    const eventId = ulid()
    await env.DB.prepare(`
      INSERT INTO support_ticket_events (
        id, ticket_id, event_type, actor_type, actor_id,
        old_value, new_value, created_at
      ) VALUES (?, ?, 'reopened', ?, ?, 'resolved', 'open', ?)
    `).bind(eventId, ticketId, senderType, senderId, now).run()
  }

  return getMessageById(env, messageId)
}

/**
 * Marks a message as read
 */
export async function markMessageRead(
  env: Env,
  messageId: string,
  readBy: string
): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await env.DB.prepare(`
    UPDATE support_messages
    SET is_read = 1, read_at = ?, read_by = ?
    WHERE id = ? AND is_read = 0
  `).bind(now, readBy, messageId).run()

  return (result.meta?.changes ?? 0) > 0
}

/**
 * Gets support status (placeholder - always shows online)
 */
export async function getSupportStatus(): Promise<SupportStatus> {
  return {
    isOnline: true,
    agentCount: 1,
    expectedResponseTime: 'within 24 hours',
  }
}
