import React from 'react'
import { Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * Loading spinner component
 * Uses Loader2 from lucide-react with animation
 */
export function Spinner({
  size = 'md',
  className,
}: SpinnerProps): React.JSX.Element {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
  }

  return (
    <Loader2
      className={clsx(
        'animate-spin text-violet-600 dark:text-violet-400',
        sizeClasses[size],
        className
      )}
    />
  )
}
