'use client'

import { type ReactElement } from 'react'
import { useRouter } from 'next/navigation'
import { MFASetup } from '@/components/auth/mfa-setup'
import { AppIcon } from '@/components/icons/app-icon'

/**
 * Client-side MFA setup page component.
 * Displays the Klaas branding and MFA setup wizard.
 */
export default function SetupMfaPageClient(): ReactElement {
  const router = useRouter()

  /**
   * Handle MFA setup completion
   */
  const handleComplete = (): void => {
    router.push('/')
  }

  /**
   * Handle MFA setup cancellation
   */
  const handleCancel = (): void => {
    router.push('/')
  }

  return (
    <div className="setup-mfa-page min-h-screen flex items-center
      justify-center px-4 py-8">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <AppIcon className="mr-3" size={40} />
            <h1 className="text-3xl font-bold font-mono text-[#fafafa]">
              klaas
            </h1>
          </div>
        </div>

        <MFASetup
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
      </div>
    </div>
  )
}
