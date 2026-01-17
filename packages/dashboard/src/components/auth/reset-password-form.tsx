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
 * Reset password form component.
 * Allows users to set a new password using reset token.
 */
export function ResetPasswordForm(): React.JSX.Element {
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
      setError('Invalid reset link. No token provided.')
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
      await apiClient.resetPassword(token, password)
      // Redirect to login after successful password reset
      router.push('/login?reset=success')
    } catch (err: unknown) {
      const errorMessage = err instanceof Error
        ? err.message
        : 'Password reset failed'
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
            Invalid reset link
          </h3>
          <p className="text-sm text-[#fca5a5]">
            This password reset link is invalid or has expired.
          </p>
        </div>
        <div className="mt-6 flex flex-col space-y-2">
          <Button
            onClick={() => router.push('/forgot-password')}
            variant="outline"
            className="w-full"
          >
            Request new reset link
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
        <p className="text-sm text-[#a1a1aa]">
          Enter your new password below.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="new-password"
            className="block text-sm font-medium text-[#a1a1aa]"
          >
            New Password
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
            {isLoading ? 'Resetting password...' : 'Reset password'}
          </Button>
        </div>
      </form>
    </div>
  )
}
