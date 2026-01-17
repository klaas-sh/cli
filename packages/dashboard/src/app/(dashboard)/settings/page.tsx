'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { clsx } from 'clsx'
import {
  User,
  Calendar,
  Clock,
  Info,
  Shield,
  Loader2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EncryptionSettings } from '@/components/settings'
import { dashboardApi } from '@/lib/dashboard-api'

interface UserProfile {
  id: string
  email: string
  createdAt: string
}

/**
 * Calculate account age from creation date
 */
function getAccountAge(createdAt: string): string {
  const created = new Date(createdAt)
  const now = new Date()
  const diffMs = now.getTime() - created.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 1) {
    return 'Less than a day'
  } else if (diffDays === 1) {
    return '1 day'
  } else if (diffDays < 30) {
    return `${diffDays} days`
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30)
    return months === 1 ? '1 month' : `${months} months`
  } else {
    const years = Math.floor(diffDays / 365)
    const remainingMonths = Math.floor((diffDays % 365) / 30)
    if (remainingMonths === 0) {
      return years === 1 ? '1 year' : `${years} years`
    }
    const monthSuffix = remainingMonths > 1 ? 's' : ''
    return years === 1
      ? `1 year, ${remainingMonths} month${monthSuffix}`
      : `${years} years, ${remainingMonths} month${monthSuffix}`
  }
}

/**
 * Format date for display
 */
function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

/**
 * Settings Page
 *
 * Settings page with Profile and Encryption tabs.
 * Profile shows account information, Encryption manages E2EE settings.
 */
export default function SettingsPage(): React.JSX.Element {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') || 'profile'

  const [activeTab, setActiveTab] = useState(initialTab)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load user profile
  const loadProfile = useCallback(async (): Promise<void> => {
    try {
      const data = await dashboardApi.getProfile()
      setUser(data)
    } catch {
      // Silently fail - profile will show loading state
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  // Update active tab when URL changes
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ['profile', 'encryption'].includes(tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

  const tabs = [
    { id: 'profile', label: 'Profile', icon: <User className="h-4 w-4" /> },
    {
      id: 'encryption',
      label: 'Encryption',
      icon: <Shield className="h-4 w-4" />,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Settings
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage your account settings and preferences
        </p>
      </div>

      {/* Settings Tabs */}
      <div>
        {/* Tab Navigation */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={clsx(
                  'py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap',
                  'focus:outline-none inline-flex items-center gap-x-2',
                  activeTab === tab.id
                    ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                  'dark:text-gray-400 dark:hover:text-gray-300'
                )}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`tab-panel-${tab.id}`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="mt-6 space-y-6">
            {/* Coming Soon Notice */}
            <Card className="p-4 bg-violet-50 dark:bg-violet-900/20
              border-violet-200 dark:border-violet-800">
              <div className="flex items-center gap-3">
                <Info className="h-5 w-5 text-violet-600 dark:text-violet-400
                  flex-shrink-0" />
                <p className="text-sm text-violet-700 dark:text-violet-300">
                  Profile editing functionality will be available in a future
                  update. For now, you can view your account information below.
                </p>
              </div>
            </Card>

            {/* Profile Info */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white
                mb-6">
                Account Information
              </h3>

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
                </div>
              ) : user ? (
                <div className="space-y-6">
                  {/* Email */}
                  <div>
                    <label className="block text-sm font-medium text-gray-500
                      dark:text-gray-400 mb-1">
                      Email Address
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 px-3 py-2 bg-gray-100
                        dark:bg-gray-800 rounded-lg border border-gray-200
                        dark:border-gray-700">
                        <span className="text-gray-900 dark:text-white
                          font-mono text-sm">
                          {user.email}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Account Created */}
                  <div>
                    <label className="block text-sm font-medium text-gray-500
                      dark:text-gray-400 mb-1">
                      Account Created
                    </label>
                    <div className="flex items-center gap-3 px-3 py-2
                      bg-gray-100 dark:bg-gray-800 rounded-lg border
                      border-gray-200 dark:border-gray-700">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-900 dark:text-white text-sm">
                        {formatDateTime(user.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Account Age */}
                  <div>
                    <label className="block text-sm font-medium text-gray-500
                      dark:text-gray-400 mb-1">
                      Account Age
                    </label>
                    <div className="flex items-center gap-3 px-3 py-2
                      bg-gray-100 dark:bg-gray-800 rounded-lg border
                      border-gray-200 dark:border-gray-700">
                      <Clock className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-900 dark:text-white text-sm">
                        {getAccountAge(user.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500
                  dark:text-gray-400">
                  Unable to load profile information
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Encryption Tab */}
        {activeTab === 'encryption' && (
          <div className="mt-6 space-y-6">
            <Card className="p-6">
              <EncryptionSettings />
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
