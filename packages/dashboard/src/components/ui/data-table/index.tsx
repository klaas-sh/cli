/**
 * DataTable - Unified table component for dashboard overview pages
 *
 * Built on TanStack Table with Tailwind CSS styling.
 * Features:
 * - Sortable columns with visual indicators
 * - Row selection with checkboxes
 * - Server-side pagination support
 * - Search and filter integration
 * - Bulk actions when rows are selected
 * - Clickable rows for navigation
 */

export { DataTable } from './data-table'
export { DataTableColumnHeader } from './data-table-column-header'
export { DataTableHeader } from './data-table-header'
export { DataTablePagination } from './data-table-pagination'

export type {
  DataTableProps,
  DataTableFilter,
  BulkAction,
  PaginationState,
  FilterOption,
} from './types'
