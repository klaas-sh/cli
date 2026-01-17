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
 * Signup form component with email-only registration.
 * User sets password after email verification.
 */
export function SignupForm(): React.JSX.Element {
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
      await apiClient.signupWithEmail(email)
      setSuccess(true)
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

  if (success) {
    return (
      <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
        <div className="bg-[#22c55e]/10 border border-[#22c55e]/30 p-4
          rounded-lg">
          <h3 className="text-lg font-medium text-[#4ade80] mb-2">
            Check your email
          </h3>
          <p className="text-sm text-[#86efac]">
            We&apos;ve sent you a verification link. Please check your email
            and click the link to verify your account.
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

        <div>
          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? 'Creating account...' : 'Sign up'}
          </Button>
        </div>

        <p className="text-xs text-[#71717a] text-center">
          By creating an account, you agree to our{' '}
          <a
            href="https://klaas.sh/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#f59e0b] hover:text-[#fbbf24]"
          >
            terms of service
          </a>
          .<br />
          Your data is encrypted end-to-end.
        </p>
      </form>
    </div>
  )
}
