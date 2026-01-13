import { LoginCredentials } from '@/types/auth'

/**
 * Token key for storing authentication token
 */
const TOKEN_KEY = 'user-token'

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
 * Simple API client for making requests to the Nexo backend
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
      // Store token in localStorage
      localStorage.setItem(TOKEN_KEY, result.data.accessToken)

      // Also set a cookie for middleware authentication
      const cookieValue = `${TOKEN_KEY}=${result.data.accessToken}`
      // Use actual protocol to determine secure flag
      // This ensures cookie works when app is built in prod mode but served
      // over HTTP locally
      const isHttps = window.location.protocol === 'https:'
      const secureFlag = isHttps ? '; secure' : ''
      const cookieOptions = `path=/; max-age=${60 * 60 * 24}; ` +
        `samesite=strict${secureFlag}`
      document.cookie = `${cookieValue}; ${cookieOptions}`

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
    // Remove token from localStorage
    localStorage.removeItem(TOKEN_KEY)

    // Remove cookie - use actual protocol for secure flag
    const isHttps = window.location.protocol === 'https:'
    const secureFlag = isHttps ? '; secure' : ''
    const expiredCookie = `${TOKEN_KEY}=; path=/; ` +
      `expires=Thu, 01 Jan 1970 00:00:01 GMT; samesite=strict${secureFlag}`
    document.cookie = expiredCookie
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
      } else {
        localStorage.removeItem(TOKEN_KEY)
        return { authenticated: false }
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      return { authenticated: false }
    }
  }

  /**
   * Make authenticated request to API
   */
  async request<T = unknown>(
    endpoint: string,
    options: RequestInit = {}
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
