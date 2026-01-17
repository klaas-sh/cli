import React from 'react'
import SetupMfaPageClient from './page-client'

/**
 * Server-side wrapper for MFA setup page.
 * Forces dynamic rendering to prevent static pre-rendering.
 */
export const dynamic = 'force-dynamic'

export default function SetupMfaPage(): React.JSX.Element {
  return <SetupMfaPageClient />
}
