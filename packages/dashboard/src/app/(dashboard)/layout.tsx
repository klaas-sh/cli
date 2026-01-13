import React from 'react'
import DashboardLayout from './layout-client'

/**
 * Force dynamic rendering for all dashboard pages.
 * This prevents static pre-rendering and ensures auth checks run on each
 * request.
 */
export const dynamic = 'force-dynamic'

/**
 * Server-side wrapper layout for the dashboard.
 * Delegates to the client layout for sidebar, header, and auth functionality.
 */
export default function Layout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <DashboardLayout>{children}</DashboardLayout>
}
