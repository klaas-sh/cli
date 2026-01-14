/**
 * Date formatting utilities for the Klaas Dashboard.
 * Format: day.month.fullyear (e.g., 12.08.2024 or 12 August 2024)
 */

/**
 * Format date as DD.MM.YYYY
 * @param date - Date string or Date object to format
 * @returns Formatted date string or '-' if invalid
 */
export function formatDate(
  date: string | Date | undefined | null
): string {
  if (!date) { return '-' }

  const d = new Date(date)
  if (isNaN(d.getTime())) { return '-' }

  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const year = d.getFullYear()

  return `${day}.${month}.${year}`
}

/**
 * Format date with time: DD.MM.YYYY HH:MM
 * @param date - Date string or Date object to format
 * @returns Formatted date-time string or '-' if invalid
 */
export function formatDateTime(
  date: string | Date | undefined | null
): string {
  if (!date) { return '-' }

  const d = new Date(date)
  if (isNaN(d.getTime())) { return '-' }

  const dateStr = formatDate(date)
  const hours = d.getHours().toString().padStart(2, '0')
  const minutes = d.getMinutes().toString().padStart(2, '0')

  return `${dateStr} ${hours}:${minutes}`
}

/**
 * Format relative time (e.g., "2 hours ago", "3 days ago").
 * Uses Math.round() for proper display accuracy.
 * @param date - Date string or Date object to format
 * @returns Relative time string or '-' if invalid
 */
export function formatRelativeTime(
  date: string | Date | undefined | null
): string {
  if (!date) { return '-' }

  const d = new Date(date)
  if (isNaN(d.getTime())) { return '-' }

  const now = new Date()
  const diffMs = Math.abs(now.getTime() - d.getTime())

  // Calculate each unit directly from milliseconds for accuracy
  const MS_PER_MINUTE = 60 * 1000
  const MS_PER_HOUR = 60 * MS_PER_MINUTE
  const MS_PER_DAY = 24 * MS_PER_HOUR

  if (diffMs >= 30 * MS_PER_DAY) { return formatDate(date) }
  if (diffMs >= MS_PER_DAY) {
    const days = Math.round(diffMs / MS_PER_DAY)
    return `${days} day${days === 1 ? '' : 's'} ago`
  }
  if (diffMs >= MS_PER_HOUR) {
    const hours = Math.round(diffMs / MS_PER_HOUR)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  if (diffMs >= MS_PER_MINUTE) {
    const minutes = Math.round(diffMs / MS_PER_MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  return 'Just now'
}

/**
 * Format date with month name: DD Month YYYY
 * @param date - Date string or Date object to format
 * @returns Formatted date string with month name or '-' if invalid
 */
export function formatDateLong(
  date: string | Date | undefined | null
): string {
  if (!date) { return '-' }

  const d = new Date(date)
  if (isNaN(d.getTime())) { return '-' }

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November',
    'December'
  ]

  const day = d.getDate()
  const month = months[d.getMonth()]
  const year = d.getFullYear()

  return `${day} ${month} ${year}`
}

/**
 * Format date with full time including seconds: DD.MM.YYYY HH:MM:SS
 * @param date - Date string or Date object to format
 * @returns Formatted date-time string with seconds or '-' if invalid
 */
export function formatDateTimeFull(
  date: string | Date | undefined | null
): string {
  if (!date) { return '-' }

  const d = new Date(date)
  if (isNaN(d.getTime())) { return '-' }

  const dateStr = formatDate(date)
  const hours = d.getHours().toString().padStart(2, '0')
  const minutes = d.getMinutes().toString().padStart(2, '0')
  const seconds = d.getSeconds().toString().padStart(2, '0')

  return `${dateStr} ${hours}:${minutes}:${seconds}`
}

/**
 * Format time only in 24H format: HH:MM
 * @param date - Date string or Date object to format
 * @returns Formatted time string or '-' if invalid
 */
export function formatTime(
  date: string | Date | undefined | null
): string {
  if (!date) { return '-' }

  const d = new Date(date)
  if (isNaN(d.getTime())) { return '-' }

  const hours = d.getHours().toString().padStart(2, '0')
  const minutes = d.getMinutes().toString().padStart(2, '0')

  return `${hours}:${minutes}`
}
