/**
 * Session type definitions for the Nexo Dashboard.
 */

/**
 * Session status values.
 * - active: Session is connected and actively used
 * - idle: Session is connected but no recent activity
 * - disconnected: Session has been disconnected
 */
export type SessionStatus = 'active' | 'idle' | 'disconnected'

/**
 * Device type that started the session.
 * - cli: Started from the Nexo CLI
 * - web: Started from the web dashboard
 */
export type DeviceType = 'cli' | 'web'

/**
 * Session interface representing a Claude Code session.
 */
export interface Session {
  /** Unique session identifier (ULID format) */
  id: string

  /** Human-readable device name (e.g., "MacBook Pro") */
  deviceName: string

  /** Type of device that started the session */
  deviceType: DeviceType

  /** Current session status */
  status: SessionStatus

  /** Current working directory path */
  cwd: string

  /** ISO timestamp of last activity */
  lastActivityAt: string

  /** ISO timestamp when the session was created */
  createdAt: string
}

/**
 * Paginated response from the sessions API.
 */
export interface SessionsResponse {
  /** Array of session objects */
  data: Session[]

  /** Pagination metadata */
  meta: {
    /** Current page number (1-indexed) */
    page: number

    /** Number of items per page */
    limit: number

    /** Total number of sessions */
    total: number

    /** Total number of pages */
    totalPages: number
  }
}

/**
 * Parameters for fetching sessions.
 */
export interface GetSessionsParams {
  /** Page number (1-indexed) */
  page?: number

  /** Number of items per page */
  limit?: number

  /** Search query for device name or cwd */
  search?: string

  /** Filter by status */
  status?: SessionStatus

  /** Sort field */
  sort?: 'lastActivityAt' | 'createdAt' | 'deviceName'

  /** Sort order */
  order?: 'asc' | 'desc'
}
