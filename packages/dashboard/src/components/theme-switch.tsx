'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Moon, Sun } from 'lucide-react'

const DARK_MODE_KEY = 'dark-mode-preference'

/**
 * Theme switch component for Nexo dashboard
 *
 * Toggles between light and dark mode, persisting the preference
 * to localStorage and applying the dark class to the document element.
 */
export function ThemeSwitch(): React.JSX.Element {
  const [isDarkMode, setIsDarkMode] = useState(false)

  /**
   * Initialize dark mode from localStorage or system preference
   */
  useEffect(() => {
    const savedPreference = localStorage.getItem(DARK_MODE_KEY)

    if (savedPreference !== null) {
      const prefersDark = savedPreference === 'true'
      setIsDarkMode(prefersDark)
      if (prefersDark) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    } else {
      const systemPrefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches
      setIsDarkMode(systemPrefersDark)
      if (systemPrefersDark) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }
  }, [])

  /**
   * Toggle dark mode and save preference to localStorage
   */
  const toggleDarkMode = useCallback((): void => {
    const newValue = !isDarkMode
    setIsDarkMode(newValue)
    localStorage.setItem(DARK_MODE_KEY, String(newValue))

    if (newValue) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDarkMode])

  return (
    <button
      onClick={toggleDarkMode}
      className="p-2.5 sm:p-2 text-gray-500 hover:text-gray-700
        dark:text-gray-400 dark:hover:text-gray-300
        hover:bg-gray-100 dark:hover:bg-gray-700
        rounded-lg transition-colors touch-manipulation"
      title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDarkMode ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </button>
  )
}
