'use client'

import { Suspense, type ReactElement } from 'react'
import { LoginForm } from '@/components/auth/login-form'
import { AppIcon } from '@/components/icons/app-icon'

/**
 * Login form wrapper with Suspense for async operations.
 */
function LoginFormWrapper(): ReactElement {
  return (
    <Suspense fallback={
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2
            border-blue-600"></div>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}

/**
 * Client-side login page component.
 * Displays the Nexo branding and login form.
 */
export default function LoginPageClient(): ReactElement {
  return (
    <div className="login-page min-h-screen flex items-center justify-center
      bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <AppIcon className="mr-3" size={40} />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Nexo
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Remote access for Claude Code
          </p>
        </div>

        <LoginFormWrapper />

        <div className="mt-6 text-center space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Don&apos;t have an account?{' '}
            <a
              href="/signup"
              className="text-blue-600 dark:text-blue-400 hover:underline
                font-medium"
            >
              Sign up
            </a>
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <a
              href="/forgot-password"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Forgot your password?
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
