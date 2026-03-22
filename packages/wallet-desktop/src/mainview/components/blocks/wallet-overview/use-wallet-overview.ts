import { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "@1sat/react"
import { loadConnection } from "@1sat/connect"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Balance breakdown returned by the 1sat-stack API */
export interface WalletBalance {
  /** Confirmed satoshis */
  confirmed: number
  /** Unconfirmed satoshis */
  unconfirmed: number
  /** Total satoshis (confirmed + unconfirmed) */
  total: number
}

export interface UseWalletOverviewReturn {
  /** Balance breakdown in satoshis, null while loading or disconnected */
  balance: WalletBalance | null
  /** BSV payment address, null when disconnected */
  paymentAddress: string | null
  /** Ordinal receiving address, null when disconnected */
  ordinalAddress: string | null
  /** Identity public key, null when disconnected */
  identityKey: string | null
  /** Whether balance is being fetched */
  isLoading: boolean
  /** Error from the last balance fetch */
  error: Error | null
  /** Manually refetch the balance */
  refetch: () => void
}

/** Shape returned from the 1sat-stack balance endpoint */
interface BalanceApiResponse {
  confirmed: number
  unconfirmed: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://api.1sat.app"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchBalance(
  address: string,
  signal: AbortSignal,
  apiUrl: string
): Promise<WalletBalance> {
  const res = await fetch(
    `${apiUrl}/1sat/owner/${address}/balance`,
    { signal }
  )
  if (!res.ok) {
    throw new Error(`Balance fetch failed: HTTP ${res.status}`)
  }
  const data: BalanceApiResponse = await res.json()
  return {
    confirmed: data.confirmed,
    unconfirmed: data.unconfirmed,
    total: data.confirmed + data.unconfirmed,
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetches wallet addresses from `@1sat/connect` stored connection and
 * balance from the 1sat-stack API. Must be rendered inside `WalletProvider`.
 *
 * @example
 * ```ts
 * const { balance, paymentAddress, ordinalAddress, identityKey, isLoading } =
 *   useWalletOverview()
 * ```
 */
export function useWalletOverview(): UseWalletOverviewReturn {
  const { status, identityKey } = useWallet()
  const [balance, setBalance] = useState<WalletBalance | null>(null)
  const [paymentAddress, setPaymentAddress] = useState<string | null>(null)
  const [ordinalAddress, setOrdinalAddress] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Resolve addresses from the stored connection when connected
  useEffect(() => {
    if (status === "connected") {
      const stored = loadConnection()
      setPaymentAddress(stored?.paymentAddress ?? null)
      setOrdinalAddress(stored?.ordinalAddress ?? null)
    } else {
      setPaymentAddress(null)
      setOrdinalAddress(null)
      setBalance(null)
      setError(null)
    }
  }, [status])

  const doFetch = useCallback(async () => {
    if (!paymentAddress) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchBalance(
        paymentAddress,
        controller.signal,
        DEFAULT_API_URL
      )
      setBalance(result)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      const fetchError =
        err instanceof Error ? err : new Error("Failed to fetch balance")
      setError(fetchError)
      setBalance(null)
    } finally {
      setIsLoading(false)
    }
  }, [paymentAddress])

  // Auto-fetch balance when payment address becomes available
  useEffect(() => {
    if (paymentAddress) {
      void doFetch()
    }
    return () => {
      abortRef.current?.abort()
    }
  }, [paymentAddress, doFetch])

  return {
    balance,
    paymentAddress,
    ordinalAddress,
    identityKey,
    isLoading,
    error,
    refetch: doFetch,
  }
}
