import React from 'react'
import ResetPasswordPageClient from './page-client'

/**
 * Server-side wrapper for reset password page.
 * Forces dynamic rendering to prevent static pre-rendering.
 */
export const dynamic = 'force-dynamic'

export default function ResetPasswordPage(): React.JSX.Element {
  return <ResetPasswordPageClient />
}
