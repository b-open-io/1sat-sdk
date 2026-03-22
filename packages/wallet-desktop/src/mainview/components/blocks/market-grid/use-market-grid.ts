import { useCallback, useEffect, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw TXO record from the 1sat-stack API */
export interface OneSatTxo {
  /** Transaction ID */
  txid: string
  /** Output index */
  vout: number
  /** Outpoint in "txid.vout" format */
  outpoint: string
  /** Satoshi value of the output */
  satoshis: number
  /** Locking script hex */
  script: string
  /** Content type from inscription */
  type?: string
  /** Origin outpoint for the inscription */
  origin?: string
  /** MAP metadata */
  MAP?: Record<string, string>
  /** Listing price from ordlock decode (sats) */
  price?: number
  /** Seller address decoded from ordlock */
  seller?: string
  /** BMAP metadata name */
  name?: string
}

/** Normalized listing for display */
export interface MarketListing {
  /** Outpoint of the listing (txid.vout) */
  outpoint: string
  /** Listing price in satoshis */
  price: number
  /** Seller address (base58check) */
  seller: string
  /** Content type (MIME type) */
  contentType: string
  /** Origin outpoint for ORDFS thumbnail */
  origin: string
  /** Optional name from MAP metadata */
  name: string | null
}

export type SortField = "price" | "recent"
export type SortDirection = "asc" | "desc"

export interface UseMarketGridOptions {
  /** Base URL of the 1sat-stack API */
  apiUrl?: string
  /** Number of listings per page */
  pageSize?: number
  /** Sort field */
  sortBy?: SortField
  /** Sort direction */
  sortDir?: SortDirection
  /** Optional content type filter (e.g. "image/png") */
  contentTypeFilter?: string
}

export interface UseMarketGridReturn {
  /** Currently loaded listings */
  listings: MarketListing[]
  /** Whether the initial load is in progress */
  isLoading: boolean
  /** Whether a subsequent page is loading */
  isLoadingMore: boolean
  /** Error from the most recent fetch */
  error: string | null
  /** Whether there are more pages to load */
  hasMore: boolean
  /** Load the next page */
  loadMore: () => void
  /** Re-fetch from the beginning */
  refresh: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://api.1sat.app"
const DEFAULT_PAGE_SIZE = 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeTxo(txo: OneSatTxo): MarketListing | null {
  const price = txo.price ?? 0
  if (price <= 0) return null

  return {
    outpoint: txo.outpoint ?? `${txo.txid}.${txo.vout}`,
    price,
    seller: txo.seller ?? "",
    contentType: txo.type ?? "application/octet-stream",
    origin: txo.origin ?? txo.outpoint ?? `${txo.txid}.${txo.vout}`,
    name: txo.name ?? txo.MAP?.name ?? null,
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMarketGrid({
  apiUrl = DEFAULT_API_URL,
  pageSize = DEFAULT_PAGE_SIZE,
  sortBy = "recent",
  sortDir = "desc",
  contentTypeFilter,
}: UseMarketGridOptions = {}): UseMarketGridReturn {
  const [listings, setListings] = useState<MarketListing[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const offsetRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const fetchPage = useCallback(
    async (offset: number, signal: AbortSignal): Promise<MarketListing[]> => {
      const params = new URLSearchParams({
        tags: "ordlock",
        unspent: "true",
        limit: String(pageSize),
        offset: String(offset),
      })

      if (contentTypeFilter) {
        params.set("type", contentTypeFilter)
      }

      if (sortBy === "price") {
        params.set("sort", "price")
        params.set("dir", sortDir)
      }

      const url = `${apiUrl}/1sat/txo/search?${params.toString()}`

      const response = await fetch(url, { signal })

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`)
      }

      const data: OneSatTxo[] = await response.json()

      const normalized: MarketListing[] = []
      for (const txo of data) {
        const listing = normalizeTxo(txo)
        if (listing) normalized.push(listing)
      }

      return normalized
    },
    [apiUrl, pageSize, sortBy, sortDir, contentTypeFilter],
  )

  const loadInitial = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)
    setListings([])
    offsetRef.current = 0

    try {
      const page = await fetchPage(0, controller.signal)
      setListings(page)
      offsetRef.current = page.length
      setHasMore(page.length >= pageSize)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      const msg = err instanceof Error ? err.message : "Failed to load listings"
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [fetchPage, pageSize])

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoadingMore(true)
    setError(null)

    try {
      const page = await fetchPage(offsetRef.current, controller.signal)
      setListings((prev) => [...prev, ...page])
      offsetRef.current += page.length
      setHasMore(page.length >= pageSize)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      const msg = err instanceof Error ? err.message : "Failed to load more listings"
      setError(msg)
    } finally {
      setIsLoadingMore(false)
    }
  }, [fetchPage, pageSize, isLoadingMore, hasMore])

  // Load on mount and when fetch params change
  useEffect(() => {
    loadInitial()

    return () => {
      abortRef.current?.abort()
    }
  }, [loadInitial])

  return {
    listings,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh: loadInitial,
  }
}
