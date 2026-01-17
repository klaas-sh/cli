'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft,
  Send,
  CheckCircle2,
  Circle,
  RefreshCw,
  Check,
  CheckCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { ErrorDisplay } from '@/components/ui/error-display'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmModal } from '@/components/ui/modal'
import {
  getSupportTicket,
  getSupportStatus,
  addTicketMessage,
  resolveTicket,
  reopenTicket,
  markMessageRead,
  type SupportTicketDetail,
  type SupportMessage,
  type SupportStatus,
  type TicketStatus,
} from '@/lib/dashboard-api'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'

/**
 * Support ticket detail page
 * Shows conversation thread and allows users to reply
 */
export default function TicketDetailPage(): React.JSX.Element {
  const router = useRouter()
  const params = useParams()
  const ticketId = params.ticketId as string
  const { addToast } = useToast()

  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null)
  const [supportStatus, setSupportStatus] = useState<SupportStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [resolveModalOpen, setResolveModalOpen] = useState(false)
  const [reopenModalOpen, setReopenModalOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const loadTicket = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)

    try {
      const data = await getSupportTicket(ticketId)
      setTicket(data)

      // Mark unread messages as read
      const unreadMessages = data.messages.filter(
        (m) => !m.isRead && m.senderType !== 'user'
      )
      for (const msg of unreadMessages) {
        try {
          await markMessageRead(ticketId, msg.id)
        } catch {
          // Non-critical, continue
        }
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to load ticket'
      setError(errorMessage)
      addToast({
        title: 'Error',
        description: errorMessage,
        type: 'error',
      })
    } finally {
      setIsLoading(false)
    }
  }, [ticketId, addToast])

  const loadSupportStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await getSupportStatus()
      setSupportStatus(status)
    } catch {
      // Non-critical, fail silently
    }
  }, [])

  useEffect(() => {
    loadTicket()
    loadSupportStatus()
  }, [loadTicket, loadSupportStatus])

  useEffect(() => {
    if (ticket?.messages.length) {
      scrollToBottom()
    }
  }, [ticket?.messages.length])

  const handleSendMessage = async (): Promise<void> => {
    if (!message.trim() || isSending) { return }

    setIsSending(true)
    try {
      const response = await addTicketMessage(ticketId, {
        body: message.trim(),
      })

      // Optimistically update messages
      if (ticket) {
        setTicket({
          ...ticket,
          messages: [...ticket.messages, response.message],
        })
      }
      setMessage('')
      addToast({
        title: 'Message sent',
        description: 'Your message has been sent to support.',
        type: 'success',
      })
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to send message'
      addToast({
        title: 'Error',
        description: errorMessage,
        type: 'error',
      })
    } finally {
      setIsSending(false)
    }
  }

  const handleResolve = async (): Promise<void> => {
    setIsProcessing(true)
    try {
      await resolveTicket(ticketId)
      setResolveModalOpen(false)
      addToast({
        title: 'Ticket resolved',
        description: 'This ticket has been marked as resolved.',
        type: 'success',
      })
      loadTicket() // Refresh to get updated status
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to resolve ticket'
      addToast({
        title: 'Error',
        description: errorMessage,
        type: 'error',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReopen = async (): Promise<void> => {
    setIsProcessing(true)
    try {
      await reopenTicket(ticketId)
      setReopenModalOpen(false)
      addToast({
        title: 'Ticket reopened',
        description: 'This ticket has been reopened.',
        type: 'success',
      })
      loadTicket() // Refresh to get updated status
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to reopen ticket'
      addToast({
        title: 'Error',
        description: errorMessage,
        type: 'error',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const getStatusBadge = (status: TicketStatus): React.JSX.Element => {
    if (status === 'resolved') {
      return (
        <Badge variant="success" className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Resolved
        </Badge>
      )
    }
    return (
      <Badge variant="warning" className="flex items-center gap-1">
        <Circle className="h-3 w-3" />
        Open
      </Badge>
    )
  }

  /**
   * Check if a message is from the current user
   */
  const isFromUser = (msg: SupportMessage): boolean => {
    return msg.senderType === 'user'
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-400
            hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Support
        </button>
        <ErrorDisplay error={error} onDismiss={() => setError(null)} />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-400
            hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Support
        </button>
        <ErrorDisplay
          error="Ticket not found"
          onDismiss={() => router.push('/support')}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Modals */}
      <ConfirmModal
        isOpen={resolveModalOpen}
        onClose={() => setResolveModalOpen(false)}
        onConfirm={handleResolve}
        title="Resolve Ticket"
        message="Are you sure you want to mark this ticket as resolved? You can
          reopen it later if needed."
        confirmText="Resolve"
        variant="default"
        loading={isProcessing}
      />

      <ConfirmModal
        isOpen={reopenModalOpen}
        onClose={() => setReopenModalOpen(false)}
        onConfirm={handleReopen}
        title="Reopen Ticket"
        message="Are you sure you want to reopen this ticket?"
        confirmText="Reopen"
        variant="default"
        loading={isProcessing}
      />

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center
        sm:justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/support')}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800
              text-gray-600 dark:text-gray-400"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1
                className="text-xl sm:text-2xl font-bold text-gray-900
                  dark:text-white truncate"
              >
                {ticket.ticket.subject}
              </h1>
              {getStatusBadge(ticket.ticket.status)}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              #{ticket.ticket.id.slice(-8)} &middot;
              Created {formatRelativeTime(ticket.ticket.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ticket.ticket.status === 'open' ? (
            <Button
              variant="outline"
              onClick={() => setResolveModalOpen(true)}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Mark Resolved
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setReopenModalOpen(true)}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Reopen
            </Button>
          )}
        </div>
      </div>

      {/* Support Status Banner */}
      {supportStatus && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            supportStatus.isOnline
              ? 'bg-green-50 border-green-200 text-green-700 ' +
                'dark:bg-green-900/20 dark:border-green-800 ' +
                'dark:text-green-300'
              : 'bg-yellow-50 border-yellow-200 text-yellow-700 ' +
                'dark:bg-yellow-900/20 dark:border-yellow-800 ' +
                'dark:text-yellow-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                supportStatus.isOnline
                  ? 'bg-green-500 animate-pulse'
                  : 'bg-yellow-500'
              }`}
            />
            {supportStatus.isOnline
              ? 'Support is online - expect a quick response'
              : `Support is offline - ${
                  supportStatus.expectedResponseTime ||
                  'expect a response within 24 hours'
                }`}
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        className="bg-white dark:bg-gray-800 rounded-lg border
          border-gray-200 dark:border-gray-700"
      >
        <div className="p-4 space-y-4">
          {ticket.messages.map((msg) => {
            const fromUser = isFromUser(msg)
            return (
              <div
                key={msg.id}
                className={`flex ${fromUser ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                    fromUser
                      ? 'bg-violet-600 dark:bg-violet-700 text-white'
                      : 'bg-gray-100 dark:bg-gray-700'
                  } ${
                    fromUser
                      ? 'rounded-br-sm'
                      : 'rounded-bl-sm'
                  }`}
                >
                  {/* Sender name */}
                  <div
                    className={`text-xs font-medium mb-1 ${
                      fromUser
                        ? 'text-violet-200'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {msg.senderType === 'user'
                      ? 'You'
                      : msg.senderType === 'admin'
                      ? msg.senderName || 'Support'
                      : 'System'}
                  </div>
                  {/* Message body */}
                  <div
                    className={`whitespace-pre-wrap break-words ${
                      fromUser
                        ? 'text-white'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    {msg.body}
                  </div>
                  {/* Timestamp and read status */}
                  <div
                    className={`flex items-center justify-end gap-1 mt-1 ${
                      fromUser
                        ? 'text-violet-200'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    <span
                      className="text-xs"
                      title={formatDateTime(msg.createdAt)}
                    >
                      {formatRelativeTime(msg.createdAt)}
                    </span>
                    {/* Read status for user messages */}
                    {fromUser && (
                      <span
                        title={msg.isRead
                          ? `Read${msg.readAt
                              ? ` at ${formatDateTime(msg.readAt)}`
                              : ''}`
                          : 'Sent'}
                        className="ml-0.5"
                      >
                        {msg.isRead ? (
                          <CheckCheck className="h-3.5 w-3.5 text-blue-300" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply Box */}
        {ticket.ticket.status === 'open' && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-200
                dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900
                text-gray-900 dark:text-white placeholder-gray-400
                focus:outline-none focus:ring-2 focus:ring-violet-500
                resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSendMessage()
                }
              }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Press {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter
                to send
              </span>
              <Button
                onClick={handleSendMessage}
                disabled={!message.trim() || isSending}
              >
                {isSending ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Resolved Notice */}
        {ticket.ticket.status === 'resolved' && (
          <div
            className="p-4 border-t border-gray-200 dark:border-gray-700
              bg-gray-50 dark:bg-gray-800/50"
          >
            <div className="flex items-center justify-center gap-2
              text-gray-500 dark:text-gray-400">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span>This ticket has been resolved.</span>
              <button
                onClick={() => setReopenModalOpen(true)}
                className="text-violet-600 dark:text-violet-400 hover:underline
                  font-medium"
              >
                Reopen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
