import { useCallback, useEffect, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Transaction status */
export type TransactionStatus = "completed" | "unproven" | "sending" | "failed"

/** A single transaction history entry */
export interface HistoryEntry {
  /** Transaction ID */
  txid: string
  /** Human-readable description */
  description: string
  /** Amount in satoshis (positive = inbound, negative = outbound) */
  satoshis: number
  /** Current transaction status */
  status: TransactionStatus
  /** ISO-8601 date string */
  dateCreated: string
}

/** Shape returned from the 1sat-stack transaction endpoint */
interface TxHistoryApiEntry {
  txid: string
  description: string
  satoshis: number
  status: string
  dateCreated: string
}

/** Shape returned from the 1sat-stack history list endpoint */
interface TxHistoryApiResponse {
  entries: TxHistoryApiEntry[]
  hasMore: boolean
}

/** Options for the useTransactionHistory hook */
export interface UseTransactionHistoryOptions {
  /** BSV payment address to fetch transaction history for */
  address?: string | null
  /** Pre-loaded entries (bypasses API fetch when provided) */
  entries?: HistoryEntry[]
  /** Custom API base URL (default: https://api.1sat.app) */
  apiUrl?: string
  /** Number of entries per page (default: 20) */
  pageSize?: number
  /** Whether to auto-fetch on mount (default: true) */
  autoFetch?: boolean
  /** Callback fired on successful fetch */
  onSuccess?: (entries: HistoryEntry[]) => void
  /** Callback fired on fetch error */
  onError?: (error: Error) => void
}

/** Return value of the useTransactionHistory hook */
export interface UseTransactionHistoryReturn {
  /** List of transaction history entries */
  entries: HistoryEntry[]
  /** Whether the initial fetch is in progress */
  isLoading: boolean
  /** Error from the last fetch attempt */
  error: Error | null
  /** Whether more entries can be loaded */
  hasMore: boolean
  /** Load the next page of entries */
  loadMore: () => void
  /** Manually trigger a refetch from the beginning */
  refetch: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://api.1sat.app"
const DEFAULT_PAGE_SIZE = 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseStatus(raw: string): TransactionStatus {
  switch (raw) {
    case "completed":
    case "unproven":
    case "sending":
    case "failed":
      return raw
    default:
      return "unproven"
  }
}

function mapApiEntry(entry: TxHistoryApiEntry): HistoryEntry {
  return {
    txid: entry.txid,
    description: entry.description,
    satoshis: entry.satoshis,
    status: parseStatus(entry.status),
    dateCreated: entry.dateCreated,
  }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetches transaction history for a BSV address from the 1sat-stack API,
 * or accepts pre-loaded entries via the `entries` prop.
 *
 * Supports pagination with `loadMore` and manual `refetch`.
 *
 * @example
 * ```ts
 * const { entries, isLoading, error, hasMore, loadMore } = useTransactionHistory({
 *   address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
 * })
 * ```
 */
export function useTransactionHistory(
  options: UseTransactionHistoryOptions = {}
): UseTransactionHistoryReturn {
  const {
    address,
    entries: externalEntries,
    apiUrl = DEFAULT_API_URL,
    pageSize = DEFAULT_PAGE_SIZE,
    autoFetch = true,
    onSuccess,
    onError,
  } = options

  const [entries, setEntries] = useState<HistoryEntry[]>(externalEntries ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  // Sync external entries when they change
  useEffect(() => {
    if (externalEntries) {
      setEntries(externalEntries)
      setHasMore(false)
      setError(null)
    }
  }, [externalEntries])

  const fetchPage = useCallback(
    async (pageOffset: number, append: boolean) => {
      if (!address) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setIsLoading(true)
      setError(null)

      try {
        const data = await fetchJson<TxHistoryApiResponse>(
          `${apiUrl}/1sat/owner/${address}/tx-history?limit=${pageSize}&offset=${pageOffset}`,
          controller.signal
        )

        const mapped = data.entries.map(mapApiEntry)
        setEntries((prev) => (append ? [...prev, ...mapped] : mapped))
        setHasMore(data.hasMore)
        setOffset(pageOffset + mapped.length)
        onSuccess?.(mapped)
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        const fetchError =
          err instanceof Error
            ? err
            : new Error("Failed to fetch transaction history")
        setError(fetchError)
        onError?.(fetchError)
      } finally {
        setIsLoading(false)
      }
    },
    [address, apiUrl, pageSize, onSuccess, onError]
  )

  const refetch = useCallback(() => {
    setOffset(0)
    setEntries([])
    void fetchPage(0, false)
  }, [fetchPage])

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      void fetchPage(offset, true)
    }
  }, [isLoading, hasMore, offset, fetchPage])

  // Auto-fetch on mount / address change (only when no external entries)
  useEffect(() => {
    if (autoFetch && address && !externalEntries) {
      setOffset(0)
      void fetchPage(0, false)
    }

    return () => {
      abortRef.current?.abort()
    }
  }, [autoFetch, address, externalEntries, fetchPage])

  return {
    entries,
    isLoading,
    error,
    hasMore,
    loadMore,
    refetch,
  }
}
