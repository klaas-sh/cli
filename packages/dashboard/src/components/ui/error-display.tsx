'use client'

import React from 'react'
import { AlertCircle, X } from 'lucide-react'

interface ErrorDisplayProps {
  error: string
  onDismiss: () => void
  className?: string
}

/**
 * Consistent error display component for all overview pages
 * Shows error message with red icon and dismiss button
 */
export function ErrorDisplay({ error, onDismiss, className = '' }: ErrorDisplayProps) {
  return (
    <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-red-800">{error}</p>
        </div>
        <button
          onClick={onDismiss}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
        >
          Dismiss
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
