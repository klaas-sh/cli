'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Shield,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle,
  Key,
  Eye,
  EyeOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useEncryption } from '@/hooks/use-encryption'
import {
  PasswordStrengthIndicator,
  calculatePasswordStrength,
} from './password-strength'

/** Minimum password length for E2EE */
const MIN_PASSWORD_LENGTH = 12

/**
 * Password input with visibility toggle
 */
function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
  disabled?: boolean
}): React.JSX.Element {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className="relative">
      <Input
        id={id}
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        className="pr-10"
        data-lpignore="true"
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400
          hover:text-gray-600 dark:hover:text-gray-300"
        tabIndex={-1}
      >
        {showPassword ? (
          <EyeOff className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
      </button>
    </div>
  )
}

/**
 * Warning banner for E2EE setup
 */
function EncryptionWarning(): React.JSX.Element {
  return (
    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-4
      border border-yellow-200 dark:border-yellow-800">
      <div className="flex gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-600
          dark:text-yellow-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-yellow-800
            dark:text-yellow-200">
            Important: Password Recovery
          </h4>
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            Your encryption password cannot be recovered if you forget it.
            All encrypted data will be permanently inaccessible without this
            password. Please store it securely.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Form for enabling E2EE with password setup
 */
function EnableEncryptionForm({
  onSuccess,
}: {
  onSuccess: () => void
}): React.JSX.Element {
  const { enable, isLoading, error } = useEncryption()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const passwordStrength = calculatePasswordStrength(password)
  const isPasswordValid = password.length >= MIN_PASSWORD_LENGTH &&
    passwordStrength.score >= 2
  const passwordsMatch = password === confirmPassword
  const canSubmit = isPasswordValid && passwordsMatch && confirmPassword

  const handleSubmit = useCallback(async (
    e: React.FormEvent
  ): Promise<void> => {
    e.preventDefault()
    setLocalError(null)

    if (!isPasswordValid) {
      setLocalError('Password does not meet requirements')
      return
    }

    if (!passwordsMatch) {
      setLocalError('Passwords do not match')
      return
    }

    try {
      await enable(password)
      onSuccess()
    } catch {
      // Error is handled by the hook
    }
  }, [enable, password, isPasswordValid, passwordsMatch, onSuccess])

  const displayError = localError || error

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <EncryptionWarning />

      <div className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="encryption-password"
            className="block text-sm font-medium text-gray-700
              dark:text-gray-300"
          >
            Encryption Password
          </label>
          <PasswordInput
            id="encryption-password"
            value={password}
            onChange={setPassword}
            placeholder="Enter a strong password"
            autoComplete="new-password"
            disabled={isLoading}
          />
          {password && (
            <PasswordStrengthIndicator password={password} />
          )}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-gray-700
              dark:text-gray-300"
          >
            Confirm Password
          </label>
          <PasswordInput
            id="confirm-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Confirm your password"
            autoComplete="new-password"
            disabled={isLoading}
          />
          {confirmPassword && !passwordsMatch && (
            <p className="text-sm text-red-600 dark:text-red-400">
              Passwords do not match
            </p>
          )}
          {confirmPassword && passwordsMatch && (
            <p className="text-sm text-green-600 dark:text-green-400
              flex items-center gap-1">
              <CheckCircle className="h-4 w-4" />
              Passwords match
            </p>
          )}
        </div>
      </div>

      {displayError && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50
          dark:bg-red-900/20 p-3 rounded-lg">
          {displayError}
        </div>
      )}

      <Button
        type="submit"
        disabled={!canSubmit || isLoading}
        loading={isLoading}
        className="w-full"
      >
        <Shield className="h-4 w-4 mr-2" />
        Enable End-to-End Encryption
      </Button>
    </form>
  )
}

/**
 * Form for unlocking encryption with password
 */
function UnlockEncryptionForm(): React.JSX.Element {
  const { unlock, isLoading, error } = useEncryption()
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = useCallback(async (
    e: React.FormEvent
  ): Promise<void> => {
    e.preventDefault()
    setLocalError(null)

    if (!password) {
      setLocalError('Please enter your password')
      return
    }

    const success = await unlock(password)
    if (!success) {
      setPassword('')
    }
  }, [unlock, password])

  const displayError = localError || error

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg bg-app-highlight dark:bg-app-highlight-dark
        p-4 border border-app-border dark:border-app-border-dark">
        <div className="flex gap-3">
          <Lock className="h-5 w-5 text-app-primary dark:text-app-primary-dark
            flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-app-text-primary
              dark:text-app-text-primary-dark">
              Encryption Locked
            </h4>
            <p className="text-sm text-app-text-secondary
              dark:text-app-text-secondary-dark mt-1">
              Enter your encryption password to unlock and access
              encrypted data.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="unlock-password"
          className="block text-sm font-medium text-gray-700
            dark:text-gray-300"
        >
          Encryption Password
        </label>
        <PasswordInput
          id="unlock-password"
          value={password}
          onChange={setPassword}
          placeholder="Enter your password"
          autoComplete="current-password"
          disabled={isLoading}
        />
      </div>

      {displayError && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50
          dark:bg-red-900/20 p-3 rounded-lg">
          {displayError}
        </div>
      )}

      <Button
        type="submit"
        disabled={!password || isLoading}
        loading={isLoading}
        className="w-full"
      >
        <Unlock className="h-4 w-4 mr-2" />
        Unlock Encryption
      </Button>
    </form>
  )
}

/**
 * Form for changing the encryption password
 */
function ChangePasswordForm({
  onSuccess,
}: {
  onSuccess: () => void
}): React.JSX.Element {
  const { changePassword, isLoading, error } = useEncryption()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const passwordStrength = calculatePasswordStrength(newPassword)
  const isPasswordValid = newPassword.length >= MIN_PASSWORD_LENGTH &&
    passwordStrength.score >= 2
  const passwordsMatch = newPassword === confirmPassword
  const canSubmit = currentPassword &&
    isPasswordValid &&
    passwordsMatch &&
    confirmPassword

  const handleSubmit = useCallback(async (
    e: React.FormEvent
  ): Promise<void> => {
    e.preventDefault()
    setLocalError(null)

    if (!currentPassword) {
      setLocalError('Please enter your current password')
      return
    }

    if (!isPasswordValid) {
      setLocalError('New password does not meet requirements')
      return
    }

    if (!passwordsMatch) {
      setLocalError('New passwords do not match')
      return
    }

    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setIsExpanded(false)
      onSuccess()
    } catch {
      // Error is handled by the hook
    }
  }, [
    changePassword,
    currentPassword,
    newPassword,
    isPasswordValid,
    passwordsMatch,
    onSuccess,
  ])

  const displayError = localError || error

  if (!isExpanded) {
    return (
      <Button
        variant="outline"
        onClick={() => setIsExpanded(true)}
        className="w-full"
      >
        <Key className="h-4 w-4 mr-2" />
        Change Encryption Password
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="current-encryption-password"
          className="block text-sm font-medium text-gray-700
            dark:text-gray-300"
        >
          Current Password
        </label>
        <PasswordInput
          id="current-encryption-password"
          value={currentPassword}
          onChange={setCurrentPassword}
          placeholder="Enter current password"
          autoComplete="current-password"
          disabled={isLoading}
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="new-encryption-password"
          className="block text-sm font-medium text-gray-700
            dark:text-gray-300"
        >
          New Password
        </label>
        <PasswordInput
          id="new-encryption-password"
          value={newPassword}
          onChange={setNewPassword}
          placeholder="Enter new password"
          autoComplete="new-password"
          disabled={isLoading}
        />
        {newPassword && (
          <PasswordStrengthIndicator password={newPassword} />
        )}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="confirm-new-password"
          className="block text-sm font-medium text-gray-700
            dark:text-gray-300"
        >
          Confirm New Password
        </label>
        <PasswordInput
          id="confirm-new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Confirm new password"
          autoComplete="new-password"
          disabled={isLoading}
        />
        {confirmPassword && !passwordsMatch && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Passwords do not match
          </p>
        )}
      </div>

      {displayError && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50
          dark:bg-red-900/20 p-3 rounded-lg">
          {displayError}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setIsExpanded(false)
            setCurrentPassword('')
            setNewPassword('')
            setConfirmPassword('')
            setLocalError(null)
          }}
          disabled={isLoading}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit || isLoading}
          loading={isLoading}
          className="flex-1"
        >
          Update Password
        </Button>
      </div>
    </form>
  )
}

/**
 * Encryption status display when unlocked
 */
function EncryptionStatusUnlocked({
  onLock,
  onPasswordChanged,
}: {
  onLock: () => void
  onPasswordChanged: () => void
}): React.JSX.Element {
  const { lock } = useEncryption()

  const handleLock = useCallback((): void => {
    lock()
    onLock()
  }, [lock, onLock])

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-4
        border border-green-200 dark:border-green-800">
        <div className="flex gap-3">
          <CheckCircle className="h-5 w-5 text-green-600
            dark:text-green-400 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-green-800
              dark:text-green-200">
              Encryption Active
            </h4>
            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
              Your data is protected with end-to-end encryption.
              The encryption key is currently unlocked.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <Button
          variant="outline"
          onClick={handleLock}
          className="w-full"
        >
          <Lock className="h-4 w-4 mr-2" />
          Lock Encryption
        </Button>

        <ChangePasswordForm onSuccess={onPasswordChanged} />
      </div>
    </div>
  )
}

/**
 * Main encryption settings component.
 * Manages E2EE status display and configuration.
 */
export function EncryptionSettings(): React.JSX.Element {
  const { isEnabled, isUnlocked, isLoading, initialize } = useEncryption()
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    initialize()
  }, [initialize])

  // Clear success message after 5 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000)
      return (): void => clearTimeout(timer)
    }
  }, [successMessage])

  const handleEnableSuccess = useCallback((): void => {
    setSuccessMessage('End-to-end encryption has been enabled successfully.')
  }, [])

  const handleLock = useCallback((): void => {
    setSuccessMessage('Encryption has been locked.')
  }, [])

  const handlePasswordChanged = useCallback((): void => {
    setSuccessMessage('Encryption password has been updated successfully.')
  }, [])

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-app-primary
            dark:text-app-primary-dark" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            End-to-End Encryption
          </h2>
        </div>
        <Badge
          variant={isEnabled
            ? (isUnlocked ? 'success' : 'warning')
            : 'default'}
        >
          {isEnabled
            ? (isUnlocked ? 'Unlocked' : 'Locked')
            : 'Disabled'}
        </Badge>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-600 dark:text-gray-400">
        End-to-end encryption ensures that your session data can only be
        read by you. Data is encrypted on your device before being sent to
        our servers.
      </p>

      {/* Success message */}
      {successMessage && (
        <div className="text-sm text-green-600 dark:text-green-400 bg-green-50
          dark:bg-green-900/20 p-3 rounded-lg flex items-center gap-2">
          <CheckCircle className="h-4 w-4" />
          {successMessage}
        </div>
      )}

      {/* Content based on state */}
      {!isEnabled ? (
        <EnableEncryptionForm onSuccess={handleEnableSuccess} />
      ) : !isUnlocked ? (
        <UnlockEncryptionForm />
      ) : (
        <EncryptionStatusUnlocked
          onLock={handleLock}
          onPasswordChanged={handlePasswordChanged}
        />
      )}
    </div>
  )
}
