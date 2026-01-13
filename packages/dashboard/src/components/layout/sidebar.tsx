'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { AppIcon } from '../icons/app-icon'
import { navigationItems, settingsItem } from './navigation-config'

/**
 * Sidebar component for the Nexo dashboard
 *
 * Provides navigation with collapsible functionality.
 * Uses blue color scheme and minimal navigation items.
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
          'flex h-[73px] min-h-[73px] backdrop-blur-sm bg-opacity-80',
          'items-center justify-between px-4 bg-white dark:bg-gray-800',
          'border-b border-gray-200 dark:border-gray-700'
        )}
      >
        <div className="flex items-center gap-2">
          <AppIcon
            className="text-blue-600 dark:text-blue-400"
            size={32}
          />
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  'whitespace-nowrap overflow-hidden text-xl font-bold',
                  'text-gray-900 dark:text-white'
                )}
              >
                Nexo
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={clsx(
            'p-1.5 rounded-lg text-gray-500 hover:text-gray-700',
            'hover:bg-gray-100 dark:text-gray-400',
            'dark:hover:text-gray-300 dark:hover:bg-gray-700'
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
          'flex-1 px-3 py-4 space-y-2 overflow-y-auto scrollbar-thin',
          'scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600',
          'bg-gray-50 dark:bg-gray-900'
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
                'flex items-center gap-3 px-3 py-2 text-sm',
                'font-medium rounded-lg transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 ' +
                    'dark:text-blue-400'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 ' +
                    'dark:hover:bg-gray-700'
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
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-gray-400 dark:text-gray-500'
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
                    'ml-auto rounded-full bg-blue-100',
                    'dark:bg-blue-900/20 px-2 py-0.5 text-xs',
                    'font-medium text-blue-700 dark:text-blue-400'
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
      <div className="px-3 py-4 bg-gray-50 dark:bg-gray-900">
        <Link
          href={settingsItem.href}
          className={clsx(
            'flex items-center gap-3 px-3 py-2 text-sm',
            'font-medium rounded-lg transition-colors',
            pathname.startsWith(settingsItem.href)
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 ' +
                'dark:text-blue-400'
              : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 ' +
                'dark:hover:bg-gray-700'
          )}
        >
          <div
            className={clsx(
              'flex items-center justify-center',
              isCollapsed && 'w-5 h-5'
            )}
          >
            <settingsItem.icon
              className={clsx(
                'h-5 w-5 flex-shrink-0',
                pathname.startsWith(settingsItem.href)
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-400 dark:text-gray-500'
              )}
            />
          </div>
          {!isCollapsed && (
            <span className="whitespace-nowrap overflow-hidden">
              {settingsItem.name}
            </span>
          )}
        </Link>
        {/* Version placeholder */}
        <div
          className={clsx(
            'mt-3 text-xs text-gray-400 dark:text-gray-600',
            isCollapsed ? 'text-center' : 'px-3'
          )}
        >
          {isCollapsed ? 'v0' : 'v0.0.1'}
        </div>
      </div>
    </div>
  )
}
