'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Dashboard home page.
 * Redirects to the sessions page as it is the main dashboard feature.
 */
export default function DashboardPage(): React.JSX.Element {
  const router = useRouter()

  useEffect(() => {
    router.replace('/sessions')
  }, [router])

  return (
    <div className="flex h-full items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-4
          border-app-primary border-t-transparent"
      />
    </div>
  )
}
