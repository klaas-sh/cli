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
      <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2
            border-[#f59e0b]"></div>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}

/**
 * Client-side login page component.
 * Displays the Klaas branding and login form with dark theme.
 */
export default function LoginPageClient(): ReactElement {
  return (
    <div className="login-page min-h-screen flex items-center justify-center
      px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <AppIcon className="mr-3" size={40} />
            <h1 className="text-3xl font-bold font-mono text-[#fafafa]">
              klaas
            </h1>
          </div>
          <p className="text-[#a1a1aa]">
            Remote Terminal Access
          </p>
        </div>

        <LoginFormWrapper />

        <div className="mt-6 text-center space-y-2">
          <p className="text-sm text-[#a1a1aa]">
            Don&apos;t have an account?{' '}
            <a
              href="/signup"
              className="text-[#f59e0b] hover:text-[#fbbf24] font-medium"
            >
              Sign up
            </a>
          </p>
          <p className="text-sm text-[#a1a1aa]">
            <a
              href="/forgot-password"
              className="text-[#f59e0b] hover:text-[#fbbf24]"
            >
              Forgot your password?
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
