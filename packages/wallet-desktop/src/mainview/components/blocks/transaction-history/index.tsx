"use client"

import { TransactionHistoryUI } from "./transaction-history-ui"
import {
  useTransactionHistory,
  type HistoryEntry,
  type UseTransactionHistoryOptions,
} from "./use-transaction-history"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  TransactionHistoryUI,
  type TransactionHistoryUIProps,
} from "./transaction-history-ui"
export {
  useTransactionHistory,
  type UseTransactionHistoryOptions,
  type UseTransactionHistoryReturn,
  type HistoryEntry,
  type TransactionStatus,
} from "./use-transaction-history"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the composed TransactionHistory block */
export interface TransactionHistoryProps {
  /** BSV payment address to fetch transaction history for */
  address?: string | null
  /** Pre-loaded transaction entries (bypasses API fetch) */
  entries?: HistoryEntry[]
  /** Custom API base URL (default: https://api.1sat.app) */
  apiUrl?: string
  /** Number of entries per page (default: 20) */
  pageSize?: number
  /** Whether to auto-fetch on mount (default: true) */
  autoFetch?: boolean
  /** Callback when a row is clicked */
  onRowClick?: (txid: string) => void
  /** Callback for external link button */
  onExternalLink?: (url: string) => void
  /** Callback fired on successful fetch */
  onSuccess?: (entries: HistoryEntry[]) => void
  /** Callback fired on fetch error */
  onError?: (error: Error) => void
  /** Visual variant: "default" shows full details, "compact" shows description + amount only */
  variant?: "default" | "compact"
  /** Number of skeleton rows to show while loading (default: 5) */
  skeletonCount?: number
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * Transaction history list with status indicators, amounts, and relative
 * dates. Displays inbound/outbound transactions with pagination support.
 *
 * Composes the `useTransactionHistory` hook with the `TransactionHistoryUI`
 * presentation component. Pass `entries` to use pre-loaded data, or
 * `address` to fetch from the 1sat-stack API.
 *
 * @example
 * ```tsx
 * import { TransactionHistory } from "@/components/blocks/transaction-history"
 *
 * function WalletActivity() {
 *   return (
 *     <TransactionHistory
 *       address="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
 *       onRowClick={(txid) => console.log("Clicked:", txid)}
 *     />
 *   )
 * }
 * ```
 */
export function TransactionHistory({
  address,
  entries: externalEntries,
  apiUrl,
  pageSize,
  autoFetch,
  onRowClick,
  onExternalLink,
  onSuccess,
  onError,
  variant,
  skeletonCount,
  className,
}: TransactionHistoryProps) {
  const hookOptions: UseTransactionHistoryOptions = {
    address,
    entries: externalEntries,
    apiUrl,
    pageSize,
    autoFetch,
    onSuccess,
    onError,
  }

  const { entries, isLoading, error, hasMore, loadMore } =
    useTransactionHistory(hookOptions)

  return (
    <TransactionHistoryUI
      entries={entries}
      isLoading={isLoading}
      error={error}
      hasMore={hasMore}
      onLoadMore={loadMore}
      onRowClick={onRowClick}
      onExternalLink={onExternalLink}
      variant={variant}
      skeletonCount={skeletonCount}
      className={className}
    />
  )
}
