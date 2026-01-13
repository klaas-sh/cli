'use client'

import React, { InputHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  onCheckedChange?: (checked: boolean) => void
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    { className, onCheckedChange, onChange, checked, ...props },
    ref
  ): React.JSX.Element => {
    const handleChange = (
      event: React.ChangeEvent<HTMLInputElement>
    ): void => {
      const isChecked = event.target.checked
      onCheckedChange?.(isChecked)
      onChange?.(event)
    }

    return (
      <input
        type="checkbox"
        className={clsx(
          'shrink-0 mt-0.5 border-gray-200 rounded text-app-primary',
          'focus:ring-app-primary disabled:opacity-50 disabled:pointer-events-none',
          'dark:bg-gray-800 dark:border-gray-700 dark:checked:bg-app-primary-dark',
          'dark:checked:border-app-primary-dark dark:focus:ring-offset-gray-800',
          className
        )}
        checked={checked}
        onChange={handleChange}
        ref={ref}
        {...props}
      />
    )
  }
)

Checkbox.displayName = 'Checkbox'
