'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Minimum password length requirement
 */
const MIN_PASSWORD_LENGTH = 8

/**
 * Signup form component with email/password registration
 */
export function SignupForm(): React.JSX.Element {
  const [credentials, setCredentials] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    name: ''
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { signup } = useAuth()
  const router = useRouter()

  const validateForm = (): string | null => {
    if (!credentials.email.trim()) {
      return 'Email is required'
    }

    if (!credentials.email.includes('@')) {
      return 'Please enter a valid email address'
    }

    if (!credentials.password) {
      return 'Password is required'
    }

    if (credentials.password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    }

    if (credentials.password !== credentials.confirmPassword) {
      return 'Passwords do not match'
    }

    return null
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    // Validate form
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      setIsLoading(false)
      return
    }

    try {
      const result = await signup({
        email: credentials.email,
        password: credentials.password,
        name: credentials.name || undefined,
      })

      if (result.success) {
        // Redirect to dashboard after successful signup
        router.push('/')
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      if (errorMessage.includes('Failed to fetch')) {
        setError(
          'Unable to connect to server. ' +
          'Please check if the API is running.'
        )
      } else if (errorMessage.includes('NetworkError')) {
        setError('Network error. Please check your connection.')
      } else if (errorMessage.includes('already exists')) {
        setError('An account with this email already exists')
      } else {
        setError(err instanceof Error ? err.message : 'Signup failed')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Name (optional)
          </label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            value={credentials.name}
            onChange={(e) => setCredentials(prev => ({
              ...prev,
              name: e.target.value
            }))}
            className="mt-1"
            placeholder="Your name"
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={credentials.email}
            onChange={(e) => setCredentials(prev => ({
              ...prev,
              email: e.target.value
            }))}
            className="mt-1"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
            required
          />
        </div>

        <div>
          <label
            htmlFor="new-password"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Password
          </label>
          <Input
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={credentials.password}
            onChange={(e) => setCredentials(prev => ({
              ...prev,
              password: e.target.value
            }))}
            className="mt-1"
            required
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Must be at least {MIN_PASSWORD_LENGTH} characters
          </p>
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Confirm Password
          </label>
          <Input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={credentials.confirmPassword}
            onChange={(e) => setCredentials(prev => ({
              ...prev,
              confirmPassword: e.target.value
            }))}
            className="mt-1"
            required
          />
        </div>

        {error && (
          <div className="text-red-600 dark:text-red-400 text-sm bg-red-50
                        dark:bg-red-900/20 p-3 rounded-lg">
            {error}
          </div>
        )}

        <div>
          <Button
            type="submit"
            className="w-full bg-app-primary hover:bg-app-primary-hover text-white"
            disabled={isLoading}
          >
            {isLoading ? 'Creating account...' : 'Create account'}
          </Button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          By creating an account, you agree to our terms of service.
          Your data is encrypted end-to-end.
        </p>
      </form>
    </div>
  )
}
