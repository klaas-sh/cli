'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Send, MessageSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Spinner } from '@/components/ui/spinner'
import {
  createSupportTicket,
  getSupportStatus,
  type SupportStatus,
} from '@/lib/dashboard-api'

/**
 * Create support ticket page
 * Users can submit new support requests
 */
export default function CreateTicketPage(): React.JSX.Element {
  const router = useRouter()
  const { addToast } = useToast()

  const [supportStatus, setSupportStatus] = useState<SupportStatus | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<{
    subject?: string
    body?: string
  }>({})

  const loadSupportStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await getSupportStatus()
      setSupportStatus(status)
    } catch {
      // Non-critical, fail silently
    }
  }, [])

  useEffect(() => {
    loadSupportStatus()
  }, [loadSupportStatus])

  const validate = (): boolean => {
    const newErrors: typeof errors = {}

    if (!subject.trim()) {
      newErrors.subject = 'Subject is required'
    } else if (subject.trim().length < 5) {
      newErrors.subject = 'Subject must be at least 5 characters'
    } else if (subject.trim().length > 200) {
      newErrors.subject = 'Subject must be less than 200 characters'
    }

    if (!body.trim()) {
      newErrors.body = 'Message is required'
    } else if (body.trim().length < 10) {
      newErrors.body = 'Message must be at least 10 characters'
    } else if (body.trim().length > 10000) {
      newErrors.body = 'Message must be less than 10,000 characters'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()

    if (!validate() || isSubmitting) { return }

    setIsSubmitting(true)
    try {
      const response = await createSupportTicket({
        subject: subject.trim(),
        body: body.trim(),
      })

      addToast({
        title: 'Ticket created',
        description: 'Your support ticket has been submitted successfully.',
        type: 'success',
      })

      // Navigate to the new ticket
      router.push(`/support/${response.ticket.id}`)
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to create ticket'
      addToast({
        title: 'Error',
        description: errorMessage,
        type: 'error',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-6">
        {/* Sticky Header */}
        <div className="sticky top-[73px] z-10 -mx-3 px-3 py-4 -mt-4
          bg-gray-50/90 dark:bg-gray-900/90 backdrop-blur-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center
            sm:justify-between">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <Button
                variant="outline"
                type="button"
                onClick={() => router.push('/support')}
                title="Back"
              >
                <ArrowLeft className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Back</span>
              </Button>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900
                  dark:text-white">
                  New Support Ticket
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Describe your issue and our team will help you
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => router.push('/support')}
                disabled={isSubmitting}
                title="Cancel"
              >
                <X className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Cancel</span>
              </Button>
              <Button type="submit" disabled={isSubmitting} title="Submit Ticket">
                {isSubmitting ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    <span className="hidden sm:inline">Submitting...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Submit Ticket</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

      {/* Support Status Banner */}
      {supportStatus && (
        <div
          className={`rounded-lg border p-4 ${
            supportStatus.isOnline
              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 ' +
                'dark:border-green-800'
              : 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 ' +
                'dark:border-yellow-800'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                supportStatus.isOnline
                  ? 'bg-green-500 animate-pulse'
                  : 'bg-yellow-500'
              }`}
            />
            <div>
              <p
                className={`font-medium ${
                  supportStatus.isOnline
                    ? 'text-green-800 dark:text-green-200'
                    : 'text-yellow-800 dark:text-yellow-200'
                }`}
              >
                {supportStatus.isOnline
                  ? 'Support is online'
                  : 'Support is currently offline'}
              </p>
              <p
                className={`text-sm ${
                  supportStatus.isOnline
                    ? 'text-green-600 dark:text-green-300'
                    : 'text-yellow-600 dark:text-yellow-300'
                }`}
              >
                {supportStatus.isOnline
                  ? `${supportStatus.agentCount} agent${
                      supportStatus.agentCount !== 1 ? 's' : ''
                    } available - expect a quick response`
                  : `Expected response: ${
                      supportStatus.expectedResponseTime ||
                      'within 24 hours'
                    }`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
        <div
          className="bg-white dark:bg-gray-800 rounded-lg border
            border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="space-y-6">
            {/* Subject */}
            <div>
              <label
                htmlFor="subject"
                className="block text-sm font-medium text-gray-700
                  dark:text-gray-300 mb-2"
              >
                Subject
              </label>
              <input
                type="text"
                id="subject"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value)
                  if (errors.subject) {
                    setErrors({ ...errors, subject: undefined })
                  }
                }}
                placeholder="Brief summary of your issue..."
                className={`w-full px-4 py-3 border rounded-lg bg-white
                  dark:bg-gray-900 text-gray-900 dark:text-white
                  placeholder-gray-400 focus:outline-none focus:ring-2
                  focus:ring-violet-500 ${
                    errors.subject
                      ? 'border-red-500 dark:border-red-500'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
              />
              {errors.subject && (
                <p className="mt-1 text-sm text-red-500">{errors.subject}</p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                {subject.length}/200 characters
              </p>
            </div>

            {/* Message Body */}
            <div>
              <label
                htmlFor="body"
                className="block text-sm font-medium text-gray-700
                  dark:text-gray-300 mb-2"
              >
                Message
              </label>
              <textarea
                id="body"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value)
                  if (errors.body) {
                    setErrors({ ...errors, body: undefined })
                  }
                }}
                placeholder="Describe your issue in detail. Include any relevant
                  information such as error messages, steps to reproduce,
                  or screenshots..."
                rows={8}
                className={`w-full px-4 py-3 border rounded-lg bg-white
                  dark:bg-gray-900 text-gray-900 dark:text-white
                  placeholder-gray-400 focus:outline-none focus:ring-2
                  focus:ring-violet-500 resize-none ${
                    errors.body
                      ? 'border-red-500 dark:border-red-500'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
              />
              {errors.body && (
                <p className="mt-1 text-sm text-red-500">{errors.body}</p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                {body.length}/10,000 characters
              </p>
            </div>
          </div>
        </div>

        {/* Tips */}
        <div
          className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200
            dark:border-blue-800 rounded-lg p-4"
        >
          <div className="flex gap-3">
            <MessageSquare className="h-5 w-5 text-blue-600
              dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-blue-800 dark:text-blue-200
                mb-1">
                Tips for faster resolution
              </h3>
              <ul className="text-sm text-blue-600 dark:text-blue-300
                space-y-1">
                <li>&bull; Be specific about what you were trying to do</li>
                <li>&bull; Include any error messages you saw</li>
                <li>
                  &bull; Mention the browser and device you are using
                </li>
                <li>
                  &bull; Describe the steps to reproduce the issue
                </li>
              </ul>
            </div>
          </div>
        </div>

      </div>
    </form>
  )
}
