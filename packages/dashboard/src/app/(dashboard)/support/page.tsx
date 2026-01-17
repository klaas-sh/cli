'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { type ColumnDef } from '@tanstack/react-table'
import {
  MessageSquare,
  Plus,
  CheckCircle2,
  Clock,
  Circle,
  Eye,
  MessageCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { ErrorDisplay } from '@/components/ui/error-display'
import { EmptyState } from '@/components/ui/empty-state'
import { StatsCard } from '@/components/ui/stats-card'
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFilter,
} from '@/components/ui/data-table'
import {
  getSupportTickets,
  getSupportStatus,
  type SupportTicketListItem,
  type SupportStatus,
  type TicketStatus,
} from '@/lib/dashboard-api'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'

/**
 * Support tickets list page with DataTable
 * Users can view their support tickets and create new ones
 */
export default function SupportPage(): React.JSX.Element {
  const router = useRouter()
  const { addToast } = useToast()
  const [tickets, setTickets] = useState<SupportTicketListItem[]>([])
  const [supportStatus, setSupportStatus] = useState<SupportStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [total, setTotal] = useState(0)

  const pageSize = 20

  const loadTickets = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await getSupportTickets({
        limit: pageSize,
        status: statusFilter as TicketStatus || undefined,
        sort: 'updated_at',
        order: 'desc',
      })

      setTickets(response.data)
      setTotal(response.meta.total)
      setPageCount(Math.ceil(response.meta.total / pageSize))
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to load tickets'
      setError(errorMessage)
      addToast({
        title: 'Error',
        description: errorMessage,
        type: 'error',
      })
    } finally {
      setIsLoading(false)
    }
  }, [statusFilter, addToast])

  const loadSupportStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await getSupportStatus()
      setSupportStatus(status)
    } catch {
      // Non-critical, fail silently
    }
  }, [])

  useEffect(() => {
    loadTickets()
    loadSupportStatus()
  }, [loadTickets, loadSupportStatus])

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

  // Calculate stats from loaded tickets
  const openCount = useMemo(
    () => tickets.filter((t) => t.status === 'open').length,
    [tickets]
  )
  const resolvedCount = useMemo(
    () => tickets.filter((t) => t.status === 'resolved').length,
    [tickets]
  )

  // TanStack Table column definitions
  const columns: ColumnDef<SupportTicketListItem, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'subject',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Subject" />
        ),
        cell: ({ row }): React.JSX.Element => {
          const ticket = row.original
          return (
            <div className="flex items-center gap-2">
              {ticket.hasUnreadMessages && (
                <span
                  className="w-2 h-2 rounded-full bg-[#f59e0b] flex-shrink-0"
                  title="New messages"
                />
              )}
              <div className="min-w-0">
                <span className="font-medium text-[#fafafa] truncate block">
                  {ticket.subject}
                </span>
                <span className="text-xs text-[#71717a]">
                  #{ticket.id.slice(-8)}
                </span>
              </div>
            </div>
          )
        },
        enableSorting: true,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => getStatusBadge(row.original.status),
        enableSorting: true,
      },
      {
        accessorKey: 'messageCount',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Messages" />
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-[#71717a]" />
            <span className="text-sm text-[#a1a1aa]">
              {row.original.messageCount}
            </span>
          </div>
        ),
        enableSorting: true,
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created" />
        ),
        cell: ({ row }) => (
          <div className="text-sm text-[#a1a1aa]">
            {formatDateTime(row.original.createdAt)}
          </div>
        ),
        enableSorting: true,
      },
      {
        accessorKey: 'updatedAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Last Update" />
        ),
        cell: ({ row }) => (
          <div className="text-sm text-[#a1a1aa]"
            title={formatDateTime(row.original.updatedAt)}>
            {formatRelativeTime(row.original.updatedAt)}
          </div>
        ),
        enableSorting: true,
      },
      {
        id: 'actions',
        header: () => (
          <span className="text-xs font-medium uppercase tracking-wider
            text-[#71717a]">
            Actions
          </span>
        ),
        cell: ({ row }) => (
          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                router.push(`/support/${row.original.id}`)
              }}
              className="p-1 text-[#71717a] hover:text-[#f59e0b]"
              title="View ticket"
            >
              <Eye className="h-4 w-4" />
            </button>
          </div>
        ),
        enableSorting: false,
      },
    ],
    [router]
  )

  // Filter configuration for DataTable
  const filters: DataTableFilter[] = [
    {
      id: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { label: 'All', value: '' },
        { label: 'Open', value: 'open' },
        { label: 'Resolved', value: 'resolved' },
      ],
      value: statusFilter,
      onChange: (value): void => {
        setStatusFilter(value)
        setPageIndex(0)
      },
    },
  ]

  // Check if any filters are active
  const hasActiveFilters = statusFilter !== ''

  // Filter tickets by search term (client-side for simplicity)
  const filteredTickets = useMemo(() => {
    if (!searchTerm) {return tickets}
    const term = searchTerm.toLowerCase()
    return tickets.filter(
      (ticket) =>
        ticket.subject.toLowerCase().includes(term) ||
        ticket.id.toLowerCase().includes(term)
    )
  }, [tickets, searchTerm])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center
        sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-[#fafafa]">
            Support
          </h1>
          <p className="text-sm text-[#a1a1aa] mt-1">
            View and manage your support tickets
          </p>
        </div>
        <Button
          onClick={() => router.push('/support/create')}
          title="New Ticket"
        >
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">New Ticket</span>
        </Button>
      </div>

      {/* Support Status Banner */}
      {supportStatus && (
        <div
          className={`rounded-xl border p-4 ${
            supportStatus.isOnline
              ? 'bg-[#22c55e]/10 border-[#22c55e]/30'
              : 'bg-[#eab308]/10 border-[#eab308]/30'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                supportStatus.isOnline
                  ? 'bg-[#22c55e] animate-pulse'
                  : 'bg-[#eab308]'
              }`}
            />
            <div>
              <p
                className={`font-medium ${
                  supportStatus.isOnline
                    ? 'text-[#4ade80]'
                    : 'text-[#fbbf24]'
                }`}
              >
                {supportStatus.isOnline
                  ? 'Support is online'
                  : 'Support is offline'}
              </p>
              <p
                className={`text-sm ${
                  supportStatus.isOnline
                    ? 'text-[#22c55e]'
                    : 'text-[#eab308]'
                }`}
              >
                {supportStatus.isOnline
                  ? `${supportStatus.agentCount} agent${
                      supportStatus.agentCount !== 1 ? 's' : ''
                    } available`
                  : `Expected response: ${
                      supportStatus.expectedResponseTime || 'within 24 hours'
                    }`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard
          label="Total Tickets"
          value={total}
          icon={MessageSquare}
          color="purple"
        />
        <StatsCard
          label="Open Tickets"
          value={openCount}
          icon={Clock}
          color="yellow"
        />
        <StatsCard
          label="Resolved"
          value={resolvedCount}
          icon={CheckCircle2}
          color="green"
        />
      </div>

      {/* Error Display */}
      {error && (
        <ErrorDisplay error={error} onDismiss={() => setError(null)} />
      )}

      {/* Empty State - only show when no filters/search are active */}
      {!isLoading && !error && tickets.length === 0 && !hasActiveFilters && (
        <EmptyState
          icon={MessageSquare}
          title="No support tickets"
          description="Need help? Create a support ticket and our team
            will assist you."
          actionLabel="Create Ticket"
          onAction={() => router.push('/support/create')}
        />
      )}

      {/* Tickets Table */}
      {(tickets.length > 0 || hasActiveFilters || searchTerm) && (
        <DataTable
          data={filteredTickets}
          columns={columns}
          loading={isLoading}
          searchPlaceholder="Search by subject or ticket ID..."
          searchValue={searchTerm}
          onSearchChange={(value) => {
            setSearchTerm(value)
            setPageIndex(0)
          }}
          filters={filters}
          pageCount={pageCount}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPaginationChange={({ pageIndex: newPage }) => setPageIndex(newPage)}
          totalCount={total}
          onRowClick={(row) => router.push(`/support/${row.id}`)}
        />
      )}
    </div>
  )
}
