'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Login form component with email/password and MFA support
 */
export function LoginForm(): React.JSX.Element {
  const [credentials, setCredentials] = useState({
    email: '',
    password: ''
  })
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaToken, setMfaToken] = useState('')
  const [backupCode, setBackupCode] = useState('')
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { login } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = searchParams.get('returnUrl')
  const firstMfaInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus first MFA input when MFA is required
  useEffect(() => {
    if (mfaRequired && !useBackupCode) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        firstMfaInputRef.current?.focus()
      }, 100)
    }
  }, [mfaRequired, useBackupCode])

  const handleSubmit = useCallback(async (
    e: React.FormEvent
  ): Promise<void> => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      if (mfaRequired) {
        // Handle MFA verification
        const loginData = {
          ...credentials,
          ...(useBackupCode ? { backupCode } : { mfaToken })
        }
        const result = await login(loginData)

        // Check if login was successful after MFA
        if (result.success) {
          const redirectTo = returnUrl
            ? decodeURIComponent(returnUrl)
            : '/'
          router.push(redirectTo)
        } else {
          throw new Error('MFA verification failed')
        }
      } else {
        // Initial login attempt
        const result = await login(credentials)

        // Check if MFA is required
        if (result.requiresMFA) {
          setMfaRequired(true)
          setError('')
          return
        }

        // Check if first-time login or password change required
        if (result.requiresPasswordChange) {
          router.push('/change-password')
          return
        }

        // Check if MFA setup is required
        if (result.requiresMFASetup) {
          router.push('/setup-mfa')
          return
        }

        // Redirect to the original page or home
        const redirectTo = returnUrl
          ? decodeURIComponent(returnUrl)
          : '/'
        router.push(redirectTo)
      }
    } catch (err: unknown) {
      // Better error messages
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      if (errorMessage.includes('Failed to fetch')) {
        setError(
          'Unable to connect to server. ' +
          'Please check if the API is running.'
        )
      } else if (errorMessage.includes('NetworkError')) {
        setError('Network error. Please check your connection.')
      } else {
        setError(
          err instanceof Error ? err.message : 'Login failed'
        )
      }

      // If MFA verification failed, clear the token and refocus
      if (mfaRequired && !useBackupCode) {
        setMfaToken('')
        setTimeout(() => {
          firstMfaInputRef.current?.focus()
        }, 100)
      }
    } finally {
      setIsLoading(false)
    }
  }, [credentials, mfaRequired, useBackupCode, mfaToken, backupCode,
      login, returnUrl, router])

  // Auto-submit when all 6 digits are entered
  useEffect(() => {
    if (mfaToken.length === 6 && !isLoading) {
      const syntheticEvent = {
        preventDefault: () => {}
      } as React.FormEvent
      handleSubmit(syntheticEvent)
    }
  }, [mfaToken, isLoading, handleSubmit])

  const handleBackToLogin = (): void => {
    setMfaRequired(false)
    setMfaToken('')
    setBackupCode('')
    setUseBackupCode(false)
    setError('')
  }

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
      {returnUrl && (
        <div className="mb-4 p-3 bg-violet-50 dark:bg-violet-900/20 rounded-lg">
          <p className="text-sm text-violet-600 dark:text-violet-400">
            Your session has expired. You&apos;ll be redirected after signing
            in.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {!mfaRequired ? (
          // Initial login form
          <>
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
                htmlFor="current-password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Password
              </label>
              <Input
                id="current-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={credentials.password}
                onChange={(e) => setCredentials(prev => ({
                  ...prev,
                  password: e.target.value
                }))}
                className="mt-1"
                required
              />
            </div>
          </>
        ) : (
          // MFA verification form
          <>
            <div className="bg-violet-50 dark:bg-violet-900/20 p-4 rounded-lg">
              <p className="text-sm text-violet-600 dark:text-violet-400">
                Multi-factor authentication is enabled for your account.
              </p>
            </div>

            {!useBackupCode ? (
              <div>
                <label
                  htmlFor="mfa-code"
                  className="block text-sm font-medium text-gray-700
                    dark:text-gray-300 mb-3"
                >
                  Authentication Code
                </label>
                <div className="flex justify-center space-x-3">
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <input
                      key={index}
                      ref={index === 0 ? firstMfaInputRef : undefined}
                      type="tel"
                      inputMode="numeric"
                      autoComplete={index === 0 ? "one-time-code" : "off"}
                      maxLength={1}
                      className="block w-[52px] h-[52px] text-center border-2
                               border-gray-300 rounded-lg text-xl font-medium
                               focus:border-violet-500 focus:ring-2
                               focus:ring-violet-200 focus:outline-none
                               dark:bg-gray-800 dark:border-gray-600
                               dark:text-white dark:focus:border-violet-400
                               dark:focus:ring-violet-800"
                      value={mfaToken[index] || ''}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9]/g, '')
                        if (value.length <= 1) {
                          const newToken = mfaToken.split('')
                          newToken[index] = value
                          setMfaToken(newToken.join(''))

                          // Auto-focus next input
                          if (value && index < 5) {
                            const parent = (
                              e.target as HTMLInputElement
                            ).parentElement
                            const nextInput = parent?.children[
                              index + 1
                            ] as HTMLInputElement
                            nextInput?.focus()
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        // Handle backspace
                        if (e.key === 'Backspace' && !mfaToken[index]
                            && index > 0) {
                          const parent = (
                            e.target as HTMLInputElement
                          ).parentElement
                          const prevInput = parent?.children[
                            index - 1
                          ] as HTMLInputElement
                          prevInput?.focus()
                        }
                      }}
                      onPaste={(e) => {
                        e.preventDefault()
                        const pastedText = e.clipboardData.getData('text')
                        const pastedData = pastedText
                          .replace(/[^0-9]/g, '')
                          .slice(0, 6)
                        setMfaToken(pastedData)

                        // Focus the last filled input or the next empty one
                        const targetIndex = Math.min(pastedData.length, 5)
                        const parent = (
                          e.target as HTMLInputElement
                        ).parentElement
                        const targetInput = parent?.children[
                          targetIndex
                        ] as HTMLInputElement
                        targetInput?.focus()
                      }}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400
                  mt-3 text-center">
                  Enter the 6-digit code from your authenticator app
                </p>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="backup-code"
                  className="block text-sm font-medium text-gray-700
                    dark:text-gray-300"
                >
                  Backup Code
                </label>
                <Input
                  id="backup-code"
                  name="backup-code"
                  type="text"
                  autoComplete="off"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value)}
                  className="mt-1 text-center font-mono"
                  placeholder="XXXXXXXX"
                  maxLength={8}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck="false"
                  required
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Enter one of your 8-character backup codes
                </p>
              </div>
            )}

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setUseBackupCode(!useBackupCode)
                  setMfaToken('')
                  setBackupCode('')
                  setError('')
                }}
                className="text-sm text-gray-500 dark:text-gray-400
                  hover:text-gray-700 dark:hover:text-gray-200 underline"
              >
                {useBackupCode
                  ? 'Use authenticator app instead'
                  : 'Use backup code instead'}
              </button>
            </div>
          </>
        )}

        {error && (
          <div className="text-red-600 dark:text-red-400 text-sm bg-red-50
                        dark:bg-red-900/20 p-3 rounded-lg">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <Button
            type="submit"
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
            disabled={isLoading
              || (mfaRequired && !useBackupCode && !mfaToken.trim())
              || (mfaRequired && useBackupCode && !backupCode.trim())}
          >
            {isLoading
              ? 'Signing in...'
              : mfaRequired
                ? 'Verify & Sign in'
                : 'Sign in'}
          </Button>

          {mfaRequired && (
            <Button
              type="button"
              onClick={handleBackToLogin}
              variant="outline"
              className="w-full"
            >
              Back to Login
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
