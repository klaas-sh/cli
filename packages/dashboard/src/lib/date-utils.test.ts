import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatDateTime, formatRelativeTime } from './date-utils'

describe('date-utils', () => {
  beforeEach(() => {
    // Mock Date.now to return a fixed timestamp
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('formatDateTime', () => {
    it('should format ISO date string', () => {
      const result = formatDateTime('2024-01-15T10:30:00.000Z')
      expect(result).toBeTruthy()
      expect(typeof result).toBe('string')
    })
  })

  describe('formatRelativeTime', () => {
    it('should format time relative to now', () => {
      const oneHourAgo = '2024-01-15T11:00:00.000Z'
      const result = formatRelativeTime(oneHourAgo)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('string')
    })

    it('should handle recent timestamps', () => {
      const fiveMinutesAgo = '2024-01-15T11:55:00.000Z'
      const result = formatRelativeTime(fiveMinutesAgo)
      expect(result).toBeTruthy()
    })
  })
})
