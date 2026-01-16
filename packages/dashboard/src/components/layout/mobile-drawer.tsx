'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { clsx } from 'clsx'
import { AppIcon } from '../icons/app-icon'
import { navigationItems, footerNavigationItems } from './navigation-config'

interface MobileDrawerProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Mobile navigation drawer for the klaas dashboard.
 * Uses the klaas dark theme with amber accent colors.
 */
export function MobileDrawer({
  isOpen,
  onClose
}: MobileDrawerProps): React.JSX.Element {
  const pathname = usePathname()

  /**
   * Close drawer on escape key press
   */
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return (): void => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  /**
   * Close drawer when navigating
   */
  useEffect(() => {
    onClose()
  }, [pathname, onClose])

  if (!isOpen) {
    return <></>
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          'fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden',
          'transition-opacity duration-300'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={clsx(
          'fixed inset-y-0 left-0 w-64 bg-app-bg-surface',
          'z-50 lg:hidden transform transition-transform duration-300',
          'shadow-xl border-r border-app-border-subtle'
        )}
      >
        {/* Header */}
        <div
          className={clsx(
            'flex h-[73px] min-h-[73px] items-center justify-between',
            'px-4 border-b border-app-border-subtle'
          )}
        >
          <div className="flex items-center gap-2">
            <AppIcon size={32} />
            <span
              className={clsx(
                'text-lg font-semibold font-mono tracking-tight',
                'text-app-text-primary'
              )}
            >
              klaas
            </span>
          </div>
          <button
            onClick={onClose}
            className={clsx(
              'p-1.5 rounded-lg transition-colors',
              'text-app-text-muted hover:text-app-text-primary',
              'hover:bg-app-bg-elevated'
            )}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav
          className={clsx(
            'flex-1 px-3 py-4 space-y-1 overflow-y-auto',
            'bg-app-bg-deep h-[calc(100%-73px-130px)]'
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
                  'flex items-center gap-3 px-3 py-3 text-sm',
                  'font-medium rounded-lg transition-colors',
                  isActive
                    ? 'bg-app-accent-muted text-app-accent-light'
                    : 'text-app-text-secondary hover:text-app-text-primary ' +
                      'hover:bg-app-bg-elevated'
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
                <span>{item.name}</span>
                {item.badge && (
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
        <div
          className={clsx(
            'absolute bottom-0 left-0 right-0 px-3 py-4 space-y-1',
            'bg-app-bg-deep border-t border-app-border-subtle'
          )}
        >
          {footerNavigationItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.name}
                href={item.href}
                className={clsx(
                  'flex items-center gap-3 px-3 py-3 text-sm',
                  'font-medium rounded-lg transition-colors',
                  isActive
                    ? 'bg-app-accent-muted text-app-accent-light'
                    : 'text-app-text-secondary hover:text-app-text-primary ' +
                      'hover:bg-app-bg-elevated'
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
                <span>{item.name}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </>
  )
}
