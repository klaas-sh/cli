'use client'

import React, { forwardRef } from 'react'
import { clsx } from 'clsx'

interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(
  ({ orientation = 'horizontal', className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx(
          'shrink-0 bg-gray-200 dark:bg-gray-700',
          orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
          className
        )}
        {...props}
      />
    )
  }
)

Separator.displayName = 'Separator'
