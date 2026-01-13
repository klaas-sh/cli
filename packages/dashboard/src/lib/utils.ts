/**
 * Utility functions for RedirMe Admin
 */

import { clsx, type ClassValue } from 'clsx'
import { ulid } from 'ulid'

/**
 * Merge class names
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}

/**
 * Format date to readable string
 */
export function formatDate(date: string | Date, options?: {
  relative?: boolean
  includeTime?: boolean
}): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date

  if (options?.relative) {
    const now = new Date()
    const diff = now.getTime() - dateObj.getTime()
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) {
      return `${days} day${days !== 1 ? 's' : ''} ago`
    }
    if (hours > 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`
    }
    if (minutes > 0) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
    }
    return 'Just now'
  }

  const formatOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }

  if (options?.includeTime) {
    formatOptions.hour = '2-digit'
    formatOptions.minute = '2-digit'
  }

  return dateObj.toLocaleDateString('en-US', formatOptions)
}

/**
 * Format date as relative time from now (e.g., "in 2 days", "3 hours ago")
 * Uses Math.round() for proper display (24h shows as "24 hours", not "23 hours")
 */
export function formatRelativeTime(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = dateObj.getTime() - now.getTime()
  const absDiffMs = Math.abs(diffMs)

  // Calculate each unit directly from milliseconds for accuracy
  const MS_PER_MINUTE = 60 * 1000
  const MS_PER_HOUR = 60 * MS_PER_MINUTE
  const MS_PER_DAY = 24 * MS_PER_HOUR
  const MS_PER_MONTH = 30 * MS_PER_DAY
  const MS_PER_YEAR = 365 * MS_PER_DAY

  const isPast = diffMs < 0
  const suffix = isPast ? 'ago' : 'from now'
  const prefix = isPast ? '' : 'in '

  // Use round for the displayed unit for better accuracy
  if (absDiffMs >= MS_PER_YEAR) {
    const years = Math.round(absDiffMs / MS_PER_YEAR)
    return `${prefix}${years} year${years !== 1 ? 's' : ''} ${suffix}`
  }
  if (absDiffMs >= MS_PER_MONTH) {
    const months = Math.round(absDiffMs / MS_PER_MONTH)
    return `${prefix}${months} month${months !== 1 ? 's' : ''} ${suffix}`
  }
  if (absDiffMs >= MS_PER_DAY) {
    const days = Math.round(absDiffMs / MS_PER_DAY)
    return `${prefix}${days} day${days !== 1 ? 's' : ''} ${suffix}`
  }
  if (absDiffMs >= MS_PER_HOUR) {
    const hours = Math.round(absDiffMs / MS_PER_HOUR)
    return `${prefix}${hours} hour${hours !== 1 ? 's' : ''} ${suffix}`
  }
  if (absDiffMs >= MS_PER_MINUTE) {
    const minutes = Math.round(absDiffMs / MS_PER_MINUTE)
    return `${prefix}${minutes} minute${minutes !== 1 ? 's' : ''} ${suffix}`
  }
  return isPast ? 'just now' : 'in a moment'
}

/**
 * Format number with European formatting (dot as thousands separator)
 * Examples: 1.000, 35.000, 1.234.567
 * Returns '0' for undefined/null values
 */
export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null) {
    return '0'
  }
  return num.toLocaleString('de-DE')
}

/**
 * Validate email address
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Generate ULID (ALWAYS use this for IDs - NEVER use UUID or anything else!)
 * @deprecated Use generateULID() instead
 */
export function generateId(): string {
  return generateULID()
}

/**
 * Generate a ULID (Universally Unique Lexicographically Sortable Identifier)
 * ALWAYS use this for generating IDs - NEVER use UUID or anything else!
 */
export function generateULID(): string {
  return ulid()
}

/**
 * Debounce function
 */
export function debounce<Args extends unknown[], R>(
  func: (...args: Args) => R,
  wait: number
): (...args: Args) => void {
  let timeout: NodeJS.Timeout | null = null

  return (...args: Args) => {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => func(...args), wait)
  }
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

/**
 * Sleep function
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Download data as file
 */
export function downloadFile(
  data: string,
  filename: string,
  type = 'text/plain'
): void {
  const blob = new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  if (bytes === 0) {
    return '0 Bytes'
  }
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = Math.round((bytes / Math.pow(1024, i)) * 100) / 100
  return `${size} ${sizes[i]}`
}

/**
 * Get initials from name
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('')
}

/**
 * Generate avatar background color based on string
 */
export function getAvatarColor(str: string): string {
  const colors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-yellow-500',
    'bg-lime-500',
    'bg-green-500',
    'bg-emerald-500',
    'bg-teal-500',
    'bg-cyan-500',
    'bg-sky-500',
    'bg-blue-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-purple-500',
    'bg-fuchsia-500',
    'bg-pink-500',
    'bg-rose-500',
  ]

  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }

  return colors[Math.abs(hash) % colors.length]
}

/**
 * Truncate text
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) {
    return text
  }
  return text.slice(0, length) + '...'
}

/**
 * Parse error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'An unknown error occurred'
}
