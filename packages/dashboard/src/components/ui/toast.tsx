'use client'

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect
} from 'react'
import { X, CheckCircle, XCircle, AlertCircle, Info } from 'lucide-react'
import { clsx } from 'clsx'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  description?: string
  duration?: number
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }, [])

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9)
    const newToast = { ...toast, id }

    setToasts(prev => [...prev, newToast])

    if (toast.duration !== 0) {
      setTimeout(() => {
        removeToast(id)
      }, toast.duration || 5000)
    }
  }, [removeToast])

  // Initialize the toast manager
  useEffect(() => {
    setToastManager(addToast)
    return (): void => {
      toastManager = null
    }
  }, [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext)
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

// Singleton toast manager for imperative usage
let toastManager: ((toast: Omit<Toast, 'id'>) => void) | null = null

export function setToastManager(
  addToast: (toast: Omit<Toast, 'id'>) => void
): void {
  toastManager = addToast
}

/**
 * Show a toast notification
 */
export function toast(options: Omit<Toast, 'id'>): void {
  if (toastManager) {
    toastManager(options)
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      'Toast manager not initialized. Make sure ToastProvider is mounted.'
    )
  }
}

/**
 * Convenience methods for toast
 */
toast.success = (title: string, description?: string): void => {
  toast({ type: 'success', title, description })
}

toast.error = (title: string, description?: string): void => {
  toast({ type: 'error', title, description })
}

toast.warning = (title: string, description?: string): void => {
  toast({ type: 'warning', title, description })
}

toast.info = (title: string, description?: string): void => {
  toast({ type: 'info', title, description })
}

function ToastContainer(): React.JSX.Element {
  const { toasts, removeToast } = useToast()

  return (
    <div className="fixed bottom-0 right-0 z-[90] flex max-h-screen
      w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto
      sm:flex-col md:max-w-[420px]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  )
}

export function ToastItem({
  toast,
  onRemove
}: {
  toast: Toast;
  onRemove: (id: string) => void
}): React.JSX.Element {
  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info
  }

  const colorClasses = {
    success: 'bg-green-50 border-green-200 text-green-800 '
      + 'dark:bg-green-900/50 dark:border-green-800 dark:text-green-200',
    error: 'bg-red-50 border-red-200 text-red-800 '
      + 'dark:bg-red-900/50 dark:border-red-800 dark:text-red-200',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800 '
      + 'dark:bg-yellow-900/50 dark:border-yellow-800 dark:text-yellow-200',
    info: 'bg-violet-50 border-violet-200 text-violet-800 '
      + 'dark:bg-violet-900/50 dark:border-violet-800 dark:text-violet-200'
  }

  const Icon = icons[toast.type] || Info

  return (
    <div className={clsx(
      'relative overflow-hidden rounded-lg border p-4 shadow-lg '
        + 'transition-all duration-300 ease-in-out',
      colorClasses[toast.type]
    )}>
      <div className="flex">
        <div className="flex-shrink-0">
          <Icon className="h-5 w-5" />
        </div>
        <div className="ml-3 w-0 flex-1">
          <p className="text-sm font-medium">{toast.title}</p>
          {toast.description && (
            <p className="mt-1 text-sm opacity-90">{toast.description}</p>
          )}
        </div>
        <div className="ml-4 flex flex-shrink-0">
          <button
            className="inline-flex rounded-md p-1.5 hover:bg-black/5
              focus:outline-none focus:ring-2 focus:ring-offset-2"
            onClick={() => onRemove(toast.id)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
