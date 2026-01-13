import React from 'react'
import { clsx } from 'clsx'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helper?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, className, ...props }, ref): React.JSX.Element => {
    return (
      <div className="space-y-2">
        {label && (
          <label className="block text-sm font-medium text-gray-700
                         dark:text-gray-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={clsx(
            'block w-full px-3 py-2 border rounded-lg shadow-sm ' +
            'placeholder-gray-400 focus:outline-none focus:ring-2 ' +
            'focus:ring-app-primary focus:border-app-primary sm:text-sm',
            error
              ? 'border-red-300 text-red-900 placeholder-red-300 ' +
                'focus:ring-red-500 focus:border-red-500'
              : 'border-gray-300 dark:border-gray-600 bg-white ' +
                'dark:bg-gray-900 text-gray-900 dark:text-white',
            className
          )}
          {...props}
        />
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {helper && !error && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {helper}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
