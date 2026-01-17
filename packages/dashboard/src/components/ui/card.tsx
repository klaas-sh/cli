import React from 'react'
import { clsx } from 'clsx'

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: boolean
  id?: string
}

/**
 * Card component with klaas dark theme styling.
 * Exact match to klaas.sh glow-card:
 * - background: #121216 at 50% opacity
 * - border-radius: 12px (rounded-xl)
 * - padding: 24px (p-6)
 * - border: 1px solid white at 5% opacity
 */
export function Card({
  children,
  className,
  padding = true,
  id,
}: CardProps): React.JSX.Element {
  return (
    <div
      id={id}
      className={clsx(
        'rounded-xl bg-[#121216]/50 border border-white/5',
        padding && 'p-6',
        className
      )}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps {
  children: React.ReactNode
  className?: string
}

/**
 * Card header with bottom border.
 * Uses px-6 to match card padding (24px).
 */
export function CardHeader({
  children,
  className
}: CardHeaderProps): React.JSX.Element {
  return (
    <div
      className={clsx(
        'px-6 py-4 border-b border-white/5',
        className
      )}
    >
      {children}
    </div>
  )
}

interface CardContentProps {
  children: React.ReactNode
  className?: string
}

/**
 * Card content area.
 * Uses p-6 to match card padding (24px).
 */
export function CardContent({
  children,
  className
}: CardContentProps): React.JSX.Element {
  return (
    <div className={clsx('p-6', className)}>
      {children}
    </div>
  )
}

interface CardFooterProps {
  children: React.ReactNode
  className?: string
}

/**
 * Card footer with top border.
 * Uses px-6 to match card padding (24px).
 */
export function CardFooter({
  children,
  className
}: CardFooterProps): React.JSX.Element {
  return (
    <div
      className={clsx(
        'px-6 py-4 border-t border-white/5',
        className
      )}
    >
      {children}
    </div>
  )
}

interface CardTitleProps {
  children: React.ReactNode
  className?: string
}

/**
 * Card title text.
 */
export function CardTitle({
  children,
  className
}: CardTitleProps): React.JSX.Element {
  return (
    <h3
      className={clsx(
        'text-lg font-semibold text-[#fafafa]',
        className
      )}
    >
      {children}
    </h3>
  )
}
