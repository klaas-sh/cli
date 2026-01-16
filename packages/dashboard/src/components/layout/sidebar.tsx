'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { AppIcon } from '../icons/app-icon'
import { navigationItems, footerNavigationItems } from './navigation-config'

/**
 * Sidebar component for the klaas dashboard.
 * Uses the klaas dark theme with amber accent colors.
 */
export function Sidebar(): React.JSX.Element {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebarCollapsed') === 'true'
    }
    return false
  })
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebarCollapsed', isCollapsed.toString())
      window.dispatchEvent(
        new CustomEvent('sidebarToggle', { detail: { isCollapsed } })
      )
    }
  }, [isCollapsed])

  return (
    <div
      className={clsx(
        'fixed inset-y-0 left-0 z-50 flex flex-col transition-all',
        'duration-300 hidden lg:flex',
        isCollapsed ? 'w-[72px]' : 'w-64'
      )}
    >
      {/* Header - matching main header height */}
      <div
        className={clsx(
          'flex h-[73px] min-h-[73px]',
          'items-center justify-between px-4',
          'bg-app-bg-surface border-b border-app-border-subtle'
        )}
      >
        <div className="flex items-center gap-2">
          <AppIcon size={32} />
          {!isCollapsed && (
            <span
              className={clsx(
                'whitespace-nowrap overflow-hidden text-lg font-semibold',
                'font-mono tracking-tight text-app-text-primary'
              )}
            >
              klaas
            </span>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={clsx(
            'p-1.5 rounded-lg transition-colors',
            'text-app-text-muted hover:text-app-text-primary',
            'hover:bg-app-bg-elevated'
          )}
        >
          {isCollapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <ChevronLeft className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav
        className={clsx(
          'flex-1 px-3 py-4 space-y-1 overflow-y-auto',
          'bg-app-bg-deep'
        )}
      >
        {navigationItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 text-sm',
                'font-medium rounded-lg transition-colors',
                isActive
                  ? 'bg-app-accent-muted text-app-accent-light'
                  : 'text-app-text-secondary hover:text-app-text-primary ' +
                    'hover:bg-app-bg-elevated'
              )}
            >
              <div
                className={clsx(
                  'flex items-center justify-center',
                  isCollapsed && 'w-5 h-5'
                )}
              >
                <item.icon
                  className={clsx(
                    'h-5 w-5 flex-shrink-0',
                    isActive
                      ? 'text-app-accent'
                      : 'text-app-text-muted'
                  )}
                />
              </div>
              {!isCollapsed && (
                <span className="whitespace-nowrap overflow-hidden">
                  {item.name}
                </span>
              )}
              {item.badge && !isCollapsed && (
                <span
                  className={clsx(
                    'ml-auto rounded-full px-2 py-0.5 text-xs font-medium',
                    'bg-app-accent-muted text-app-accent'
                  )}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 bg-app-bg-deep space-y-1 border-t border-app-border-subtle">
        {footerNavigationItems.map((item) => {
          const isActive = pathname.startsWith(item.href)
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 text-sm',
                'font-medium rounded-lg transition-colors',
                isActive
                  ? 'bg-app-accent-muted text-app-accent-light'
                  : 'text-app-text-secondary hover:text-app-text-primary ' +
                    'hover:bg-app-bg-elevated'
              )}
            >
              <div
                className={clsx(
                  'flex items-center justify-center',
                  isCollapsed && 'w-5 h-5'
                )}
              >
                <item.icon
                  className={clsx(
                    'h-5 w-5 flex-shrink-0',
                    isActive
                      ? 'text-app-accent'
                      : 'text-app-text-muted'
                  )}
                />
              </div>
              {!isCollapsed && (
                <span className="whitespace-nowrap overflow-hidden">
                  {item.name}
                </span>
              )}
            </Link>
          )
        })}
        {/* Version */}
        <div
          className={clsx(
            'mt-3 text-xs font-mono text-app-text-dim',
            isCollapsed ? 'text-center' : 'px-3'
          )}
        >
          {isCollapsed ? 'v0' : 'v0.0.1'}
        </div>
      </div>
    </div>
  )
}
