'use client'

import React from 'react'
import { clsx } from 'clsx'

/**
 * Password strength level
 */
export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong'

/**
 * Password strength result
 */
export interface PasswordStrengthResult {
  /** The strength level */
  strength: PasswordStrength
  /** Human-readable label */
  label: string
  /** Score from 0-4 */
  score: number
  /** Feedback messages for improvement */
  feedback: string[]
}

/**
 * Calculates password strength based on various criteria.
 * Requires minimum 12 characters for E2EE.
 *
 * @param password - The password to evaluate
 * @returns Password strength result with score and feedback
 */
export function calculatePasswordStrength(
  password: string
): PasswordStrengthResult {
  const feedback: string[] = []
  let score = 0

  // Length checks
  if (password.length >= 12) {
    score += 1
  } else {
    feedback.push('Use at least 12 characters')
  }

  if (password.length >= 16) {
    score += 1
  }

  // Character variety checks
  if (/[a-z]/.test(password)) {
    score += 0.5
  } else {
    feedback.push('Add lowercase letters')
  }

  if (/[A-Z]/.test(password)) {
    score += 0.5
  } else {
    feedback.push('Add uppercase letters')
  }

  if (/[0-9]/.test(password)) {
    score += 0.5
  } else {
    feedback.push('Add numbers')
  }

  if (/[^a-zA-Z0-9]/.test(password)) {
    score += 0.5
  } else {
    feedback.push('Add special characters')
  }

  // Penalize common patterns
  const commonPatterns = [
    /^(.)\1+$/,              // Repeated characters
    /^123456/,               // Sequential numbers
    /^abcdef/i,              // Sequential letters
    /password/i,             // Common word
    /qwerty/i,               // Keyboard pattern
  ]

  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      score = Math.max(0, score - 1)
      feedback.push('Avoid common patterns')
      break
    }
  }

  // Normalize score to 0-4
  const normalizedScore = Math.min(4, Math.max(0, Math.floor(score)))

  type StrengthInfo = { strength: PasswordStrength; label: string }
  const strengthMap: Record<number, StrengthInfo> = {
    0: { strength: 'weak', label: 'Weak' },
    1: { strength: 'weak', label: 'Weak' },
    2: { strength: 'fair', label: 'Fair' },
    3: { strength: 'good', label: 'Good' },
    4: { strength: 'strong', label: 'Strong' },
  }

  const { strength, label } = strengthMap[normalizedScore]

  return {
    strength,
    label,
    score: normalizedScore,
    feedback: feedback.slice(0, 3), // Limit to 3 feedback items
  }
}

interface PasswordStrengthIndicatorProps {
  /** The password to evaluate */
  password: string
  /** Whether to show feedback messages */
  showFeedback?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Visual password strength indicator component.
 * Displays a colored bar and strength label based on password quality.
 */
export function PasswordStrengthIndicator({
  password,
  showFeedback = true,
  className,
}: PasswordStrengthIndicatorProps): React.JSX.Element | null {
  if (!password) {
    return null
  }

  const result = calculatePasswordStrength(password)

  const strengthColors: Record<PasswordStrength, string> = {
    weak: 'bg-red-500',
    fair: 'bg-yellow-500',
    good: 'bg-app-primary',
    strong: 'bg-green-500',
  }

  const strengthTextColors: Record<PasswordStrength, string> = {
    weak: 'text-red-600 dark:text-red-400',
    fair: 'text-yellow-600 dark:text-yellow-400',
    good: 'text-app-primary dark:text-app-primary-dark',
    strong: 'text-green-600 dark:text-green-400',
  }

  const barWidths: Record<number, string> = {
    0: 'w-0',
    1: 'w-1/4',
    2: 'w-2/4',
    3: 'w-3/4',
    4: 'w-full',
  }

  return (
    <div className={clsx('space-y-2', className)}>
      {/* Strength bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full
          overflow-hidden">
          <div
            className={clsx(
              'h-full rounded-full transition-all duration-300',
              strengthColors[result.strength],
              barWidths[result.score]
            )}
          />
        </div>
        <span
          className={clsx(
            'text-sm font-medium min-w-[60px] text-right',
            strengthTextColors[result.strength]
          )}
        >
          {result.label}
        </span>
      </div>

      {/* Feedback messages */}
      {showFeedback && result.feedback.length > 0 && (
        <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          {result.feedback.map((message, index) => (
            <li key={index} className="flex items-center gap-1">
              <span className="text-gray-400">-</span>
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
