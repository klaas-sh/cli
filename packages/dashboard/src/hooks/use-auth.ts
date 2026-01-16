'use client'

import { create } from 'zustand'
import { apiClient, SignupCredentials } from '../lib/api-client'
import { LoginCredentials } from '../types/auth'

/**
 * Token key for storing authentication token
 */
const TOKEN_KEY = 'user-token'

/**
 * Login response interface with proper typing
 */
interface LoginResult {
  success: boolean
  token?: string
  isFirstLogin?: boolean
  requiresPasswordChange?: boolean
  requiresMFASetup?: boolean
  requiresMFA?: boolean
}

/**
 * Signup response interface
 */
interface SignupResult {
  success: boolean
  token?: string
}

/**
 * Authentication state interface
 */
interface AuthState {
  isAuthenticated: boolean
  email: string | null
  isLoading: boolean
  hasHydrated: boolean
  login: (credentials: LoginCredentials) => Promise<LoginResult>
  signup: (credentials: SignupCredentials) => Promise<SignupResult>
  logout: () => Promise<void>
  initialize: () => Promise<void>
  checkAuth: () => Promise<boolean>
  setHydrated: () => void
}

/**
 * Authentication hook using Zustand for state management
 * Does not use persist middleware to avoid SSR issues
 */
export const useAuth = create<AuthState>()(set => ({
  isAuthenticated: false,
  email: null,
  isLoading: true,
  hasHydrated: false,

  /**
   * Mark as hydrated (called after client-side mount)
   */
  setHydrated: (): void => set({ hasHydrated: true }),

  /**
   * Login with email and password
   */
  login: async (credentials: LoginCredentials): Promise<LoginResult> => {
    try {
      const result = await apiClient.login(credentials)

      // Handle MFA requirement
      if (result.requiresMFA) {
        // Don't set authenticated state, but return the result
        return result
      }

      if (result.success && result.token) {
        set({
          isAuthenticated: true,
          email: credentials.email
        })

        return result // Return the full result for first-login checks
      } else {
        throw new Error('Login failed')
      }
    } catch (error) {
      set({ isAuthenticated: false, email: null })
      throw error
    }
  },

  /**
   * Register a new user
   */
  signup: async (credentials: SignupCredentials): Promise<SignupResult> => {
    try {
      const result = await apiClient.signup(credentials)

      if (result.success && result.token) {
        set({
          isAuthenticated: true,
          email: credentials.email
        })
        return result
      } else {
        throw new Error('Signup failed')
      }
    } catch (error) {
      set({ isAuthenticated: false, email: null })
      throw error
    }
  },

  /**
   * Logout and clear session
   */
  logout: async (): Promise<void> => {
    try {
      await apiClient.logout()
    } catch {
      // Silently handle logout errors
    }
    set({ isAuthenticated: false, email: null })
  },

  /**
   * Initialize authentication state on app load
   */
  initialize: async (): Promise<void> => {
    const hasToken = localStorage.getItem(TOKEN_KEY)
    if (!hasToken) {
      set({
        isAuthenticated: false,
        email: null,
        isLoading: false,
        hasHydrated: true
      })
      return
    }

    try {
      const authResult = await apiClient.checkAuth()
      set({
        isAuthenticated: authResult.authenticated,
        email: authResult.email || null,
        isLoading: false,
        hasHydrated: true
      })
    } catch {
      set({
        isAuthenticated: false,
        email: null,
        isLoading: false,
        hasHydrated: true
      })
    }
  },

  /**
   * Check if user is authenticated (for cookie-based auth)
   */
  checkAuth: async (): Promise<boolean> => {
    try {
      const authResult = await apiClient.checkAuth()
      const isAuth = authResult.authenticated
      set({
        isAuthenticated: isAuth,
        email: authResult.email || null,
        isLoading: false
      })
      return isAuth
    } catch {
      set({
        isAuthenticated: false,
        email: null,
        isLoading: false
      })
      return false
    }
  },
}))
