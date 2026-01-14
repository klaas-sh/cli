'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { dashboardApi } from '@/lib/dashboard-api'
import {
  Clock,
  Monitor,
  Smartphone,
  Eye,
  Trash2,
  RefreshCw,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { ErrorDisplay } from '@/components/ui/error-display'
import { DataTable, DataTableColumnHeader } from '@/components/ui/data-table'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import type { Session } from '@/types/session'

/** Auto-refresh interval in milliseconds (5 seconds) */
const AUTO_REFRESH_INTERVAL_MS = 5000

/**
 * Sessions list page.
 * Displays all Claude Code sessions for the authenticated user in a data
 * table with search, sorting, and pagination.
 */
export default function SessionsPage(): React.JSX.Element {
  const router = useRouter()
  const { addToast } = useToast()
  const [sessions, setSessions] = useState<Session[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [total, setTotal] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'lastActivityAt', desc: true }
  ])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pageSize = 20

  /**
   * Load sessions from API.
   * @param showLoading - Whether to show loading state (false for background
   *                      refresh)
   */
  const loadSessions = useCallback(async (
    showLoading = true
  ): Promise<void> => {
    if (showLoading) {
      setIsLoading(true)
    } else {
      setIsRefreshing(true)
    }
    setError(null)
    try {
      const response = await dashboardApi.getSessions({
        page: pageIndex + 1,
        limit: pageSize,
        search: searchTerm || undefined,
      })
      setSessions(response.data)
      setPageCount(response.meta.totalPages)
      setTotal(response.meta.total)
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : 'Failed to load sessions'
      setError(errorMessage)
      setSessions([])
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [pageIndex, searchTerm])

  // Initial load
  useEffect(() => {
    loadSessions(true)
  }, [loadSessions])

  // Auto-refresh polling
  useEffect(() => {
    if (autoRefreshEnabled) {
      refreshIntervalRef.current = setInterval(() => {
        loadSessions(false)
      }, AUTO_REFRESH_INTERVAL_MS)
    }

    return (): void => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
        refreshIntervalRef.current = null
      }
    }
  }, [autoRefreshEnabled, loadSessions])

  const handleDeleteSession = async (id: string): Promise<void> => {
    try {
      await dashboardApi.deleteSession(id)
      addToast({
        title: 'Session Ended',
        description: 'The session has been terminated',
        type: 'success'
      })
      loadSessions()
    } catch {
      addToast({
        title: 'Error',
        description: 'Failed to end session',
        type: 'error'
      })
    }
  }

  const columns: ColumnDef<Session, unknown>[] = [
    {
      id: 'device',
      accessorFn: (row) => row.deviceName,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Device" />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          {row.original.deviceType === 'cli' ? (
            <Monitor className="h-5 w-5 text-gray-400" />
          ) : (
            <Smartphone className="h-5 w-5 text-gray-400" />
          )}
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              {row.original.deviceName}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400
              font-mono truncate max-w-[200px]">
              {row.original.cwd}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }): React.JSX.Element => {
        const status = row.original.status
        const variant = status === 'active' ? 'success'
          : status === 'idle' ? 'warning' : 'default'
        return (
          <Badge variant={variant}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        )
      },
    },
    {
      id: 'lastActivityAt',
      accessorKey: 'lastActivityAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Last Activity" />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-sm text-gray-600
          dark:text-gray-400">
          <Clock className="h-4 w-4" />
          {formatRelativeTime(row.original.lastActivityAt)}
        </div>
      ),
    },
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Started" />
      ),
      cell: ({ row }) => (
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {formatDateTime(row.original.createdAt)}
        </div>
      ),
    },
    {
      id: 'actions',
      header: () => (
        <span className="text-xs font-medium uppercase tracking-wider
          text-gray-500 dark:text-gray-400">
          Actions
        </span>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => router.push(`/sessions/${row.original.id}`)}
            className="p-1 text-gray-400 hover:text-app-primary
              dark:hover:text-app-primary-dark"
            title="View session"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleDeleteSession(row.original.id)}
            className="p-1 text-gray-400 hover:text-red-600
              dark:hover:text-red-400"
            title="End session"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center
        sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900
            dark:text-white">
            Sessions
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            View and manage your Claude Code sessions
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
              transition-colors ${
                autoRefreshEnabled
                  ? 'bg-app-primary/10 text-app-primary dark:text-app-primary-dark'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 ' +
                    'dark:text-gray-400'
              }`}
            title={autoRefreshEnabled
              ? 'Auto-refresh enabled'
              : 'Auto-refresh disabled'}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''
              }`} />
            <span className="hidden sm:inline">
              {autoRefreshEnabled ? 'Live' : 'Paused'}
            </span>
          </button>
          {/* Manual refresh button */}
          <button
            onClick={() => loadSessions(false)}
            disabled={isRefreshing || isLoading}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400
              dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700
              rounded-lg transition-colors disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''
              }`} />
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <ErrorDisplay error={error} onDismiss={() => setError(null)} />
      )}

      {/* Sessions Table */}
      <DataTable
        data={sessions}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Search sessions..."
        searchValue={searchTerm}
        onSearchChange={(value) => {
          setSearchTerm(value)
          setPageIndex(0)
        }}
        sorting={sorting}
        onSortingChange={setSorting}
        pageCount={pageCount}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPaginationChange={({ pageIndex: newPage }) => setPageIndex(newPage)}
        totalCount={total}
        onRowClick={(row) => router.push(`/sessions/${row.id}`)}
        emptyMessage="No sessions found"
        emptyDescription="Start a Claude Code session using the CLI"
      />
    </div>
  )
}
