import { useCallback, useEffect, useMemo, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Token standard */
export type TokenType = "BSV20" | "BSV21"

/** Protocol filter for token queries */
export type TokenProtocol = "bsv20" | "bsv21" | "all"

/** A single fungible token holding */
export interface TokenHolding {
  /** Token contract/inscription ID */
  tokenId: string
  /** Token symbol or ticker */
  symbol: string
  /** Token type standard */
  type: TokenType
  /** Raw balance as a string (before decimal adjustment) */
  balance: string
  /** Decimal precision for the token */
  decimals: number
  /** ORDFS URL for the token icon (nullable). Pre-populated values skip ORDFS lookup. */
  iconUrl: string | null
}

/** Shape returned from the 1sat API for a BSV21 token */
interface Bsv21TokenResponse {
  id: string
  sym: string
  icon: string | null
  dec: number
  amt: string
}

/** Shape returned from the 1sat API for a BSV20 token */
interface Bsv20TokenResponse {
  tick: string
  dec: number
  amt: string
  icon?: string | null
}

/** Shape returned from the balance endpoint */
interface TokenBalanceResponse {
  confirmed: string
  pending: string
}

export interface UseTokenListOptions {
  /** BSV payment address to fetch token holdings for */
  address: string | null
  /** Token IDs to fetch. When provided, only these tokens are fetched. */
  tokenIds?: string[]
  /** Pre-populated token holdings (skips API fetch for tokens with matching IDs) */
  tokens?: TokenHolding[]
  /** Custom API base URL (default: https://api.1sat.app) */
  apiUrl?: string
  /** ORDFS base URL for icon resolution (default: https://ordfs.network) */
  ordfsBase?: string
  /** Filter by protocol type (default: "all") */
  protocol?: TokenProtocol
  /** Whether to auto-fetch on mount / address change (default: true) */
  autoFetch?: boolean
}

export interface UseTokenListReturn {
  /** List of token holdings */
  tokens: TokenHolding[]
  /** Whether the initial fetch is in progress */
  isLoading: boolean
  /** Error from the last fetch attempt */
  error: Error | null
  /** Manually trigger a refetch */
  refetch: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://api.1sat.app"
const DEFAULT_ORDFS_BASE = "https://ordfs.network"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ordfsIconUrl(tokenId: string, ordfsBase: string): string {
  return `${ordfsBase}/${tokenId}`
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
 * Fetches BSV20/BSV21 fungible token holdings for a given address.
 *
 * When `tokenIds` are provided, fetches details and balances for those
 * specific tokens. Otherwise the caller should provide a pre-populated list
 * or rely on wallet integration that surfaces token IDs.
 *
 * @example
 * ```ts
 * const { tokens, isLoading, error, refetch } = useTokenList({
 *   address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
 *   tokenIds: ["abc123_0", "def456_0"],
 * })
 * ```
 */
export function useTokenList(
  options: UseTokenListOptions
): UseTokenListReturn {
  const {
    address,
    tokenIds,
    tokens: prePopulated,
    apiUrl = DEFAULT_API_URL,
    ordfsBase = DEFAULT_ORDFS_BASE,
    protocol = "all",
    autoFetch = true,
  } = options

  const [tokens, setTokens] = useState<TokenHolding[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Stable stringified token ID list for dependency tracking
  const tokenIdKey = useMemo(
    () => (tokenIds ? tokenIds.slice().sort().join(",") : ""),
    [tokenIds]
  )

  // Build a lookup map from pre-populated tokens for fast access
  const prePopulatedMap = useMemo(() => {
    if (!prePopulated) return null
    const map = new Map<string, TokenHolding>()
    for (const t of prePopulated) {
      map.set(t.tokenId, t)
    }
    return map
  }, [prePopulated])

  const fetchTokens = useCallback(async () => {
    if (!address || !tokenIds || tokenIds.length === 0) {
      setTokens([])
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const holdings: TokenHolding[] = await Promise.all(
        tokenIds.map(async (id) => {
          // If a pre-populated holding exists with this ID, use it directly
          const existing = prePopulatedMap?.get(id)
          if (existing) {
            return existing
          }

          // Try BSV21 first, then BSV20
          let symbol = id.slice(0, 8)
          let tokenType: TokenType = "BSV21"
          let decimals = 0
          let hasIcon = false
          let balanceEndpoint = `${apiUrl}/1sat/bsv21/${id}/p2pkh/${address}/balance`

          try {
            const detail = await fetchJson<Bsv21TokenResponse>(
              `${apiUrl}/1sat/bsv21/${id}`,
              controller.signal
            )
            symbol = detail.sym || id.slice(0, 8)
            tokenType = "BSV21"
            decimals = detail.dec ?? 0
            hasIcon = !!detail.icon
          } catch {
            // BSV21 lookup failed, try BSV20
            try {
              const detail20 = await fetchJson<Bsv20TokenResponse>(
                `${apiUrl}/1sat/bsv20/${id}`,
                controller.signal
              )
              symbol = detail20.tick || id.slice(0, 8)
              tokenType = "BSV20"
              decimals = detail20.dec ?? 0
              hasIcon = !!detail20.icon
              balanceEndpoint = `${apiUrl}/1sat/bsv20/${id}/p2pkh/${address}/balance`
            } catch {
              // Neither endpoint found; keep defaults
            }
          }

          // Fetch balance for this token + address
          let balance = "0"
          try {
            const balanceData = await fetchJson<TokenBalanceResponse>(
              balanceEndpoint,
              controller.signal
            )
            // Combine confirmed + pending
            const confirmed = BigInt(balanceData.confirmed || "0")
            const pending = BigInt(balanceData.pending || "0")
            balance = (confirmed + pending).toString()
          } catch {
            // Balance endpoint may 404 if no holdings; that is OK
            balance = "0"
          }

          return {
            tokenId: id,
            symbol,
            type: tokenType,
            balance,
            decimals,
            iconUrl: hasIcon ? ordfsIconUrl(id, ordfsBase) : null,
          }
        })
      )

      // Apply protocol filter
      const filtered =
        protocol === "all"
          ? holdings
          : holdings.filter(
              (h) => h.type.toLowerCase() === protocol
            )

      setTokens(filtered)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      const fetchError =
        err instanceof Error ? err : new Error("Failed to fetch tokens")
      setError(fetchError)
      setTokens([])
    } finally {
      setIsLoading(false)
    }
  }, [address, tokenIdKey, apiUrl, ordfsBase, protocol, prePopulatedMap])

  // Auto-fetch on mount / dependency change
  useEffect(() => {
    if (autoFetch && address && tokenIds && tokenIds.length > 0) {
      void fetchTokens()
    }

    return () => {
      abortRef.current?.abort()
    }
  }, [autoFetch, fetchTokens, address, tokenIdKey])

  return {
    tokens,
    isLoading,
    error,
    refetch: fetchTokens,
  }
}
