'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Circle, Monitor, Clock, Folder } from 'lucide-react'
import { dashboardApi } from '@/lib/dashboard-api'
import { Terminal } from '@/components/sessions/terminal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatDateTime } from '@/lib/date-utils'
import type { Session } from '@/types/session'

/**
 * Session detail page with terminal interface.
 * Displays session information and provides a real-time terminal connection.
 */
export default function SessionDetailPage(): React.JSX.Element {
  const router = useRouter()
  const params = useParams()
  const { addToast } = useToast()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sessionId = params.id as string

  useEffect(() => {
    async function loadSession(): Promise<void> {
      try {
        const result = await dashboardApi.getSessionById(sessionId)
        setSession(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session')
      } finally {
        setLoading(false)
      }
    }
    loadSession()
  }, [sessionId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-blue-600
          border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 dark:text-red-400">
          {error || 'Session not found'}
        </p>
        <Button onClick={() => router.push('/sessions')} className="mt-4">
          Back to Sessions
        </Button>
      </div>
    )
  }

  const statusColor = session.status === 'active' ? 'text-green-500'
    : session.status === 'idle' ? 'text-yellow-500' : 'text-gray-400'

  const statusVariant = session.status === 'active' ? 'success'
    : session.status === 'idle' ? 'warning' : 'default'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/sessions')}
          className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400
            dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700
            rounded-lg transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              {session.deviceName}
            </h1>
            <Badge variant={statusVariant}>
              <Circle className={`h-2 w-2 mr-1 fill-current ${statusColor}`} />
              {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
            </Badge>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">
            {session.cwd}
          </p>
        </div>
      </div>

      {/* Session Info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border
          border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500
            dark:text-gray-400 text-sm">
            <Monitor className="h-4 w-4" />
            Device Type
          </div>
          <p className="mt-1 font-medium text-gray-900 dark:text-white">
            {session.deviceType === 'cli' ? 'CLI' : 'Web'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border
          border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500
            dark:text-gray-400 text-sm">
            <Clock className="h-4 w-4" />
            Started
          </div>
          <p className="mt-1 font-medium text-gray-900 dark:text-white">
            {formatDateTime(session.createdAt)}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border
          border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500
            dark:text-gray-400 text-sm">
            <Clock className="h-4 w-4" />
            Last Activity
          </div>
          <p className="mt-1 font-medium text-gray-900 dark:text-white">
            {formatDateTime(session.lastActivityAt)}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border
          border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500
            dark:text-gray-400 text-sm">
            <Folder className="h-4 w-4" />
            Working Directory
          </div>
          <p className="mt-1 font-medium text-gray-900 dark:text-white
            truncate" title={session.cwd}>
            {session.cwd.split('/').pop() || session.cwd}
          </p>
        </div>
      </div>

      {/* Terminal */}
      <div className="bg-gray-900 rounded-lg overflow-hidden border
        border-gray-700">
        <div className="px-4 py-2 bg-gray-800 border-b border-gray-700
          flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-500" />
            <div className="h-3 w-3 rounded-full bg-yellow-500" />
            <div className="h-3 w-3 rounded-full bg-green-500" />
          </div>
          <span className="text-sm text-gray-400 ml-2">
            Claude Code Session
          </span>
        </div>
        <Terminal
          sessionId={sessionId}
          onDisconnect={() => {
            addToast({
              title: 'Disconnected',
              description: 'Terminal connection lost',
              type: 'warning'
            })
          }}
        />
      </div>
    </div>
  )
}
