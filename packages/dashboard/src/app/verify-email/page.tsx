import React from 'react'
import VerifyEmailPageClient from './page-client'

/**
 * Server-side wrapper for verify email page.
 * Forces dynamic rendering to prevent static pre-rendering.
 */
export const dynamic = 'force-dynamic'

export default function VerifyEmailPage(): React.JSX.Element {
  return <VerifyEmailPageClient />
}
