import React from 'react'
import DeviceCodePageClient from './page-client'

interface DeviceCodePageProps {
  params: Promise<{ code: string }>
}

/**
 * Server-side wrapper for device authorization page with pre-filled code.
 * Forces dynamic rendering to prevent static pre-rendering.
 */
export const dynamic = 'force-dynamic'

export default async function DeviceCodePage({
  params
}: DeviceCodePageProps): Promise<React.JSX.Element> {
  const { code } = await params
  return <DeviceCodePageClient code={code} />
}
