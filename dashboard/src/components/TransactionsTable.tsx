import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { TableVirtuoso, type TableVirtuosoHandle } from 'react-virtuoso'
import { useTransactionStore } from '../stores/transactionStore'
import { trackFeatureFlagEvaluation, useFeatureFlagStore } from '../stores/featureFlagStore'
import { Transaction } from '../services/api'
import { TransactionTableSkeleton } from './TransactionTableSkeleton'
import { TransactionSearch, matchesSearch, HighlightMatch } from './TransactionSearch'
import { DateRangePicker, DateRange, matchesDateRange } from './DateRangePicker'
import { StatusFilter, TransactionStatus, matchesStatus } from './StatusFilter'
import '../styles/TransactionsTable.css'

interface SortState {
  column: keyof Transaction | null
  direction: 'asc' | 'desc'
}

interface PreviewState {
  transaction: Transaction
  position: TransactionPreviewPosition
}

const VirtualizedTable = React.forwardRef<
  HTMLTableElement,
  React.ComponentProps<'table'>
>(({ style, ...props }, ref) => (
  <table
    {...props}
    ref={ref}
    className="transactions-table"
    style={{ ...style, borderCollapse: 'separate', borderSpacing: 0 }}
  />
))

VirtualizedTable.displayName = 'VirtualizedTable'

const virtuosoComponents = { Table: VirtualizedTable }

const previewForRow = (
  row: HTMLTableRowElement
): TransactionPreviewPosition => {
  const rect = row.getBoundingClientRect()
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
  const previewWidth = Math.min(310, Math.max(240, viewportWidth - 32))
  const left = Math.min(
    Math.max(8, rect.left),
    Math.max(8, viewportWidth - previewWidth - 8)
  )
  const estimatedHeight = 250
  const below = rect.bottom + 8
  const top =
    below + estimatedHeight > viewportHeight
      ? Math.max(8, rect.top - estimatedHeight - 8)
      : below

  return { top, left }
}

/** #722 — Match a transaction against the selected provider set. */
const matchesProviders = (
  tx: Transaction,
  providers: Provider[]
): boolean => {
  if (providers.length === 0) return true
  return providers.some((provider) => provider === tx.provider)
}

export const TransactionsTable: React.FC<{
  onRowClick: (tx: Transaction) => void
}> = ({ onRowClick }) => {
  const { transactions, loading, error, fetchTransactions } = useTransactionStore()

  const [sort, setSort] = useState<SortState>({ column: null, direction: 'asc' })
  const [preview, setPreview] = useState<PreviewState | null>(null)
  /** #495 — Multi-select provider filter state (persisted in component state) */
  const [selectedProviders, setSelectedProviders] = useState<Provider[]>([])
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggered = useRef(false)
  const skipInitialFetch = useRef(!loadOnMount)

  // ── Filter state ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>({
    preset: 'all',
    startDate: '',
    endDate: '',
  })
  const [selectedStatuses, setSelectedStatuses] = useState<TransactionStatus[]>([])

  // ── Fetch on mount — pass empty filters so store defaults are preserved ─────
  // App.tsx also calls fetchTransactions; we avoid a double fetch by relying on
  // the store's loading flag.  If the store already has data, skip the call.
  useEffect(() => {
    if (transactions.length === 0) {
      fetchTransactions({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTransactions])

  // ── Sorting ─────────────────────────────────────────────────────────────────
  const handleSort = (column: keyof Transaction) => {
    setSort((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  // ── Filter callbacks (stable references via useCallback) ────────────────────
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query)
  }, [])

  const handleDateRange = useCallback((range: DateRange) => {
    setDateRange(range)
  }, [])

  const handleStatusChange = useCallback((statuses: TransactionStatus[]) => {
    setSelectedStatuses(statuses)
  }, [])

  // ── Provider selection — reset paging when the provider set changes ─────────
  const handleProviderChange = useCallback((providers: Provider[]) => {
    setSelectedProviders(providers)
    setActiveRowIndex(0)
    virtuosoRef.current?.scrollToIndex({ index: 0, align: 'start' })
  }, [])

  // ── Composed filtering + sorting (AND logic) ─────────────────────────────────
  const filteredAndSorted = useMemo(() => {
    const filtered = (transactions ?? []).filter(
      (tx) =>
        matchesSearch(tx, searchQuery) &&
        matchesDateRange(tx, dateRange) &&
        matchesStatus(tx, selectedStatuses) &&
        matchesProviders(tx, selectedProviders)
    )

    if (!sort.column) return filtered

    return [...filtered].sort((a, b) => {
      const col = sort.column as keyof Transaction
      const aVal = a[col]
      const bVal = b[col]
      if (aVal === bVal) return 0
      const result =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal))
      return sort.direction === 'asc' ? result : -result
    })
  }, [transactions, searchQuery, dateRange, selectedStatuses, selectedProviders, sort])

  const totalCount = (transactions ?? []).length
  const visibleCount = filteredAndSorted.length

  // ── SortHeader sub-component ─────────────────────────────────────────────────
  const SortHeader: React.FC<{
    column: keyof Transaction
    label: string
  }> = ({ column, label }) => {
    const direction = sort.column === column
      ? sort.direction === 'asc' ? 'ascending' : 'descending'
      : 'none'

    return (
      <th scope="col" aria-sort={direction}>
        <button type="button" onClick={() => handleSort(column)} className="sortable-header">
          <span className="header-content">
            {label}
            {sort.column === column &&
              (sort.direction === 'asc' ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              ))}
          </span>
        </button>
      </th>
    )
  }

  const renderTableHeader = () => (
    <tr>
      <SortHeader column="reference" label="Reference" />
      <SortHeader column="amount" label="Amount" />
      <SortHeader column="status" label="Status" />
      <SortHeader column="provider" label="Provider" />
      <SortHeader column="timestamp" label="Date" />
      <th scope="col">Actions</th>
    </tr>
  )

  const rowCellHandlers = (index: number, tx: Transaction) => ({
    onClick: (event: React.MouseEvent<HTMLTableCellElement>) => {
      if (
        event.target instanceof Element &&
        !event.target.closest('button')
      ) {
        if (longPressTriggered.current) {
          longPressTriggered.current = false
          return
        }
        hidePreview()
        onRowClick(tx)
      }
    },
    onMouseEnter: (event: React.MouseEvent<HTMLTableCellElement>) => {
      const row = event.currentTarget.closest('tr')
      if (row) schedulePreview(tx, row)
    },
    onMouseLeave: (event: React.MouseEvent<HTMLTableCellElement>) => {
      const row = event.currentTarget.closest('tr')
      if (
        !row ||
        !(event.relatedTarget instanceof Node) ||
        !row.contains(event.relatedTarget)
      ) hidePreview()
    },
    onFocus: (event: React.FocusEvent<HTMLTableCellElement>) => {
      setActiveRowIndex(index)
      const row = event.currentTarget.closest('tr')
      if (row) schedulePreview(tx, row)
    },
    onBlur: (event: React.FocusEvent<HTMLTableCellElement>) => {
      const row = event.currentTarget.closest('tr')
      if (
        !row ||
        !(event.relatedTarget instanceof Node) ||
        !row.contains(event.relatedTarget)
      ) hidePreview()
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLTableCellElement>) => handleKeyDown(event, index, tx),
    onTouchStart: (event: React.TouchEvent<HTMLTableCellElement>) => {
      const row = event.currentTarget.closest('tr')
      if (row) handleTouchStart(event, row, tx)
    },
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchEnd,
    onTouchMove: handleTouchEnd,
    onContextMenu: (event: React.MouseEvent<HTMLTableCellElement>) => {
      event.preventDefault()
      hidePreview()
    },
  })

  return (
    <div className="transactions-table-container">
      <div className="transactions-table-toolbar">
        <TransactionSearch value={searchQuery} onChange={handleSearch} />
        <DateRangePicker value={dateRange} onChange={handleDateRange} />
        <StatusFilter value={selectedStatuses} onChange={handleStatusChange} />
        <ProviderFilter value={selectedProviders} onChange={handleProviderChange} />
      </div>
      <div className="transactions-table-summary" aria-live="polite">
        Showing {visibleCount} of {totalCount} transactions
      </div>
      {loading && <TransactionTableSkeleton />}
      {error && <div className="transactions-table-error">{error}</div>}
      {!loading && !error && (
        <TableVirtuoso
          ref={virtuosoRef}
          data={filteredAndSorted}
          components={virtuosoComponents}
          fixedHeaderContent={renderTableHeader}
          itemContent={(index, tx) => (
            <tr
              key={tx.id}
              className={index === activeRowIndex ? 'active-row' : undefined}
            >
              <td {...rowCellHandlers(index, tx)}>{tx.reference}</td>
              <td {...rowCellHandlers(index, tx)}>{formatAmount(tx.amount)}</td>
              <td {...rowCellHandlers(index, tx)}>{tx.status}</td>
              <td {...rowCellHandlers(index, tx)}>{tx.provider}</td>
              <td {...rowCellHandlers(index, tx)}>
                {format(new Date(tx.timestamp), 'yyyy-MM-dd HH:mm')}
              </td>
              <td>
                <button type="button" onClick={() => onRowClick(tx)}>
                  View
                </button>
              </td>
            </tr>
          )}
        />
      )}
      {preview && (
        <TransactionPreview
          transaction={preview.transaction}
          position={preview.position}
        />
      )}
    </div>
  )
}
