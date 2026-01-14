'use client'

import React, { useState } from 'react'
import { User, ChevronDown, Menu, LogOut } from 'lucide-react'
import { clsx } from 'clsx'
import { ThemeSwitch } from '../theme-switch'

interface HeaderProps {
  onMenuClick?: () => void
}

/**
 * Header component for the Klaas dashboard
 *
 * Contains dark mode toggle and user menu.
 * Uses blue color scheme for branding consistency.
 */
export function Header({ onMenuClick }: HeaderProps): React.JSX.Element {
  const [showUserMenu, setShowUserMenu] = useState(false)

  /**
   * Handle sign out action
   */
  const handleSignOut = (): void => {
    localStorage.removeItem('user-token')
    const isProduction = process.env.NODE_ENV === 'production'
    const secureFlag = isProduction ? '; secure' : ''
    document.cookie =
      'user-token=; path=/; ' +
      'expires=Thu, 01 Jan 1970 00:00:01 GMT; ' +
      `samesite=strict${secureFlag}`
    window.location.href = '/login'
  }

  return (
    <header
      className={clsx(
        'h-[73px] backdrop-blur-sm bg-opacity-80 flex items-center',
        'bg-white dark:bg-gray-800 border-b border-gray-200',
        'dark:border-gray-700 px-6'
      )}
    >
      <div className="flex items-center justify-between w-full">
        {/* Left Side - Mobile menu button */}
        <div className="flex items-center">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className={clsx(
                'p-2 -ml-2 text-gray-500 hover:text-gray-700',
                'dark:text-gray-400 dark:hover:text-gray-300',
                'hover:bg-gray-100 dark:hover:bg-gray-700',
                'rounded-lg transition-colors lg:hidden touch-manipulation'
              )}
              aria-label="Open menu"
            >
              <Menu className="h-6 w-6" />
            </button>
          )}
        </div>

        {/* Right Side Actions */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Dark Mode Toggle */}
          <ThemeSwitch />

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className={clsx(
                'flex items-center gap-2 p-2 text-gray-700',
                'dark:text-gray-300 hover:bg-gray-100',
                'dark:hover:bg-gray-700 rounded-lg transition-colors',
                'touch-manipulation'
              )}
            >
              <div
                className={clsx(
                  'h-8 w-8 bg-app-primary rounded-full',
                  'flex items-center justify-center'
                )}
              >
                <User className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-medium hidden sm:inline">
                User
              </span>
              <ChevronDown className="h-4 w-4 hidden sm:block" />
            </button>

            {/* User Dropdown Menu */}
            {showUserMenu && (
              <div
                className={clsx(
                  'absolute right-0 mt-2 w-48 bg-white',
                  'dark:bg-gray-800 rounded-lg shadow-lg border',
                  'border-gray-200 dark:border-gray-700 py-1 z-[100]'
                )}
              >
                <a
                  href="/settings"
                  className={clsx(
                    'block px-4 py-3 text-sm text-gray-700',
                    'dark:text-gray-300 hover:bg-gray-100',
                    'dark:hover:bg-gray-700 touch-manipulation'
                  )}
                >
                  Settings
                </a>
                <hr className="my-1 border-gray-200 dark:border-gray-700" />
                <button
                  onClick={handleSignOut}
                  className={clsx(
                    'flex items-center gap-2 w-full text-left px-4 py-3',
                    'text-sm text-red-600 dark:text-red-400 hover:bg-red-50',
                    'dark:hover:bg-red-900/20 touch-manipulation'
                  )}
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
