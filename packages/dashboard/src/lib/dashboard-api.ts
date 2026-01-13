import { apiClient } from './api-client'

/**
 * CLI session information
 */
export interface Session {
  id: string
  userId: string
  projectPath: string
  deviceName: string
  status: 'active' | 'idle' | 'disconnected'
  createdAt: string
  lastActivityAt: string
  ipAddress?: string
  userAgent?: string
}

/**
 * Pagination parameters for list requests
 */
export interface PaginationParams {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  pagination: {
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
 * Dashboard API service for session management
 */
class DashboardApi {
  /**
   * Get all sessions for the authenticated user
   */
  async getSessions(
    params?: PaginationParams
  ): Promise<PaginatedResponse<Session>> {
    const searchParams = new URLSearchParams()

    if (params?.page) {
      searchParams.set('page', params.page.toString())
    }
    if (params?.limit) {
      searchParams.set('limit', params.limit.toString())
    }
    if (params?.sortBy) {
      searchParams.set('sortBy', params.sortBy)
    }
    if (params?.sortOrder) {
      searchParams.set('sortOrder', params.sortOrder)
    }

    const queryString = searchParams.toString()
    const endpoint = `/dashboard/sessions${queryString ? `?${queryString}` : ''}`

    return apiClient.request<PaginatedResponse<Session>>(endpoint)
  }

  /**
   * Get a specific session by ID
   */
  async getSessionById(id: string): Promise<SingleResponse<Session>> {
    return apiClient.request<SingleResponse<Session>>(
      `/dashboard/sessions/${id}`
    )
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
}

export const dashboardApi = new DashboardApi()
