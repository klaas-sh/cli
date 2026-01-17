'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'

/**
 * Email verification form component.
 * Verifies email using token from URL and redirects to password setup.
 */
export function VerifyEmailForm(): React.JSX.Element {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  /**
   * Verify email on component mount
   */
  useEffect(() => {
    const verify = async (): Promise<void> => {
      if (!token) {
        setError('Invalid verification link. No token provided.')
        setIsLoading(false)
        return
      }

      try {
        const result = await apiClient.verifyEmail(token)
        // Redirect to password setup with the token
        router.push(`/setup-password?token=${result.passwordSetupToken}`)
      } catch (err: unknown) {
        const errorMessage = err instanceof Error
          ? err.message
          : 'Email verification failed'
        setError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    verify()
  }, [token, router])

  return (
    <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-8
          space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2
            border-[#f59e0b]"></div>
          <p className="text-[#a1a1aa]">
            Verifying your email...
          </p>
        </div>
      ) : error ? (
        <div className="space-y-4">
          <div className="bg-[#ef4444]/10 border border-[#ef4444]/30 p-4
            rounded-lg">
            <h3 className="text-lg font-medium text-[#f87171] mb-2">
              Verification failed
            </h3>
            <p className="text-sm text-[#fca5a5]">
              {error}
            </p>
          </div>
          <div className="flex flex-col space-y-2">
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
      ) : null}
    </div>
  )
}
