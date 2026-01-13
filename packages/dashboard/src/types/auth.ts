/**
 * Authentication types for Nexo Dashboard
 */

/**
 * Login credentials for user authentication
 */
export interface LoginCredentials {
  email: string
  password: string
  mfaToken?: string
  backupCode?: string
}

/**
 * Represents a user session
 */
export interface UserSession {
  id: string
  email: string
  expiresAt: Date
  createdAt: Date
  ipAddress?: string
  userAgent?: string
}

/**
 * Response from authentication operations
 */
export interface AuthResponse {
  success: boolean
  session?: UserSession
  token?: string
  error?: string
  authenticated?: boolean
  email?: string
}

/**
 * Dashboard user interface
 */
export interface DashboardUser {
  id: string
  email: string
  name: string
  createdAt: string
  lastLogin?: string
}
