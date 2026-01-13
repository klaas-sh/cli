'use client'

import { ReactNode, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from './button'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showCloseButton?: boolean
}

/**
 * Modal component using Preline design patterns
 * Vertically centered with blurred backdrop
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true
}: ModalProps): React.JSX.Element | null {
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return (): void => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  const sizeClasses = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-xl'
  }

  return (
    <>
      {/* Backdrop with blur */}
      <div
        className="fixed inset-0 z-[60] bg-gray-900/50
          backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[70] overflow-hidden">
        <div className="flex min-h-full items-center
          justify-center p-4">
          <div
            ref={modalRef}
            className={`relative w-full ${sizeClasses[size]} transform
              overflow-hidden rounded-xl bg-white shadow-xl
              transition-all dark:bg-gray-800`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            {(title || showCloseButton) && (
              <div className="flex items-center justify-between
                border-b border-gray-200 px-6 py-4
                dark:border-gray-700">
                {title && (
                  <h3 className="text-lg font-semibold
                    text-gray-900 dark:text-white">
                    {title}
                  </h3>
                )}
                {showCloseButton && (
                  <button
                    type="button"
                    className="ml-auto inline-flex h-8 w-8
                      items-center justify-center rounded-lg
                      text-gray-400 hover:bg-gray-100
                      hover:text-gray-500 dark:hover:bg-gray-700
                      dark:hover:text-gray-300"
                    onClick={onClose}
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close modal</span>
                  </button>
                )}
              </div>
            )}

            {/* Content */}
            <div className="px-6 py-4">
              {children}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

interface AlertModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  message: string
  type?: 'info' | 'warning' | 'error' | 'success'
  confirmText?: string
  onConfirm?: () => void
  cancelText?: string
}

/**
 * Alert modal for displaying messages
 * Replaces browser alert() calls
 */
export function AlertModal({
  isOpen,
  onClose,
  title,
  message,
  type = 'info',
  confirmText = 'OK',
  onConfirm,
  cancelText
}: AlertModalProps): React.JSX.Element {
  const typeColors = {
    info: 'text-violet-600 dark:text-violet-400',
    warning: 'text-yellow-600 dark:text-yellow-400',
    error: 'text-red-600 dark:text-red-400',
    success: 'text-green-600 dark:text-green-400'
  }

  const typeBackgrounds = {
    info: 'bg-violet-50 dark:bg-violet-900/20',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20',
    error: 'bg-red-50 dark:bg-red-900/20',
    success: 'bg-green-50 dark:bg-green-900/20'
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" showCloseButton={false}>
      <div className="space-y-4">
        <div className={`rounded-lg p-4
          ${typeBackgrounds[type]}`}>
          <h3 className={`text-sm font-medium
            ${typeColors[type]}`}>
            {title}
          </h3>
          <div className="mt-2 text-sm text-gray-600
            dark:text-gray-300">
            {message}
          </div>
        </div>

        <div className="flex justify-end space-x-3">
          {cancelText && (
            <Button variant="outline" size="sm" onClick={onClose}>
              {cancelText}
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              onConfirm?.()
              onClose()
            }}
            variant={type === 'error' ? 'destructive' : 'default'}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'destructive'
  loading?: boolean
}

/**
 * Confirm modal for destructive actions
 * Replaces browser confirm() calls
 */
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  loading = false
}: ConfirmModalProps): React.JSX.Element {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" showCloseButton={false}>
      <div className="space-y-4">
        <div className="text-center sm:text-left">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {message}
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            disabled={loading}
          >
            {loading ? 'Processing...' : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
