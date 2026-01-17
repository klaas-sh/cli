'use client'

import React, { useEffect, useState } from 'react'
import { Search, X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { DataTableHeaderProps } from './types'

/**
 * Header component for the DataTable.
 * Uses the klaas dark theme with amber accents.
 */
export function DataTableHeader({
  searchPlaceholder = 'Search...',
  searchValue = '',
  onSearchChange,
  filters,
  totalCount,
  pageInfo,
  onPageChange,
  selectedCount,
  bulkActions,
  selectedIds,
}: DataTableHeaderProps): React.JSX.Element {
  // Local search state for debouncing
  const [localSearch, setLocalSearch] = useState(searchValue)

  // Sync local search with external value
  useEffect(() => {
    setLocalSearch(searchValue)
  }, [searchValue])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (onSearchChange && localSearch !== searchValue) {
        onSearchChange(localSearch)
      }
    }, 300)
    return (): void => clearTimeout(timer)
  }, [localSearch, onSearchChange, searchValue])

  const hasFilters = filters && filters.length > 0
  const { from, to, pageIndex, pageCount } = pageInfo
  const currentPage = pageIndex + 1

  return (
    <div className="border-b border-app-border-subtle p-4">
      {/* Row 1: Search, Filters, and Bulk Actions */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Search Input */}
        {onSearchChange && (
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2
              text-app-text-muted" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="w-full rounded-lg border border-app-border-visible
                bg-app-bg-deep text-app-text-primary py-2 pl-10 pr-10 text-sm
                placeholder:text-app-text-dim
                focus:border-app-accent focus:outline-none focus:ring-1
                focus:ring-app-accent"
            />
            {localSearch && (
              <button
                type="button"
                onClick={() => {
                  setLocalSearch('')
                  onSearchChange?.('')
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2
                  text-app-text-muted hover:text-app-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* Filters */}
        {hasFilters && filters.map((filter) =>
          filter.type === 'tags' ? (
            // Tag-style filter buttons
            <div key={filter.id} className="flex flex-wrap items-center gap-2">
              {filter.showAllOption !== false && (
                <button
                  type="button"
                  onClick={() => filter.onChange('')}
                  className={`inline-flex items-center px-3 py-1.5 rounded-lg
                    text-sm font-medium transition-colors ${
                    filter.value === '' || !filter.value
                      ? 'bg-app-accent text-app-bg-void'
                      : 'bg-app-bg-elevated text-app-text-secondary ' +
                        'hover:text-app-text-primary'
                  }`}
                >
                  All
                </button>
              )}
              {filter.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => filter.onChange(option.value)}
                  className={`inline-flex items-center px-3 py-1.5 rounded-lg
                    text-sm font-medium transition-colors ${
                    filter.value === option.value
                      ? 'bg-app-accent text-app-bg-void'
                      : 'bg-app-bg-elevated text-app-text-secondary ' +
                        'hover:text-app-text-primary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            // Dropdown select filter
            <select
              key={filter.id}
              value={filter.value ?? ''}
              onChange={(e) => filter.onChange(e.target.value)}
              className="rounded-lg border border-app-border-visible
                bg-app-bg-deep text-app-text-primary
                py-2 pl-3 pr-8 text-sm focus:border-app-accent focus:outline-none
                focus:ring-1 focus:ring-app-accent"
            >
              <option value="">{filter.label}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )
        )}

        {/* Bulk Actions (shown when items are selected) */}
        {selectedCount > 0 && bulkActions && bulkActions.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-app-text-secondary">
              {selectedCount} selected
            </span>
            {bulkActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => action.onClick(selectedIds)}
                className={`inline-flex items-center gap-2 rounded-lg
                  px-3 py-2 text-sm font-medium transition-colors
                  ${action.variant === 'destructive'
                    ? 'bg-app-error text-white hover:bg-app-error/80'
                    : 'bg-app-bg-elevated text-app-text-secondary ' +
                      'hover:text-app-text-primary'
                  }`}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Row 2: Item count and pagination (if we have data) */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between mt-4">
          {/* Showing X to Y of Z items */}
          <div className="text-sm text-app-text-muted">
            Showing {from} to {to} of {totalCount} items
          </div>

          {/* Pagination: < Page 1 of 5 > */}
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPageChange(pageIndex - 1)}
                disabled={pageIndex === 0}
                className="rounded p-1 text-app-text-muted hover:bg-app-bg-elevated
                  hover:text-app-text-primary disabled:opacity-50
                  disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <span className="text-sm text-app-text-secondary">
                Page {currentPage} of {pageCount}
              </span>

              <button
                type="button"
                onClick={() => onPageChange(pageIndex + 1)}
                disabled={pageIndex >= pageCount - 1}
                className="rounded p-1 text-app-text-muted hover:bg-app-bg-elevated
                  hover:text-app-text-primary disabled:opacity-50
                  disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
