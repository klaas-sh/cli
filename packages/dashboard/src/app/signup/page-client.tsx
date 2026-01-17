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
      <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2
            border-[#f59e0b]"></div>
        </div>
      </div>
    }>
      <SignupForm />
    </Suspense>
  )
}

/**
 * Client-side signup page component.
 * Displays the Klaas branding and signup form with dark theme.
 */
export default function SignupPageClient(): ReactElement {
  return (
    <div className="signup-page min-h-screen flex items-center justify-center
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
            Create your account
          </p>
        </div>

        <SignupFormWrapper />

        <div className="mt-6 text-center">
          <p className="text-sm text-[#a1a1aa]">
            Already have an account?{' '}
            <a
              href="/login"
              className="text-[#f59e0b] hover:text-[#fbbf24] font-medium"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
