import React from 'react'
import DevicePageClient from './page-client'

/**
 * Server-side wrapper for device authorization page.
 * Forces dynamic rendering to prevent static pre-rendering.
 */
export const dynamic = 'force-dynamic'

export default function DevicePage(): React.JSX.Element {
  return <DevicePageClient />
}
