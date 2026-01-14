'use client'

import { Suspense, type ReactElement } from 'react'
import { DeviceAuthForm } from '@/components/auth/device-auth-form'
import { AppIcon } from '@/components/icons/app-icon'

/**
 * Device auth form wrapper with Suspense for async operations.
 */
function DeviceAuthFormWrapper(): ReactElement {
  return (
    <Suspense fallback={
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2
            border-app-primary"></div>
        </div>
      </div>
    }>
      <DeviceAuthForm />
    </Suspense>
  )
}

/**
 * Client-side device authorization page.
 * Allows users to enter a device code to connect their CLI.
 */
export default function DevicePageClient(): ReactElement {
  return (
    <div className="device-page min-h-screen flex items-center justify-center
      bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-xl px-4">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <AppIcon className="mr-3" size={40} />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Klaas
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Connect your CLI device
          </p>
        </div>

        <DeviceAuthFormWrapper />

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Run <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1
              rounded font-mono text-app-primary dark:text-app-primary-dark">
              klaas
            </code> in your terminal to get a device code.
          </p>
        </div>
      </div>
    </div>
  )
}
