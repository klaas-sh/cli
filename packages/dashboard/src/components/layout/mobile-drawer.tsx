'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { clsx } from 'clsx'
import { AppIcon } from '../icons/app-icon'
import { navigationItems, settingsItem } from './navigation-config'

interface MobileDrawerProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Mobile navigation drawer for the Nexo dashboard
 *
 * Slides in from the left on mobile devices.
 * Uses blue color scheme for branding consistency.
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
          'fixed inset-0 bg-black/50 z-40 lg:hidden',
          'transition-opacity duration-300'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={clsx(
          'fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-800',
          'z-50 lg:hidden transform transition-transform duration-300',
          'shadow-xl'
        )}
      >
        {/* Header */}
        <div
          className={clsx(
            'flex h-[73px] min-h-[73px] items-center justify-between',
            'px-4 border-b border-gray-200 dark:border-gray-700'
          )}
        >
          <div className="flex items-center gap-2">
            <AppIcon
              className="text-blue-600 dark:text-blue-400"
              size={32}
            />
            <span
              className={clsx(
                'text-xl font-bold text-gray-900 dark:text-white'
              )}
            >
              Nexo
            </span>
          </div>
          <button
            onClick={onClose}
            className={clsx(
              'p-1.5 rounded-lg text-gray-500 hover:text-gray-700',
              'hover:bg-gray-100 dark:text-gray-400',
              'dark:hover:text-gray-300 dark:hover:bg-gray-700'
            )}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav
          className={clsx(
            'flex-1 px-3 py-4 space-y-2 overflow-y-auto',
            'bg-gray-50 dark:bg-gray-900 h-[calc(100%-73px-80px)]'
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
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 ' +
                      'dark:text-blue-400'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 ' +
                      'dark:hover:bg-gray-700'
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
                <span>{item.name}</span>
                {item.badge && (
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
        <div
          className={clsx(
            'absolute bottom-0 left-0 right-0 px-3 py-4',
            'bg-gray-50 dark:bg-gray-900 border-t',
            'border-gray-200 dark:border-gray-700'
          )}
        >
          <Link
            href={settingsItem.href}
            className={clsx(
              'flex items-center gap-3 px-3 py-3 text-sm',
              'font-medium rounded-lg transition-colors',
              pathname.startsWith(settingsItem.href)
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 ' +
                  'dark:text-blue-400'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 ' +
                  'dark:hover:bg-gray-700'
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
            <span>{settingsItem.name}</span>
          </Link>
        </div>
      </div>
    </>
  )
}
