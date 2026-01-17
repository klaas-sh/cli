import React from 'react'
import SetupPasswordPageClient from './page-client'

/**
 * Server-side wrapper for setup password page.
 * Forces dynamic rendering to prevent static pre-rendering.
 */
export const dynamic = 'force-dynamic'

export default function SetupPasswordPage(): React.JSX.Element {
  return <SetupPasswordPageClient />
}
