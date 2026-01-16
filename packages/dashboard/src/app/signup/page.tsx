import React from 'react'
import SignupPageClient from './page-client'

/**
 * Server-side wrapper for signup page.
 * Forces dynamic rendering to prevent static pre-rendering.
 */
export const dynamic = 'force-dynamic'

export default function SignupPage(): React.JSX.Element {
  return <SignupPageClient />
}
