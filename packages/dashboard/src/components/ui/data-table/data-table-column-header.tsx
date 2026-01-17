'use client'

import React from 'react'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { clsx } from 'clsx'
import type { DataTableColumnHeaderProps } from './types'

/**
 * Sortable column header component for the DataTable.
 * Uses the klaas dark theme with amber accent for sort indicators.
 */
export function DataTableColumnHeader({
  column,
  title,
  className,
}: DataTableColumnHeaderProps): React.JSX.Element {
  const canSort = column.getCanSort()
  const sortDirection = column.getIsSorted()

  if (!canSort) {
    return (
      <span className={clsx(
        'text-xs font-medium uppercase tracking-wider',
        'text-app-text-muted',
        className
      )}>
        {title}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        // Toggle: none -> asc -> desc -> none
        if (sortDirection === false) {
          column.toggleSorting(false) // asc
        } else if (sortDirection === 'asc') {
          column.toggleSorting(true) // desc
        } else {
          column.toggleSorting(undefined) // clear
        }
      }}
      className={clsx(
        'flex items-center gap-1.5 text-xs font-medium uppercase',
        'tracking-wider text-app-text-muted',
        'hover:text-app-text-primary',
        'transition-colors cursor-pointer select-none',
        className
      )}
    >
      {title}
      {sortDirection === 'asc' ? (
        <ArrowUp className="h-3.5 w-3.5 text-app-accent" />
      ) : sortDirection === 'desc' ? (
        <ArrowDown className="h-3.5 w-3.5 text-app-accent" />
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
      )}
    </button>
  )
}
