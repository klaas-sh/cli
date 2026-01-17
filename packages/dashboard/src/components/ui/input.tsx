import React from 'react'
import { clsx } from 'clsx'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helper?: string
}

/**
 * Input component with klaas dark theme styling.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, className, ...props }, ref): React.JSX.Element => {
    return (
      <div className="space-y-2">
        {label && (
          <label className="block text-sm font-medium text-[#a1a1aa]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={clsx(
            'block w-full px-3 py-2 border rounded-lg',
            'placeholder-[#71717a] focus:outline-none focus:ring-1',
            'focus:ring-[#f59e0b]/30 focus:border-[#f59e0b] sm:text-sm',
            'bg-[#09090b] text-[#fafafa]',
            error
              ? 'border-[#ef4444] focus:ring-[#ef4444]/30 ' +
                'focus:border-[#ef4444]'
              : 'border-white/10',
            className
          )}
          {...props}
        />
        {error && (
          <p className="text-sm text-[#ef4444]">
            {error}
          </p>
        )}
        {helper && !error && (
          <p className="text-sm text-[#71717a]">
            {helper}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
