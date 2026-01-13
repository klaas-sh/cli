import type { ColumnDef, SortingState } from '@tanstack/react-table'
import type React from 'react'

/**
 * Filter option for dropdowns
 */
export interface FilterOption {
  label: string
  value: string
}

/**
 * Filter configuration for the data table
 */
export interface DataTableFilter {
  id: string
  label: string
  options: FilterOption[]
  value?: string
  onChange: (value: string) => void
  /**
   * Display type for the filter:
   * - 'select': Dropdown select (default)
   * - 'tags': Button-style tags showing all options
   */
  type?: 'select' | 'tags'
  /**
   * Whether to include an "All" option (for tags type)
   */
  showAllOption?: boolean
}

/**
 * Bulk action configuration
 */
export interface BulkAction {
  id: string
  label: string
  icon?: React.ReactNode
  variant?: 'default' | 'destructive'
  onClick: (selectedIds: string[]) => void
}

/**
 * Pagination state for server-side pagination
 */
export interface PaginationState {
  pageIndex: number
  pageSize: number
}

/**
 * Props for the DataTable component
 */
export interface DataTableProps<TData> {
  /** Data array to display in the table */
  data: TData[]
  /** TanStack Table column definitions */
  columns: ColumnDef<TData, unknown>[]
  /** Loading state - shows spinner overlay */
  loading?: boolean

  // Search
  /** Placeholder text for the search input */
  searchPlaceholder?: string
  /** Current search value (controlled) */
  searchValue?: string
  /** Callback when search value changes */
  onSearchChange?: (value: string) => void

  // Filtering
  /** Array of filter configurations to display */
  filters?: DataTableFilter[]

  // Sorting
  /** Current sorting state (controlled) */
  sorting?: SortingState
  /** Callback when sorting changes (for server-side sorting) */
  onSortingChange?: (sorting: SortingState) => void

  // Pagination (server-side)
  /** Total number of pages (for server-side pagination) */
  pageCount?: number
  /** Current page index (0-based) */
  pageIndex?: number
  /** Number of items per page */
  pageSize?: number
  /** Callback when pagination changes */
  onPaginationChange?: (pagination: PaginationState) => void
  /** Total number of items (for "Showing X to Y of Z" display) */
  totalCount?: number

  // Selection
  /** Enable row selection with checkboxes */
  enableRowSelection?: boolean
  /** Callback when row selection changes */
  onRowSelectionChange?: (rows: TData[]) => void

  // Row interaction
  /** Callback when a row is clicked */
  onRowClick?: (row: TData) => void

  // Bulk actions
  /** Array of bulk action configurations */
  bulkActions?: BulkAction[]

  // Styling
  /** Additional CSS classes for the table container */
  className?: string

  // Empty state
  /** Message to display when no data is available */
  emptyMessage?: string
  /** Description text for the empty state */
  emptyDescription?: string
}

/**
 * Props for the DataTableColumnHeader component
 */
export interface DataTableColumnHeaderProps {
  /** TanStack Table column instance */
  column: {
    getCanSort: () => boolean
    getIsSorted: () => false | 'asc' | 'desc'
    toggleSorting: (desc?: boolean, multi?: boolean) => void
  }
  /** Column header title */
  title: string
  /** Additional CSS classes */
  className?: string
}

/**
 * Props for the DataTablePagination component
 */
export interface DataTablePaginationProps {
  /** Current page index (0-based) */
  pageIndex: number
  /** Number of items per page */
  pageSize: number
  /** Total number of pages */
  pageCount: number
  /** Total number of items */
  totalCount: number
  /** Callback when page changes */
  onPageChange: (pageIndex: number) => void
}

/**
 * Props for the DataTableHeader component
 */
export interface DataTableHeaderProps {
  /** Search placeholder text */
  searchPlaceholder?: string
  /** Current search value */
  searchValue?: string
  /** Callback when search changes */
  onSearchChange?: (value: string) => void
  /** Array of filter configurations */
  filters?: DataTableFilter[]
  /** Total count of items */
  totalCount: number
  /** Current page info for display */
  pageInfo: {
    from: number
    to: number
    pageIndex: number
    pageCount: number
  }
  /** Callback when page changes */
  onPageChange: (pageIndex: number) => void
  /** Number of selected rows */
  selectedCount: number
  /** Bulk actions to display when rows are selected */
  bulkActions?: BulkAction[]
  /** Selected row IDs for bulk actions */
  selectedIds: string[]
}
