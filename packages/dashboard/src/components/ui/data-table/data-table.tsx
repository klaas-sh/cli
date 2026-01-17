'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type RowSelectionState,
} from '@tanstack/react-table'
import { clsx } from 'clsx'
import { DataTableHeader } from './data-table-header'
import { DataTablePagination } from './data-table-pagination'
import type { DataTableProps } from './types'

/**
 * Unified DataTable component built on TanStack Table.
 * Uses the klaas dark theme with amber accents.
 */
export function DataTable<TData extends { id: string }>({
  data,
  columns,
  loading = false,
  // Search
  searchPlaceholder,
  searchValue,
  onSearchChange,
  // Filtering
  filters,
  // Sorting
  sorting: externalSorting,
  onSortingChange,
  // Pagination
  pageCount = 1,
  pageIndex = 0,
  pageSize = 20,
  onPaginationChange,
  totalCount,
  // Selection
  enableRowSelection = false,
  onRowSelectionChange,
  // Row interaction
  onRowClick,
  // Bulk actions
  bulkActions,
  // Styling
  className,
  // Empty state
  emptyMessage = 'No data found',
  emptyDescription,
}: DataTableProps<TData>): React.JSX.Element {
  // Internal sorting state (used if no external control)
  const [internalSorting, setInternalSorting] = useState<SortingState>([])
  const sorting = externalSorting ?? internalSorting

  // Row selection state
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  // Clear selection when data changes (e.g., after bulk actions or data refresh)
  useEffect(() => {
    setRowSelection({})
    if (onRowSelectionChange) {
      onRowSelectionChange([])
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate display total (use provided totalCount or data length)
  const displayTotal = totalCount ?? data.length
  const displayPageCount = pageCount > 0 ? pageCount : 1

  // Build columns with selection checkbox if enabled
  const tableColumns = useMemo(() => {
    if (!enableRowSelection) {
      return columns
    }

    // Add selection column at the start
    const selectionColumn = {
      id: 'select',
      header: ({
        table
      }: {
        table: ReturnType<typeof useReactTable<TData>>
      }): React.JSX.Element => (
        <div className="flex items-center">
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)}
            className="rounded border-app-border-visible bg-app-bg-deep
              text-app-accent focus:ring-app-accent"
            aria-label="Select all"
          />
        </div>
      ),
      cell: ({
        row
      }: {
        row: {
          getIsSelected: () => boolean
          toggleSelected: (value?: boolean) => void
        }
      }): React.JSX.Element => (
        <div
          className="flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={(e) => row.toggleSelected(e.target.checked)}
            className="rounded border-app-border-visible bg-app-bg-deep
              text-app-accent focus:ring-app-accent"
            aria-label="Select row"
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
    }

    return [selectionColumn, ...columns]
  }, [columns, enableRowSelection])

  // Create table instance
  const table = useReactTable({
    data,
    columns: tableColumns,
    state: {
      sorting,
      rowSelection,
    },
    enableRowSelection,
    onSortingChange: (updater) => {
      const newSorting = typeof updater === 'function'
        ? updater(sorting)
        : updater
      if (onSortingChange) {
        onSortingChange(newSorting)
      } else {
        setInternalSorting(newSorting)
      }
    },
    onRowSelectionChange: (updater) => {
      const newSelection = typeof updater === 'function'
        ? updater(rowSelection)
        : updater
      setRowSelection(newSelection)

      // Call external handler with selected rows
      if (onRowSelectionChange) {
        const selectedRows = Object.keys(newSelection)
          .filter((key) => newSelection[key])
          .map((key) => data[parseInt(key, 10)])
          .filter(Boolean)
        onRowSelectionChange(selectedRows)
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    manualSorting: !!onSortingChange,
    pageCount: displayPageCount,
  })

  // Get selected row IDs for bulk actions
  const selectedIds = useMemo(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map((key) => data[parseInt(key, 10)]?.id)
      .filter(Boolean) as string[]
  }, [rowSelection, data])

  // Calculate page info
  const from = displayTotal > 0 ? pageIndex * pageSize + 1 : 0
  const to = Math.min((pageIndex + 1) * pageSize, displayTotal)

  // Handle page change
  const handlePageChange = (newPageIndex: number): void => {
    if (onPaginationChange) {
      onPaginationChange({ pageIndex: newPageIndex, pageSize })
    }
    // Clear selection on page change
    setRowSelection({})
  }

  return (
    <div className={clsx(
      'rounded-xl border border-app-border-visible',
      'bg-app-bg-surface overflow-hidden',
      className
    )}>
      {/* Header with search, filters, count, pagination */}
      <DataTableHeader
        searchPlaceholder={searchPlaceholder}
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        filters={filters}
        totalCount={displayTotal}
        pageInfo={{
          from,
          to,
          pageIndex,
          pageCount: displayPageCount,
        }}
        onPageChange={handlePageChange}
        selectedCount={selectedIds.length}
        bulkActions={bulkActions}
        selectedIds={selectedIds}
      />

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-app-border-subtle bg-app-bg-elevated">
              {table.getHeaderGroups().map((headerGroup) =>
                headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    className={clsx(
                      'px-4 py-3 text-left',
                      header.column.getCanSort() && 'cursor-pointer select-none'
                    )}
                    style={{
                      width: header.getSize() !== 150
                        ? header.getSize()
                        : undefined,
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border-subtle">
            {loading ? (
              <tr>
                <td
                  colSpan={tableColumns.length}
                  className="px-4 py-8 text-center"
                >
                  <div className="inline-block h-6 w-6 animate-spin
                    rounded-full border-2 border-app-accent border-t-transparent"
                  />
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColumns.length}
                  className="px-4 py-12 text-center"
                >
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-app-text-secondary font-medium">
                      {emptyMessage}
                    </span>
                    {emptyDescription && (
                      <span className="text-sm text-app-text-muted">
                        {emptyDescription}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={clsx(
                    'hover:bg-app-bg-elevated transition-colors',
                    onRowClick && 'cursor-pointer',
                    row.getIsSelected() && 'bg-app-accent-muted'
                  )}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-4 text-sm text-app-text-primary"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer pagination (alternative position) */}
      <DataTablePagination
        pageIndex={pageIndex}
        pageSize={pageSize}
        pageCount={displayPageCount}
        totalCount={displayTotal}
        onPageChange={handlePageChange}
      />
    </div>
  )
}
