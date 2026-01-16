import { LoginCredentials } from '@/types/auth'
import {
  base64Decode,
  base64Encode,
  decryptMEK,
  deleteMEKLocally,
  deriveAuthKey,
  deriveEncKey,
  encryptMEK,
  EncryptedMEK,
  generateMEK,
  generateSalt,
  storeMEKLocally,
} from './crypto'

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
 * Salt response from GET /auth/salt endpoint
 */
interface SaltResponse {
  success: boolean
  data?: {
    salt: string
  }
  error?: string
}

/**
 * Signup response from POST /auth/signup endpoint
 */
interface SignupResponse {
  success: boolean
  token?: string
  error?: string
}

/**
 * Signup credentials for user registration
 */
export interface SignupCredentials {
  email: string
  password: string
  name?: string
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
   * Fetches the salt for a given email address.
   * Salt is used for client-side key derivation.
   */
  async getSalt(email: string): Promise<string | null> {
    const response = await fetch(
      `${this.baseUrl}/dashboard/auth/salt?email=${encodeURIComponent(email)}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      }
    )

    if (response.status === 404) {
      // User not found - return null so login can show generic error
      return null
    }

    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as SaltResponse
      throw new Error(result.error || `HTTP ${response.status}`)
    }

    const result = await response.json() as SaltResponse
    if (result.success && result.data?.salt) {
      return result.data.salt
    }

    return null
  }

  /**
   * Register a new user with client-side key derivation.
   * Generates salt, auth_key, enc_key, and MEK client-side.
   * Password is never sent to the server.
   */
  async signup(credentials: SignupCredentials): Promise<SignupResponse> {
    // Step 1: Generate salt and MEK client-side
    const salt = generateSalt()
    const mek = generateMEK()

    // Step 2: Derive auth_key and enc_key from password
    const [authKey, encKey] = await Promise.all([
      deriveAuthKey(credentials.password, salt),
      deriveEncKey(credentials.password, salt),
    ])

    // Step 3: Encrypt MEK with enc_key
    const encryptedMek = await encryptMEK(encKey, mek)

    // Step 4: Send signup request to server
    const response = await fetch(
      `${this.baseUrl}/dashboard/auth/signup`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: credentials.email,
          name: credentials.name || credentials.email.split('@')[0],
          salt: base64Encode(salt),
          auth_key: base64Encode(authKey),
          encrypted_mek: encryptedMek,
        }),
      }
    )

    const result = await response.json() as {
      success?: boolean
      data?: {
        accessToken: string
        refreshToken: string
        user: { id: string; email: string }
      }
      error?: string
    }

    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`)
    }

    if (result.success && result.data?.accessToken) {
      // Step 5: Store MEK locally
      await storeMEKLocally(mek)

      // Store tokens in localStorage
      localStorage.setItem(TOKEN_KEY, result.data.accessToken)
      if (result.data.refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, result.data.refreshToken)
      }

      // Set cookies for middleware
      const isHttps = window.location.protocol === 'https:'
      const secureFlag = isHttps ? '; secure' : ''

      const accessCookieOptions = `path=/; max-age=${60 * 60 * 24}; ` +
        `samesite=strict${secureFlag}`
      document.cookie = `${TOKEN_KEY}=${result.data.accessToken}; ` +
        accessCookieOptions

      if (result.data.refreshToken) {
        const refreshCookieOptions = `path=/; max-age=${60 * 60 * 24 * 30}; ` +
          `samesite=strict${secureFlag}`
        document.cookie = `${REFRESH_TOKEN_COOKIE}=${result.data.refreshToken}` +
          `; ${refreshCookieOptions}`
      }

      return {
        success: true,
        token: result.data.accessToken,
      }
    }

    throw new Error(result.error || 'Signup failed')
  }

  /**
   * Authenticate user with client-side key derivation.
   * Password is never sent to the server - only derived auth_key.
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    // Step 1: Fetch salt for this user
    const saltBase64 = await this.getSalt(credentials.email)
    if (!saltBase64) {
      // User not found - show generic error for security
      throw new Error('Invalid email or password')
    }

    // Step 2: Derive auth_key and enc_key client-side
    const salt = base64Decode(saltBase64)
    const [authKey, encKey] = await Promise.all([
      deriveAuthKey(credentials.password, salt),
      deriveEncKey(credentials.password, salt),
    ])

    // Step 3: Send auth_key to server (never the password)
    const response = await fetch(
      `${this.baseUrl}/dashboard/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: credentials.email,
          auth_key: base64Encode(authKey),
          mfa_token: credentials.mfaToken,
          backup_code: credentials.backupCode,
        }),
      }
    )

    const result = await response.json() as {
      success?: boolean
      data?: {
        accessToken: string
        refreshToken: string
        user: { id: string; email: string }
        encryptedMek: EncryptedMEK
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
      // Step 4: Decrypt MEK using enc_key and store locally
      if (result.data.encryptedMek) {
        const mek = await decryptMEK(encKey, result.data.encryptedMek)
        await storeMEKLocally(mek)
      }

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
   * Logout user and clear all stored keys.
   */
  async logout(): Promise<void> {
    // Remove tokens from localStorage
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)

    // Clear MEK from IndexedDB
    await deleteMEKLocally()

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
