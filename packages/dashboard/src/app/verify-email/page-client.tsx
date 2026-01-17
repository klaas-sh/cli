'use client'

import { Suspense, type ReactElement } from 'react'
import { VerifyEmailForm } from '@/components/auth/verify-email-form'
import { AppIcon } from '@/components/icons/app-icon'

/**
 * Form wrapper with Suspense for async operations.
 */
function FormWrapper(): ReactElement {
  return (
    <Suspense fallback={
      <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2
            border-[#f59e0b]"></div>
        </div>
      </div>
    }>
      <VerifyEmailForm />
    </Suspense>
  )
}

/**
 * Client-side verify email page component.
 * Displays the Klaas branding and email verification status.
 */
export default function VerifyEmailPageClient(): ReactElement {
  return (
    <div className="verify-email-page min-h-screen flex items-center
      justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <AppIcon className="mr-3" size={40} />
            <h1 className="text-3xl font-bold font-mono text-[#fafafa]">
              klaas
            </h1>
          </div>
          <p className="text-[#a1a1aa]">
            Verifying your email
          </p>
        </div>

        <FormWrapper />
      </div>
    </div>
  )
}
