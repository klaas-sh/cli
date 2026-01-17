'use client'

import React, { useState } from 'react'
import { User, ChevronDown, Menu, LogOut } from 'lucide-react'
import { clsx } from 'clsx'

interface HeaderProps {
  onMenuClick?: () => void
}

/**
 * Header component for the klaas dashboard.
 * Uses the klaas dark theme with amber accents.
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
        'h-[73px] flex items-center px-6',
        'bg-app-bg-void/80 backdrop-blur-sm',
        'border-b border-app-border-subtle'
      )}
    >
      <div className="flex items-center justify-between w-full">
        {/* Left Side - Mobile menu button */}
        <div className="flex items-center">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className={clsx(
                'p-2 -ml-2 rounded-lg transition-colors lg:hidden',
                'text-app-text-muted hover:text-app-text-primary',
                'hover:bg-app-bg-elevated touch-manipulation'
              )}
              aria-label="Open menu"
            >
              <Menu className="h-6 w-6" />
            </button>
          )}
        </div>

        {/* Right Side Actions */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className={clsx(
                'flex items-center gap-2 p-2 rounded-lg transition-colors',
                'text-app-text-secondary hover:text-app-text-primary',
                'hover:bg-app-bg-elevated touch-manipulation'
              )}
            >
              <div
                className={clsx(
                  'h-8 w-8 bg-app-accent rounded-full',
                  'flex items-center justify-center'
                )}
              >
                <User className="h-4 w-4 text-app-bg-void" />
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
                  'absolute right-0 mt-2 w-48 rounded-lg shadow-lg py-1 z-[100]',
                  'bg-app-bg-surface border border-app-border-visible'
                )}
              >
                <a
                  href="/settings"
                  className={clsx(
                    'block px-4 py-3 text-sm transition-colors',
                    'text-app-text-secondary hover:text-app-text-primary',
                    'hover:bg-app-bg-elevated touch-manipulation'
                  )}
                >
                  Settings
                </a>
                <hr className="my-1 border-app-border-subtle" />
                <button
                  onClick={handleSignOut}
                  className={clsx(
                    'flex items-center gap-2 w-full text-left px-4 py-3',
                    'text-sm text-app-error hover:bg-app-error/10',
                    'touch-manipulation'
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
