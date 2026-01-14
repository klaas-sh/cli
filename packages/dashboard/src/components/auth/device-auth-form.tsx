'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'

interface DeviceAuthFormProps {
  /** Pre-filled device code from URL */
  initialCode?: string
}

/**
 * Device authorization form component.
 * Allows users to enter a device code to authorize a CLI device.
 */
export function DeviceAuthForm({
  initialCode = ''
}: DeviceAuthFormProps): React.JSX.Element {
  // Parse initial code - handle both XXXX-XXXX and XXXXXXXX formats
  const parseCode = (code: string): string => {
    // Remove any non-alphanumeric characters and uppercase
    return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)
  }

  const [code, setCode] = useState(parseCode(initialCode))
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const router = useRouter()
  const firstInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus first input on mount
  useEffect(() => {
    if (!initialCode) {
      setTimeout(() => {
        firstInputRef.current?.focus()
      }, 100)
    }
  }, [initialCode])

  // Format code for display (XXXX-XXXX)
  const formatCodeForDisplay = (rawCode: string): string => {
    if (rawCode.length <= 4) return rawCode
    return `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`
  }

  const handleSubmit = useCallback(async (
    e?: React.FormEvent
  ): Promise<void> => {
    e?.preventDefault()

    if (code.length !== 8) {
      setError('Please enter the complete 8-character code')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      // Format code as XXXX-XXXX for the API
      const formattedCode = formatCodeForDisplay(code)

      // Call the authorize endpoint
      const response = await apiClient.request<{ success: boolean }>(
        '/auth/authorize',
        {
          method: 'POST',
          body: JSON.stringify({
            user_code: formattedCode
          })
        }
      )

      if (response.success) {
        setSuccess(true)
        // Redirect to sessions after a short delay
        setTimeout(() => {
          router.push('/sessions')
        }, 1500)
      } else {
        setError('Authorization failed. Please try again.')
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      if (errMsg.includes('invalid_code')) {
        setError(
          'Invalid or expired code. Please check the code and try again.'
        )
      } else if (errMsg.includes('Failed to fetch')) {
        setError('Unable to connect to server. Please try again.')
      } else {
        setError(errMsg || 'Authorization failed')
      }
    } finally {
      setIsLoading(false)
    }
  }, [code, router])

  // Auto-submit when all 8 characters are entered
  useEffect(() => {
    if (code.length === 8 && !isLoading && !success && initialCode) {
      handleSubmit()
    }
  }, [code, isLoading, success, initialCode, handleSubmit])

  // Common input class for code inputs - responsive sizing
  // Mobile: 32px (w-8), sm+: 48px (w-12)
  const inputClass = `
    block w-8 h-8 sm:w-12 sm:h-12
    text-center border-2 border-gray-300 rounded sm:rounded-lg
    text-sm sm:text-xl font-mono font-medium uppercase
    focus:border-app-primary focus:ring-2 focus:ring-app-border
    focus:outline-none dark:bg-gray-800 dark:border-gray-600
    dark:text-white dark:focus:border-app-primary-dark
    dark:focus:ring-app-border-dark
  `.trim()

  // Handle input change
  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    index: number
  ): void => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (value.length <= 1) {
      const newCode = code.split('')
      newCode[index] = value
      setCode(newCode.join(''))

      // Auto-focus next input
      if (value && index < 7) {
        const nextIndex = index === 3 ? 4 : index + 1
        const parent = e.target.closest('form')
        const inputs = parent?.querySelectorAll('input')
        const target = inputs?.[nextIndex] as HTMLInputElement
        target?.focus()
      }
    }
  }

  // Handle backspace navigation
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number
  ): void => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      const prevIndex = index === 4 ? 3 : index - 1
      const parent = e.currentTarget.closest('form')
      const inputs = parent?.querySelectorAll('input')
      const prevInput = inputs?.[prevIndex] as HTMLInputElement
      prevInput?.focus()
    }
  }

  // Handle paste
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')
    const pastedData = pastedText
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8)
    setCode(pastedData)

    // Focus appropriate input
    const targetIndex = Math.min(pastedData.length, 7)
    const parent = e.currentTarget.closest('form')
    const inputs = parent?.querySelectorAll('input')
    const target = inputs?.[targetIndex] as HTMLInputElement
    target?.focus()
  }

  if (success) {
    return (
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <div className="text-center py-8">
          <div className="mb-4">
            <svg
              className="mx-auto h-16 w-16 text-app-success"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white
            mb-2">
            Device Authorized
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your CLI is now connected. Redirecting to sessions...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-4 sm:p-6">
      <div className="mb-6">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          Authorize Device
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Enter the code shown in your CLI to connect this device.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="device-code"
            className="block text-sm font-medium text-gray-700
              dark:text-gray-300 mb-3"
          >
            Device Code
          </label>
          <div className="flex justify-center items-center gap-0.5 sm:gap-2">
            {/* First 4 characters */}
            {[0, 1, 2, 3].map((index) => (
              <input
                key={index}
                ref={index === 0 ? firstInputRef : undefined}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={1}
                className={inputClass}
                value={code[index] || ''}
                onChange={(e) => handleInputChange(e, index)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onPaste={handlePaste}
              />
            ))}

            {/* Separator */}
            <span className="flex items-center text-lg sm:text-2xl font-bold
              text-gray-400 dark:text-gray-500 px-0.5 sm:px-1">
              -
            </span>

            {/* Last 4 characters */}
            {[4, 5, 6, 7].map((index) => (
              <input
                key={index}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={1}
                className={inputClass}
                value={code[index] || ''}
                onChange={(e) => handleInputChange(e, index)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onPaste={handlePaste}
              />
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3
            text-center">
            Enter the 8-character code from your terminal
          </p>
        </div>

        {error && (
          <div className="text-red-600 dark:text-red-400 text-sm bg-red-50
            dark:bg-red-900/20 p-3 rounded-lg">
            {error}
          </div>
        )}

        <Button
          type="submit"
          className="w-full bg-app-primary hover:bg-app-primary-hover
            text-white"
          disabled={isLoading || code.length !== 8}
        >
          {isLoading ? 'Authorizing...' : 'Authorize Device'}
        </Button>
      </form>
    </div>
  )
}
