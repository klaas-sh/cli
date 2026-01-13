'use client'

import React, { LabelHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, required, ...props }, ref) => (
    <label
      ref={ref}
      className={clsx(
        'block text-sm font-medium text-gray-900 dark:text-gray-100',
        className
      )}
      {...props}
    >
      {children}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
  )
)
Label.displayName = 'Label'
