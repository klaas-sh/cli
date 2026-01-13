import React from 'react'
import LoginPageClient from './page-client'

/**
 * Server-side wrapper for login page.
 * Forces dynamic rendering to prevent static pre-rendering.
 */
export const dynamic = 'force-dynamic'

export default function LoginPage(): React.JSX.Element {
  return <LoginPageClient />
}
