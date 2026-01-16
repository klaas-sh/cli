'use client'

import React from 'react'
import { EncryptionSettings } from '@/components/settings'

/**
 * Settings page.
 * Provides user configuration options including E2EE settings.
 */
export default function SettingsPage(): React.JSX.Element {
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900
          dark:text-white">
          Settings
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage your account and security preferences
        </p>
      </div>

      {/* Settings Sections */}
      <div className="grid gap-8">
        {/* Encryption Settings Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm
          border border-gray-200 dark:border-gray-700 p-6">
          <EncryptionSettings />
        </div>

        {/* Placeholder for future settings sections */}
        {/*
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm
          border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Other Settings
          </h2>
        </div>
        */}
      </div>
    </div>
  )
}
