'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/lib/api-client'

/**
 * Minimum email validation
 */
const isValidEmail = (email: string): boolean => {
  return email.includes('@') && email.trim().length > 0
}

/**
 * Forgot password form component.
 * Requests a password reset email for the user.
 */
export function ForgotPasswordForm(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess(false)

    if (!email.trim()) {
      setError('Email is required')
      setIsLoading(false)
      return
    }

    if (!isValidEmail(email)) {
      setError('Please enter a valid email address')
      setIsLoading(false)
      return
    }

    try {
      await apiClient.requestPasswordReset(email)
      setSuccess(true)
    } catch (err: unknown) {
      const errorMessage = err instanceof Error
        ? err.message
        : 'Password reset request failed'
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  if (success) {
    return (
      <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
        <div className="bg-[#22c55e]/10 border border-[#22c55e]/30 p-4
          rounded-lg">
          <h3 className="text-lg font-medium text-[#4ade80] mb-2">
            Check your email
          </h3>
          <p className="text-sm text-[#86efac]">
            If an account exists with that email, we&apos;ve sent you a
            password reset link. Please check your email.
          </p>
        </div>
        <div className="mt-6 text-center">
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
          Enter your email address and we&apos;ll send you a link to reset
          your password.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-[#a1a1aa]"
          >
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
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
            {isLoading ? 'Sending...' : 'Send reset link'}
          </Button>

          <Button
            type="button"
            onClick={() => router.push('/login')}
            variant="outline"
            className="w-full"
          >
            Back to Login
          </Button>
        </div>
      </form>
    </div>
  )
}
