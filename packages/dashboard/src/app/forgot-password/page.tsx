import React from 'react'
import ForgotPasswordPageClient from './page-client'

/**
 * Server-side wrapper for forgot password page.
 * Forces dynamic rendering to prevent static pre-rendering.
 */
export const dynamic = 'force-dynamic'

export default function ForgotPasswordPage(): React.JSX.Element {
  return <ForgotPasswordPageClient />
}
