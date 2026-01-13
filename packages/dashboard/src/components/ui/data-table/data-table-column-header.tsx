'use client'

import React from 'react'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { clsx } from 'clsx'
import type { DataTableColumnHeaderProps } from './types'

/**
 * Sortable column header component for the DataTable.
 * Displays the column title with sort indicators.
 * Click to toggle between ascending, descending, and no sort.
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
        'text-gray-500 dark:text-gray-400',
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
        'tracking-wider text-gray-500 dark:text-gray-400',
        'hover:text-gray-700 dark:hover:text-gray-200',
        'transition-colors cursor-pointer select-none',
        className
      )}
    >
      {title}
      {sortDirection === 'asc' ? (
        <ArrowUp className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
      ) : sortDirection === 'desc' ? (
        <ArrowDown className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
      )}
    </button>
  )
}
