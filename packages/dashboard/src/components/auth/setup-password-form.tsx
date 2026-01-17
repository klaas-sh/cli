'use client'

import React, { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/lib/api-client'

/**
 * Minimum password length requirement
 */
const MIN_PASSWORD_LENGTH = 8

/**
 * Setup password form component.
 * Allows new users to set their initial password after email verification.
 */
export function SetupPasswordForm(): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  /**
   * Validate password requirements
   */
  const validatePassword = (): string | null => {
    if (!password) {
      return 'Password is required'
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    }

    if (password !== confirmPassword) {
      return 'Passwords do not match'
    }

    return null
  }

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()

    if (!token) {
      setError('Invalid setup link. No token provided.')
      return
    }

    const validationError = validatePassword()
    if (validationError) {
      setError(validationError)
      return
    }

    setIsLoading(true)
    setError('')

    try {
      await apiClient.setPassword(token, password)
      // Redirect to dashboard after successful password setup
      router.push('/')
    } catch (err: unknown) {
      const errorMessage = err instanceof Error
        ? err.message
        : 'Password setup failed'
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
        <div className="bg-[#ef4444]/10 border border-[#ef4444]/30 p-4
          rounded-lg">
          <h3 className="text-lg font-medium text-[#f87171] mb-2">
            Invalid setup link
          </h3>
          <p className="text-sm text-[#fca5a5]">
            This password setup link is invalid or has expired.
          </p>
        </div>
        <div className="mt-6 flex flex-col space-y-2">
          <Button
            onClick={() => router.push('/signup')}
            variant="outline"
            className="w-full"
          >
            Sign up again
          </Button>
          <Button
            onClick={() => router.push('/login')}
            variant="outline"
            className="w-full"
          >
            Back to Login
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
      <div className="mb-6">
        <h3 className="text-lg font-medium text-[#fafafa] mb-2">
          Set up your password
        </h3>
        <p className="text-sm text-[#a1a1aa]">
          Choose a strong password to secure your account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="new-password"
            className="block text-sm font-medium text-[#a1a1aa]"
          >
            Password
          </label>
          <Input
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
            required
          />
          <p className="text-xs text-[#71717a] mt-1">
            Must be at least {MIN_PASSWORD_LENGTH} characters
          </p>
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-[#a1a1aa]"
          >
            Confirm Password
          </label>
          <Input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1"
            required
          />
        </div>

        {error && (
          <div className="text-[#ef4444] text-sm bg-[#ef4444]/10
            border border-[#ef4444]/30 p-3 rounded-lg">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? 'Setting up password...' : 'Set password'}
          </Button>
        </div>
      </form>
    </div>
  )
}
