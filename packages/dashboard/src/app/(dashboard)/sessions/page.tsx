'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { clsx } from 'clsx'
import { dashboardApi } from '@/lib/dashboard-api'
import {
  Clock,
  Monitor,
  Smartphone,
  Eye,
  Trash2,
  RefreshCw,
  LayoutGrid,
  List,
  Terminal,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { ErrorDisplay } from '@/components/ui/error-display'
import { DataTable, DataTableColumnHeader } from '@/components/ui/data-table'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import type { Session } from '@/types/session'

/** Auto-refresh interval in milliseconds (5 seconds) */
const AUTO_REFRESH_INTERVAL_MS = 5000

/** View mode type */
type ViewMode = 'table' | 'grid'

/**
 * Terminal card component for grid view.
 * Uses the klaas dark theme.
 */
function TerminalCard({
  session,
  onView,
  onDelete,
}: {
  session: Session
  onView: () => void
  onDelete: () => void
}): React.JSX.Element {
  const statusColor = session.status === 'active'
    ? 'bg-app-status-connected'
    : session.status === 'idle'
    ? 'bg-app-status-connecting'
    : 'bg-app-text-muted'

  return (
    <div
      className="bg-app-bg-surface rounded-lg overflow-hidden border
        border-app-border-visible hover:border-app-accent transition-colors
        cursor-pointer group"
      onClick={onView}
    >
      {/* Terminal Title Bar */}
      <div
        className="bg-app-bg-elevated px-3 py-2 flex items-center justify-between
          border-b border-app-border-subtle"
      >
        <div className="flex items-center gap-2">
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="w-3 h-3 rounded-full bg-app-error hover:bg-app-error/80
                transition-colors"
              title="End session"
            />
            <div className="w-3 h-3 rounded-full bg-app-warning" />
            <div className="w-3 h-3 rounded-full bg-app-success" />
          </div>
          {/* Terminal icon and name */}
          <div className="flex items-center gap-2 ml-2">
            {session.deviceType === 'cli' ? (
              <Monitor className="h-3.5 w-3.5 text-app-text-muted" />
            ) : (
              <Smartphone className="h-3.5 w-3.5 text-app-text-muted" />
            )}
            <span className="text-xs font-medium text-app-text-secondary
              truncate max-w-[120px]">
              {session.deviceName}
            </span>
          </div>
        </div>
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <span className={clsx('w-2 h-2 rounded-full', statusColor)} />
          <span className="text-xs text-app-text-muted">
            {session.status}
          </span>
        </div>
      </div>

      {/* Terminal Content */}
      <div className="p-3 font-mono text-xs min-h-[100px] relative">
        {/* CWD prompt */}
        <div className="text-app-terminal-green mb-1">
          <span className="text-app-terminal-purple">~</span>
          <span className="text-app-text-dim">/</span>
          <span className="text-app-text-secondary truncate">
            {session.cwd.split('/').slice(-2).join('/')}
          </span>
        </div>
        {/* Fake command prompt */}
        <div className="flex items-center gap-2">
          <span className="text-app-terminal-purple">$</span>
          <span className="text-app-text-muted">
            {session.status === 'active'
              ? '_'
              : `Last activity: ${formatRelativeTime(session.lastActivityAt)}`}
          </span>
          {session.status === 'active' && (
            <span className="w-2 h-4 bg-app-text-muted animate-pulse" />
          )}
        </div>

        {/* Hover overlay */}
        <div
          className="absolute inset-0 bg-app-bg-void/60 opacity-0
            group-hover:opacity-100 transition-opacity flex items-center
            justify-center"
        >
          <div className="flex items-center gap-2 text-app-text-primary">
            <Eye className="h-5 w-5" />
            <span className="text-sm font-medium">View Session</span>
          </div>
        </div>
      </div>

      {/* Terminal Footer */}
      <div
        className="px-3 py-2 bg-app-bg-elevated/50 border-t border-app-border-subtle
          flex items-center justify-between text-xs text-app-text-muted"
      >
        <span>{formatRelativeTime(session.createdAt)}</span>
        <span className="font-mono text-[10px] text-app-text-dim">
          {session.id.slice(-8)}
        </span>
      </div>
    </div>
  )
}

/**
 * Sessions list page.
 * Uses the klaas dark theme with amber accents.
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
  const [viewMode, setViewMode] = useState<ViewMode>('table')
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
            <Monitor className="h-5 w-5 text-app-text-muted" />
          ) : (
            <Smartphone className="h-5 w-5 text-app-text-muted" />
          )}
          <div>
            <div className="font-medium text-app-text-primary">
              {row.original.deviceName}
            </div>
            <div className="text-xs text-app-text-muted font-mono
              truncate max-w-[200px]">
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
        <div className="flex items-center gap-2 text-sm text-app-text-secondary">
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
        <div className="text-sm text-app-text-secondary">
          {formatDateTime(row.original.createdAt)}
        </div>
      ),
    },
    {
      id: 'actions',
      header: () => (
        <span className="text-xs font-medium uppercase tracking-wider
          text-app-text-muted">
          Actions
        </span>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => router.push(`/sessions/${row.original.id}`)}
            className="p-1 text-app-text-muted hover:text-app-accent
              transition-colors"
            title="View session"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleDeleteSession(row.original.id)}
            className="p-1 text-app-text-muted hover:text-app-error
              transition-colors"
            title="End session"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ]

  // Filter active sessions for grid view
  const activeSessions = sessions.filter(
    s => s.status === 'active' || s.status === 'idle'
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center
        sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-app-text-primary">
            Sessions
          </h1>
          <p className="text-sm text-app-text-secondary mt-1">
            View and manage your terminal sessions
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div
            className="flex items-center bg-app-bg-surface rounded-lg p-1
              border border-app-border-subtle"
          >
            <button
              onClick={() => setViewMode('table')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm',
                'transition-colors',
                viewMode === 'table'
                  ? 'bg-app-bg-elevated text-app-text-primary'
                  : 'text-app-text-muted hover:text-app-text-secondary'
              )}
              title="Table view"
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">Table</span>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm',
                'transition-colors',
                viewMode === 'grid'
                  ? 'bg-app-bg-elevated text-app-text-primary'
                  : 'text-app-text-muted hover:text-app-text-secondary'
              )}
              title="Terminal grid view"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden sm:inline">Terminal</span>
            </button>
          </div>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
              transition-colors border ${
                autoRefreshEnabled
                  ? 'bg-app-accent-muted text-app-accent border-app-accent/30'
                  : 'bg-app-bg-surface text-app-text-muted ' +
                    'border-app-border-subtle'
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
            className="p-2 text-app-text-muted hover:text-app-text-primary
              hover:bg-app-bg-elevated rounded-lg transition-colors
              disabled:opacity-50"
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

      {/* Table View */}
      {viewMode === 'table' && (
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
          emptyDescription="Start a terminal session using the CLI"
        />
      )}

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className="space-y-4">
          {/* Stats bar */}
          <div
            className="flex items-center gap-4 text-sm text-app-text-secondary"
          >
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              <span>
                {activeSessions.length} active session
                {activeSessions.length !== 1 ? 's' : ''}
              </span>
            </div>
            {sessions.length > activeSessions.length && (
              <span className="text-app-text-muted">
                ({sessions.length - activeSessions.length} disconnected)
              </span>
            )}
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div
                className="h-8 w-8 animate-spin rounded-full border-4
                  border-app-accent border-t-transparent"
              />
            </div>
          )}

          {/* Empty state */}
          {!isLoading && activeSessions.length === 0 && (
            <div
              className="text-center py-12 bg-app-bg-surface rounded-lg
                border border-dashed border-app-border-visible"
            >
              <Terminal
                className="h-12 w-12 mx-auto text-app-text-muted mb-4"
              />
              <h3
                className="text-lg font-medium text-app-text-primary mb-1"
              >
                No active sessions
              </h3>
              <p className="text-sm text-app-text-secondary">
                Start a terminal session using the klaas CLI
              </p>
            </div>
          )}

          {/* Terminal grid */}
          {!isLoading && activeSessions.length > 0 && (
            <div
              className="grid gap-4 grid-cols-1 sm:grid-cols-2
                lg:grid-cols-3 xl:grid-cols-4"
            >
              {activeSessions.map((session) => (
                <TerminalCard
                  key={session.id}
                  session={session}
                  onView={() => router.push(`/sessions/${session.id}`)}
                  onDelete={() => handleDeleteSession(session.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
