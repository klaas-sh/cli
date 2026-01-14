import { LoginCredentials } from '@/types/auth'

/**
 * Token keys for storing authentication tokens
 */
const TOKEN_KEY = 'user-token'
const REFRESH_TOKEN_KEY = 'user-refresh-token'
const REFRESH_TOKEN_COOKIE = 'user-refresh-token'

/**
 * Authentication response from login endpoint
 */
interface LoginResponse {
  success: boolean
  token?: string
  isFirstLogin?: boolean
  requiresPasswordChange?: boolean
  requiresMFASetup?: boolean
  requiresMFA?: boolean
}

/**
 * Authentication check response
 */
interface AuthCheckResponse {
  authenticated: boolean
  email?: string
}

/**
 * API error response structure
 */
interface ApiErrorResponse {
  error?: string
  requiresMFASetup?: boolean
}

/**
 * Simple API client for making requests to the Klaas backend
 */
class ApiClient {
  private baseUrl: string

  constructor() {
    // Use the API package URL from environment variables
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL ||
      'http://localhost:8787'
  }

  /**
   * Authenticate user
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await fetch(
      `${this.baseUrl}/dashboard/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies for CORS
        body: JSON.stringify(credentials),
      }
    )

    const result = await response.json() as {
      success?: boolean
      data?: {
        accessToken: string
        refreshToken: string
        user: { id: string; email: string }
        isFirstLogin?: boolean
        requiresPasswordChange?: boolean
        requiresMFASetup?: boolean
      }
      error?: string
    }

    // Handle MFA requirement (401 status with specific error)
    if (response.status === 401 &&
        result.error === 'MFA token required') {
      return {
        success: false,
        requiresMFA: true
      }
    }

    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`)
    }

    // Handle the nested data structure from API
    if (result.success && result.data?.accessToken) {
      // Store tokens in localStorage
      localStorage.setItem(TOKEN_KEY, result.data.accessToken)
      if (result.data.refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, result.data.refreshToken)
      }

      // Also set cookies for middleware authentication
      // Use actual protocol to determine secure flag
      // This ensures cookie works when app is built in prod mode but served
      // over HTTP locally
      const isHttps = window.location.protocol === 'https:'
      const secureFlag = isHttps ? '; secure' : ''

      // Access token cookie (1 day, readable by JS for convenience)
      const accessCookieOptions = `path=/; max-age=${60 * 60 * 24}; ` +
        `samesite=strict${secureFlag}`
      document.cookie = `${TOKEN_KEY}=${result.data.accessToken}; ` +
        accessCookieOptions

      // Refresh token cookie (30 days, httpOnly would be better but we can't
      // set httpOnly from JS - middleware will handle this on server side)
      if (result.data.refreshToken) {
        const refreshCookieOptions = `path=/; max-age=${60 * 60 * 24 * 30}; ` +
          `samesite=strict${secureFlag}`
        document.cookie = `${REFRESH_TOKEN_COOKIE}=${result.data.refreshToken}` +
          `; ${refreshCookieOptions}`
      }

      return {
        success: true,
        token: result.data.accessToken,
        isFirstLogin: result.data.isFirstLogin,
        requiresPasswordChange: result.data.requiresPasswordChange,
        requiresMFASetup: result.data.requiresMFASetup
      }
    }

    throw new Error(result.error || 'Login failed')
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    // Remove tokens from localStorage
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)

    // Remove cookies - use actual protocol for secure flag
    const isHttps = window.location.protocol === 'https:'
    const secureFlag = isHttps ? '; secure' : ''
    const expireOptions = `path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; ` +
      `samesite=strict${secureFlag}`
    document.cookie = `${TOKEN_KEY}=; ${expireOptions}`
    document.cookie = `${REFRESH_TOKEN_COOKIE}=; ${expireOptions}`
  }

  /**
   * Refresh the access token using the refresh token
   * @returns true if refresh succeeded, false otherwise
   */
  async refreshAccessToken(): Promise<boolean> {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
    if (!refreshToken) {
      return false
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/auth/refresh`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken })
        }
      )

      if (!response.ok) {
        // Refresh failed, clear tokens
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(REFRESH_TOKEN_KEY)
        return false
      }

      const result = await response.json() as {
        access_token: string
        refresh_token: string
      }

      // Store new tokens
      localStorage.setItem(TOKEN_KEY, result.access_token)
      localStorage.setItem(REFRESH_TOKEN_KEY, result.refresh_token)

      // Update cookies for middleware
      const isHttps = window.location.protocol === 'https:'
      const secureFlag = isHttps ? '; secure' : ''

      // Access token cookie
      const accessCookieOptions = `path=/; max-age=${60 * 60 * 24}; ` +
        `samesite=strict${secureFlag}`
      document.cookie = `${TOKEN_KEY}=${result.access_token}; ` +
        accessCookieOptions

      // Refresh token cookie
      const refreshCookieOptions = `path=/; max-age=${60 * 60 * 24 * 30}; ` +
        `samesite=strict${secureFlag}`
      document.cookie = `${REFRESH_TOKEN_COOKIE}=${result.refresh_token}; ` +
        refreshCookieOptions

      return true
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(REFRESH_TOKEN_KEY)
      return false
    }
  }

  /**
   * Check if user is authenticated
   */
  async checkAuth(): Promise<AuthCheckResponse> {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      return { authenticated: false }
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/dashboard/auth/check`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          credentials: 'include'
        }
      )

      if (response.ok) {
        // The /dashboard/auth/check endpoint returns { success, data }
        // If we get a 200, the token is valid and user is authenticated
        return { authenticated: true }
      }

      // If 401, try to refresh the token
      if (response.status === 401) {
        const refreshed = await this.refreshAccessToken()
        if (refreshed) {
          // Retry with new token
          const newToken = localStorage.getItem(TOKEN_KEY)
          const retryResponse = await fetch(
            `${this.baseUrl}/dashboard/auth/check`,
            {
              headers: {
                'Authorization': `Bearer ${newToken}`
              },
              credentials: 'include'
            }
          )
          if (retryResponse.ok) {
            return { authenticated: true }
          }
        }
      }

      // Auth failed, clear tokens
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(REFRESH_TOKEN_KEY)
      return { authenticated: false }
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(REFRESH_TOKEN_KEY)
      return { authenticated: false }
    }
  }

  /**
   * Make authenticated request to API with auto-refresh on 401
   */
  async request<T = unknown>(
    endpoint: string,
    options: RequestInit = {},
    _isRetry = false
  ): Promise<T> {
    const token = localStorage.getItem(TOKEN_KEY)
    const url = `${this.baseUrl}${endpoint}`

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...options.headers,
      },
      credentials: 'include'
    })

    if (!response.ok) {
      // If 401 and not already a retry, try to refresh token
      if (response.status === 401 && !_isRetry) {
        const refreshed = await this.refreshAccessToken()
        if (refreshed) {
          // Retry the request with new token
          return this.request<T>(endpoint, options, true)
        }
      }

      const errorData = await response.json()
        .catch(() => ({})) as ApiErrorResponse

      // Check if MFA setup is required
      if (response.status === 403 && errorData.requiresMFASetup) {
        // Redirect to MFA setup page
        window.location.href = '/setup-mfa'
        throw new Error('MFA setup required')
      }

      throw new Error(errorData.error || `HTTP ${response.status}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Get the stored token (for external use)
   */
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY)
  }
}

export const apiClient = new ApiClient()
