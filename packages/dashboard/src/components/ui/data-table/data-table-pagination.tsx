'use client'

import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { DataTablePaginationProps } from './types'

/**
 * Pagination footer component for the DataTable.
 * Shows "Showing X to Y of Z items" on the left and page navigation
 * on the right.
 */
export function DataTablePagination({
  pageIndex,
  pageSize,
  pageCount,
  totalCount,
  onPageChange,
}: DataTablePaginationProps): React.JSX.Element | null {
  // Don't render if there's no data or only one page
  if (totalCount === 0) {
    return null
  }

  const from = pageIndex * pageSize + 1
  const to = Math.min((pageIndex + 1) * pageSize, totalCount)
  const currentPage = pageIndex + 1

  return (
    <div className="flex items-center justify-between border-t
      border-gray-200 dark:border-gray-700 px-4 py-3">
      {/* Left: Showing X to Y of Z items */}
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Showing {from} to {to} of {totalCount} items
      </div>

      {/* Right: Page navigation */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(pageIndex - 1)}
          disabled={pageIndex === 0}
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100
            hover:text-gray-600 dark:hover:bg-gray-700
            dark:hover:text-gray-300 disabled:opacity-50
            disabled:cursor-not-allowed"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <span className="text-sm text-gray-700 dark:text-gray-300">
          Page {currentPage} of {pageCount}
        </span>

        <button
          type="button"
          onClick={() => onPageChange(pageIndex + 1)}
          disabled={pageIndex >= pageCount - 1}
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100
            hover:text-gray-600 dark:hover:bg-gray-700
            dark:hover:text-gray-300 disabled:opacity-50
            disabled:cursor-not-allowed"
          aria-label="Next page"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
