'use client'

import React, { useEffect } from 'react'
import { Shield, CheckCircle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useEncryption } from '@/hooks/use-encryption'

/**
 * Encryption settings component for automatic E2EE.
 * Displays encryption status - no user interaction needed.
 *
 * E2EE is fully automatic:
 * - MEK is auto-generated on first use
 * - MEK is stored in IndexedDB with device-specific encryption
 * - All encryption/decryption happens transparently
 */
export function EncryptionSettings(): React.JSX.Element {
  const { isUnlocked, isLoading, error, autoInitialize } = useEncryption()

  // Auto-initialize encryption on mount
  useEffect(() => {
    autoInitialize()
  }, [autoInitialize])

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-app-primary
              dark:text-app-primary-dark" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              End-to-End Encryption
            </h2>
          </div>
          <Badge variant="default">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Initializing
          </Badge>
        </div>

        {/* Loading state */}
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-app-primary
              dark:text-app-primary-dark" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              End-to-End Encryption
            </h2>
          </div>
          <Badge variant="destructive">Error</Badge>
        </div>

        {/* Error state */}
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4
          border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-app-primary
            dark:text-app-primary-dark" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            End-to-End Encryption
          </h2>
        </div>
        <Badge variant={isUnlocked ? 'success' : 'default'}>
          {isUnlocked ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-600 dark:text-gray-400">
        End-to-end encryption ensures that your session data can only be
        read by you. Data is encrypted on your device before being sent to
        our servers.
      </p>

      {/* Status card */}
      <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-4
        border border-green-200 dark:border-green-800">
        <div className="flex gap-3">
          <CheckCircle className="h-5 w-5 text-green-600
            dark:text-green-400 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-green-800
              dark:text-green-200">
              Encryption Active
            </h4>
            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
              Your data is protected with end-to-end encryption.
              Encryption keys are automatically managed and stored securely
              on this device.
            </p>
          </div>
        </div>
      </div>

      {/* Technical details */}
      <div className="text-xs text-gray-500 dark:text-gray-500 space-y-1">
        <p>Technical details:</p>
        <ul className="list-disc list-inside ml-2 space-y-0.5">
          <li>AES-256-GCM encryption for all session data</li>
          <li>HKDF-SHA256 for session key derivation</li>
          <li>Device-bound key storage in IndexedDB</li>
        </ul>
      </div>
    </div>
  )
}
