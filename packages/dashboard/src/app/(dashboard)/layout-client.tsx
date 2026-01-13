'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { MobileDrawer } from '@/components/layout/mobile-drawer'
import { ToastProvider } from '@/components/ui/toast'

/**
 * Dashboard content wrapper with sidebar and header layout.
 * Handles sidebar collapse state and mobile drawer.
 */
function DashboardContent({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebarCollapsed') === 'true'
    }
    return false
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleCloseMobileMenu = useCallback(() => {
    setMobileMenuOpen(false)
  }, [])

  useEffect(() => {
    const handleSidebarToggle = (event: CustomEvent): void => {
      setSidebarCollapsed(event.detail.isCollapsed)
    }

    window.addEventListener(
      'sidebarToggle',
      handleSidebarToggle as EventListener
    )
    return (): void => {
      window.removeEventListener(
        'sidebarToggle',
        handleSidebarToggle as EventListener
      )
    }
  }, [])

  // Responsive margin classes: no margin on mobile, sidebar margin on lg+
  const headerMarginClass = sidebarCollapsed
    ? 'lg:ml-[72px]'
    : 'lg:ml-64'
  const contentMarginClass = sidebarCollapsed
    ? 'lg:ml-[72px]'
    : 'lg:ml-64'

  return (
    <ToastProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {/* Desktop sidebar - hidden on mobile */}
        <Sidebar />

        {/* Mobile drawer */}
        <MobileDrawer
          isOpen={mobileMenuOpen}
          onClose={handleCloseMobileMenu}
        />

        {/* Header - full width on mobile, offset for sidebar on desktop */}
        <div className={`fixed top-0 right-0 left-0 transition-all
          duration-300 ${headerMarginClass} z-40`}>
          <Header onMenuClick={() => setMobileMenuOpen(true)} />
        </div>

        {/* Main content - full width on mobile, offset on desktop */}
        <div className={`transition-all duration-300 pt-[73px]
          ${contentMarginClass}`}>
          <main className="px-4 py-4 sm:px-6">
            <div className="w-full">
              {children}
            </div>
          </main>
        </div>
      </div>
    </ToastProvider>
  )
}

/**
 * Dashboard layout with authentication check.
 * Redirects to login if user is not authenticated.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const router = useRouter()

  useEffect(() => {
    // Check authentication
    const token = localStorage.getItem('user-token')
    if (!token) {
      router.push('/login')
    }
  }, [router])

  return <DashboardContent>{children}</DashboardContent>
}
