'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/lib/api-client'

/**
 * MFA setup data returned from API
 */
interface MFASetupData {
  secret: string
  qrCodeDataUrl: string
  backupCodes: string[]
}

/**
 * Props for MFA setup component
 */
interface MFASetupProps {
  onComplete?: () => void
  onCancel?: () => void
}

/**
 * MFA setup component with 3-step flow.
 * Step 1: Introduction and start setup
 * Step 2: Scan QR code and verify
 * Step 3: Save backup codes
 */
export function MFASetup({
  onComplete,
  onCancel
}: MFASetupProps): React.JSX.Element | null {
  const [step, setStep] = useState<'setup' | 'verify' | 'backup-codes'>('setup')
  const [setupData, setSetupData] = useState<MFASetupData | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  /**
   * Start MFA setup and get QR code
   */
  const setupMFA = async (): Promise<void> => {
    setIsLoading(true)
    setError('')

    try {
      const result = await apiClient.setupMFA()
      setSetupData(result)
      setStep('verify')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Verify MFA code and enable
   */
  const verifyMFA = async (): Promise<void> => {
    if (!verificationCode.trim()) {
      setError('Please enter a verification code')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      await apiClient.verifyMFA(verificationCode)
      setStep('backup-codes')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Download backup codes as text file
   */
  const downloadBackupCodes = (): void => {
    if (!setupData?.backupCodes) {
      return
    }

    const timestamp = new Date().toLocaleString()
    const codesList = setupData.backupCodes
      .map((code, index) => `${index + 1}. ${code}`)
      .join('\n')

    const content = `Klaas MFA Backup Codes\n\nGenerated: ${timestamp}\n\n` +
      `Backup Codes (use only once):\n${codesList}\n\n` +
      `Store these codes in a safe place. Each code can only be used once.`

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `klaas-backup-codes-${Date.now()}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  /**
   * Copy text to clipboard
   */
  const copyToClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Silently fail if clipboard access is not available
    }
  }

  /**
   * Handle setup completion
   */
  const handleComplete = (): void => {
    onComplete?.()
  }

  // Step 1: Introduction
  if (step === 'setup') {
    return (
      <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-[#fafafa]">
              Setup Multi-Factor Authentication
            </h2>
            <p className="text-[#a1a1aa] mt-2">
              Secure your account with TOTP-based two-factor authentication
            </p>
          </div>

          <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/30 p-4
            rounded-lg">
            <h3 className="font-medium text-[#fbbf24] mb-2">
              What you&apos;ll need:
            </h3>
            <ul className="text-sm text-[#fcd34d] space-y-1">
              <li>• A TOTP app like Google Authenticator, Authy, or
                1Password</li>
              <li>• Access to your smartphone or computer with the app
                installed</li>
              <li>• A secure place to store backup codes</li>
            </ul>
          </div>

          {error && (
            <div className="text-[#ef4444] text-sm bg-[#ef4444]/10
              border border-[#ef4444]/30 p-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex space-x-3">
            <Button
              onClick={setupMFA}
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? 'Setting up...' : 'Setup MFA'}
            </Button>
            {onCancel && (
              <Button
                onClick={onCancel}
                variant="outline"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Step 2: Scan QR and verify
  if (step === 'verify' && setupData) {
    return (
      <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-[#fafafa]">
              Scan QR Code
            </h2>
            <p className="text-[#a1a1aa] mt-2">
              Use your authenticator app to scan the QR code below
            </p>
          </div>

          <div className="flex flex-col items-center space-y-4">
            <div className="bg-white p-4 rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={setupData.qrCodeDataUrl}
                alt="MFA QR Code"
                className="w-48 h-48"
              />
            </div>

            <div className="text-center">
              <p className="text-sm text-[#a1a1aa] mb-2">
                Can&apos;t scan? Enter this secret manually:
              </p>
              <div className="bg-[#09090b] border border-white/10 p-3
                rounded-lg font-mono text-sm break-all text-[#fafafa]
                flex items-center justify-between gap-2">
                <span>{setupData.secret}</span>
                <Button
                  onClick={() => copyToClipboard(setupData.secret)}
                  variant="outline"
                  size="sm"
                >
                  Copy
                </Button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#a1a1aa] mb-2">
              Enter verification code from your app:
            </label>
            <Input
              type="text"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              placeholder="123456"
              className="text-center text-lg tracking-wider"
              maxLength={8}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </div>

          {error && (
            <div className="text-[#ef4444] text-sm bg-[#ef4444]/10
              border border-[#ef4444]/30 p-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex space-x-3">
            <Button
              onClick={verifyMFA}
              disabled={isLoading || !verificationCode.trim()}
              className="flex-1"
            >
              {isLoading ? 'Verifying...' : 'Verify & Enable MFA'}
            </Button>
            <Button
              onClick={() => setStep('setup')}
              variant="outline"
            >
              Back
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Step 3: Backup codes
  if (step === 'backup-codes' && setupData) {
    return (
      <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-[#fafafa]">
              MFA Enabled Successfully!
            </h2>
            <p className="text-[#a1a1aa] mt-2">
              Save these backup codes in a secure location
            </p>
          </div>

          <div className="bg-[#eab308]/10 border border-[#eab308]/30 p-4
            rounded-lg">
            <h3 className="font-medium text-[#fbbf24] mb-2">
              Important: Save Your Backup Codes
            </h3>
            <ul className="text-sm text-[#fcd34d] space-y-1">
              <li>• Each backup code can only be used once</li>
              <li>• Use these codes if you lose access to your
                authenticator app</li>
              <li>• Store them in a secure password manager or
                safe location</li>
              <li>• You can generate new codes anytime from your
                account settings</li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-[#fafafa] mb-3">
              Backup Codes:
            </h3>
            <div className="bg-[#09090b] border border-white/10 p-4 rounded-lg">
              <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                {setupData.backupCodes.map((code, index) => (
                  <div key={index}
                    className="flex items-center justify-between
                      text-[#fafafa]">
                    <span>{index + 1}. {code}</span>
                    <Button
                      onClick={() => copyToClipboard(code)}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                    >
                      Copy
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex space-x-3">
            <Button
              onClick={downloadBackupCodes}
              variant="outline"
              className="flex-1"
            >
              Download Codes
            </Button>
            <Button
              onClick={() =>
                copyToClipboard(setupData.backupCodes.join('\n'))
              }
              variant="outline"
              className="flex-1"
            >
              Copy All
            </Button>
          </div>

          <div className="flex justify-center">
            <Button onClick={handleComplete}>
              Complete Setup
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
