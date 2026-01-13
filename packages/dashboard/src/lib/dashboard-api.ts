import { apiClient } from './api-client'
import type { Session, GetSessionsParams } from '@/types/session'

// Re-export Session type for convenience
export type { Session }

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

    return apiClient.request<PaginatedResponse<Session>>(endpoint)
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
}

export const dashboardApi = new DashboardApi()
