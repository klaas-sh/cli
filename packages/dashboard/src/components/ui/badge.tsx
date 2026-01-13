import React, { HTMLAttributes } from 'react'
import { clsx } from 'clsx'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?:
    | 'default'
    | 'success'
    | 'warning'
    | 'error'
    | 'info'
    | 'soft'
    | 'outline'
    | 'destructive'
    | 'secondary'
  size?: 'sm' | 'md' | 'lg'
}

export function Badge({
  className,
  variant = 'default',
  size = 'md',
  ...props
}: BadgeProps): React.JSX.Element {
  const baseClasses =
    'inline-flex items-center font-medium rounded-full'

  const variantClasses = {
    default:
      'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
    success:
      'bg-green-100 text-green-800 dark:bg-green-800/30 dark:text-green-400',
    warning:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-800/30 dark:text-yellow-400',
    error:
      'bg-red-100 text-red-800 dark:bg-red-800/30 dark:text-red-400',
    info:
      'bg-blue-100 text-blue-800 dark:bg-blue-800/30 dark:text-blue-400',
    soft:
      'bg-gray-50 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    outline:
      'border border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400',
    destructive:
      'bg-red-100 text-red-800 dark:bg-red-800/30 dark:text-red-400',
    secondary:
      'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-2.5 py-0.5 text-sm',
    lg: 'px-3 py-1 text-base'
  }

  return (
    <span
      className={clsx(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
}
