import { apiClient } from './api-client'
import type { Session, GetSessionsParams } from '@/types/session'

// Re-export Session type for convenience
export type { Session }

/**
 * Ticket status type
 */
export type TicketStatus = 'open' | 'resolved'

/**
 * Support ticket list item
 */
export interface SupportTicketListItem {
  id: string
  subject: string
  status: TicketStatus
  messageCount: number
  hasUnreadMessages: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Support message
 */
export interface SupportMessage {
  id: string
  ticketId: string
  body: string
  senderType: 'user' | 'admin' | 'system'
  senderName?: string
  isRead: boolean
  readAt?: string
  createdAt: string
}

/**
 * Support ticket detail
 */
export interface SupportTicketDetail {
  ticket: {
    id: string
    subject: string
    status: TicketStatus
    createdAt: string
    updatedAt: string
  }
  messages: SupportMessage[]
}

/**
 * Support status
 */
export interface SupportStatus {
  isOnline: boolean
  agentCount: number
  expectedResponseTime?: string
}

/**
 * User profile
 */
export interface UserProfile {
  id: string
  email: string
  createdAt: string
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

/**
 * Single item response wrapper
 */
export interface SingleResponse<T> {
  success: boolean
  data: T
}

/**
 * Delete response
 */
export interface DeleteResponse {
  success: boolean
  message?: string
}

/**
 * API response from sessions endpoint (actual structure)
 */
interface ApiSessionsResponse {
  success: boolean
  data: {
    items: Array<{
      session_id: string
      device_id: string
      device_name: string
      status: string
      started_at: string
      attached_at: string | null
      cwd: string
    }>
    total: number
    page: number
    limit: number
    hasMore: boolean
  }
}

/**
 * Dashboard API service for session management
 */
class DashboardApi {
  /**
   * Get all sessions for the authenticated user
   */
  async getSessions(
    params?: GetSessionsParams
  ): Promise<PaginatedResponse<Session>> {
    const searchParams = new URLSearchParams()

    if (params?.page) {
      searchParams.set('page', params.page.toString())
    }
    if (params?.limit) {
      searchParams.set('limit', params.limit.toString())
    }
    if (params?.search) {
      searchParams.set('search', params.search)
    }
    if (params?.status) {
      searchParams.set('status', params.status)
    }
    if (params?.sort) {
      searchParams.set('sortBy', params.sort)
    }
    if (params?.order) {
      searchParams.set('sortOrder', params.order)
    }

    const queryString = searchParams.toString()
    const endpoint = `/dashboard/sessions${queryString ? `?${queryString}` : ''}`

    const response = await apiClient.request<ApiSessionsResponse>(endpoint)

    // Transform API response to expected format
    const limit = response.data.limit || 20
    const total = response.data.total || 0
    const totalPages = Math.max(1, Math.ceil(total / limit))

    return {
      success: response.success,
      data: response.data.items.map(item => ({
        id: item.session_id,
        deviceId: item.device_id,
        deviceName: item.device_name,
        deviceType: 'cli' as const,
        status: item.status === 'attached' ? 'active' as const : 'disconnected' as const,
        cwd: item.cwd,
        createdAt: item.started_at,
        lastActivityAt: item.attached_at || item.started_at,
      })),
      meta: {
        page: response.data.page,
        limit: response.data.limit,
        total: response.data.total,
        totalPages,
      }
    }
  }

  /**
   * Get a specific session by ID
   */
  async getSessionById(id: string): Promise<Session> {
    const response = await apiClient.request<SingleResponse<Session>>(
      `/dashboard/sessions/${id}`
    )
    return response.data
  }

  /**
   * Delete/terminate a session
   */
  async deleteSession(id: string): Promise<DeleteResponse> {
    return apiClient.request<DeleteResponse>(
      `/dashboard/sessions/${id}`,
      { method: 'DELETE' }
    )
  }

  /**
   * Get user profile
   */
  async getProfile(): Promise<UserProfile> {
    const response = await apiClient.request<SingleResponse<UserProfile>>(
      '/dashboard/profile'
    )
    return response.data
  }
}

export const dashboardApi = new DashboardApi()

/**
 * Get support tickets
 */
export async function getSupportTickets(params?: {
  limit?: number
  status?: TicketStatus
  sort?: string
  order?: 'asc' | 'desc'
}): Promise<PaginatedResponse<SupportTicketListItem>> {
  const searchParams = new URLSearchParams()
  if (params?.limit) {
    searchParams.set('limit', params.limit.toString())
  }
  if (params?.status) {
    searchParams.set('status', params.status)
  }
  if (params?.sort) {
    searchParams.set('sortBy', params.sort)
  }
  if (params?.order) {
    searchParams.set('sortOrder', params.order)
  }

  const queryString = searchParams.toString()
  const endpoint = `/dashboard/support${queryString ? `?${queryString}` : ''}`

  return apiClient.request<PaginatedResponse<SupportTicketListItem>>(endpoint)
}

/**
 * Get support status (online/offline status)
 */
export async function getSupportStatus(): Promise<SupportStatus> {
  const response = await apiClient.request<SingleResponse<SupportStatus>>(
    '/dashboard/support/status'
  )
  return response.data
}

/**
 * Get a single support ticket with messages
 */
export async function getSupportTicket(
  ticketId: string
): Promise<SupportTicketDetail> {
  const response = await apiClient.request<SingleResponse<SupportTicketDetail>>(
    `/dashboard/support/${ticketId}`
  )
  return response.data
}

/**
 * Create a new support ticket
 */
export async function createSupportTicket(data: {
  subject: string
  body: string
}): Promise<{ ticket: { id: string } }> {
  return apiClient.request<{ ticket: { id: string } }>(
    '/dashboard/support',
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  )
}

/**
 * Add a message to a support ticket
 */
export async function addTicketMessage(
  ticketId: string,
  data: { body: string }
): Promise<{ message: SupportMessage }> {
  return apiClient.request<{ message: SupportMessage }>(
    `/dashboard/support/${ticketId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  )
}

/**
 * Mark a support ticket as resolved
 */
export async function resolveTicket(ticketId: string): Promise<void> {
  await apiClient.request<void>(
    `/dashboard/support/${ticketId}/resolve`,
    { method: 'POST' }
  )
}

/**
 * Reopen a resolved support ticket
 */
export async function reopenTicket(ticketId: string): Promise<void> {
  await apiClient.request<void>(
    `/dashboard/support/${ticketId}/reopen`,
    { method: 'POST' }
  )
}

/**
 * Mark a support message as read
 */
export async function markMessageRead(
  ticketId: string,
  messageId: string
): Promise<void> {
  await apiClient.request<void>(
    `/dashboard/support/${ticketId}/messages/${messageId}/read`,
    { method: 'POST' }
  )
}
