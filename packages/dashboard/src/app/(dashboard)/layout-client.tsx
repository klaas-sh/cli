'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { MobileDrawer } from '@/components/layout/mobile-drawer'
import { ToastProvider } from '@/components/ui/toast'
import { useEncryption } from '@/hooks/use-encryption'

/**
 * Dashboard content wrapper with sidebar and header layout.
 * Uses the klaas dark theme with amber accents.
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
      <div className="min-h-screen bg-[#09090b]">
        {/* Fixed grid pattern overlay - exact match to klaas.sh */}
        <div
          className="fixed inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px)
            `,
            backgroundSize: '64px 64px',
          }}
        />
        {/* Amber glow - top right */}
        <div
          className="fixed w-[800px] h-[800px] -top-[400px] -right-[200px]
            opacity-15 pointer-events-none z-0"
          style={{
            background: `radial-gradient(
              circle,
              rgba(245, 158, 11, 0.4) 0%,
              transparent 70%
            )`,
            filter: 'blur(120px)',
          }}
        />
        {/* Cyan glow - bottom left */}
        <div
          className="fixed w-[600px] h-[600px] -bottom-[200px] -left-[300px]
            opacity-[0.08] pointer-events-none z-0"
          style={{
            background: `radial-gradient(
              circle,
              rgba(34, 211, 238, 0.3) 0%,
              transparent 70%
            )`,
            filter: 'blur(120px)',
          }}
        />

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
          <main className="px-4 py-6 sm:px-6">
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
 * Auto-initializes E2EE on mount.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const router = useRouter()
  const { autoInitialize } = useEncryption()

  useEffect(() => {
    // Check authentication
    const token = localStorage.getItem('user-token')
    if (!token) {
      router.push('/login')
      return
    }

    // Auto-initialize E2EE (runs silently in background)
    autoInitialize()
  }, [router, autoInitialize])

  return <DashboardContent>{children}</DashboardContent>
}
