'use client'

import { Suspense, type ReactElement } from 'react'
import { SignupForm } from '@/components/auth/signup-form'
import { AppIcon } from '@/components/icons/app-icon'

/**
 * Signup form wrapper with Suspense for async operations.
 */
function SignupFormWrapper(): ReactElement {
  return (
    <Suspense fallback={
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2
            border-app-primary"></div>
        </div>
      </div>
    }>
      <SignupForm />
    </Suspense>
  )
}

/**
 * Client-side signup page component.
 * Displays the Klaas branding and signup form.
 */
export default function SignupPageClient(): ReactElement {
  return (
    <div className="signup-page min-h-screen flex items-center justify-center
      bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <AppIcon className="mr-3" size={40} />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Klaas
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Create your account
          </p>
        </div>

        <SignupFormWrapper />

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Already have an account?{' '}
            <a
              href="/login"
              className="text-app-primary dark:text-app-primary-dark hover:underline
                font-medium"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
