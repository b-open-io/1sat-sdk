"use client"

import { createContext, useContext } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Balance breakdown for a Bitcoin address */
export interface BigBlocksBalance {
  /** Confirmed satoshis */
  confirmed: number
  /** Unconfirmed satoshis */
  unconfirmed: number
  /** Total satoshis (confirmed + unconfirmed) */
  total: number
}

/** An ordinal output owned by an address */
export interface BigBlocksOrdinal {
  /** Transaction outpoint (txid_vout) */
  outpoint: string
  /** MIME content type of the inscription */
  contentType?: string
  /** Human-readable name or label */
  name?: string
  /** Origin outpoint of the inscription */
  origin?: string
}

/** A fungible token balance for an address */
export interface BigBlocksTokenBalance {
  /** Token identifier (deploy txid) */
  tokenId: string
  /** Token ticker symbol */
  symbol: string
  /** Token protocol type (e.g. "bsv21") */
  type: string
  /** Token balance as a decimal string */
  balance: string
  /** Number of decimal places */
  decimals: number
}

/** A transaction history entry */
export interface BigBlocksHistoryEntry {
  /** Transaction ID */
  txid: string
  /** Human-readable description */
  description: string
  /** Amount in satoshis (positive = incoming, negative = outgoing) */
  satoshis: number
  /** Transaction status (e.g. "confirmed", "pending") */
  status: string
  /** ISO 8601 date string */
  dateCreated: string
}

/** Custom data fetcher for balance queries */
export type GetBalanceFn = (
  address: string
) => Promise<BigBlocksBalance>

/** Custom data fetcher for ordinal queries */
export type GetOrdinalsFn = (
  address: string,
  limit?: number
) => Promise<BigBlocksOrdinal[]>

/** Custom data fetcher for token balance queries */
export type GetTokenBalancesFn = (
  address: string
) => Promise<BigBlocksTokenBalance[]>

/** Custom data fetcher for transaction history queries */
export type GetHistoryFn = (
  address: string,
  limit?: number
) => Promise<BigBlocksHistoryEntry[]>

/** Handler for opening external links (useful in desktop apps) */
export type OnExternalLinkFn = (url: string) => void

/** Context value provided by BigBlocksProvider */
export interface BigBlocksContextValue {
  /** 1sat-stack API base URL */
  apiUrl: string
  /** ORDFS base URL for resolving on-chain images */
  ordfsUrl: string
  /** Custom balance fetcher — when set, hooks use this instead of the API */
  getBalance?: GetBalanceFn
  /** Custom ordinals fetcher — when set, hooks use this instead of the API */
  getOrdinals?: GetOrdinalsFn
  /** Custom token balance fetcher — when set, hooks use this instead of the API */
  getTokenBalances?: GetTokenBalancesFn
  /** Custom history fetcher — when set, hooks use this instead of the API */
  getHistory?: GetHistoryFn
  /** External link handler for desktop apps or custom navigation */
  onExternalLink?: OnExternalLinkFn
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default 1sat-stack API base URL */
export const DEFAULT_API_URL = "https://api.1sat.app/1sat"

/** Default ORDFS base URL for on-chain image resolution */
export const DEFAULT_ORDFS_URL = "https://ordfs.network"

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const BigBlocksContext = createContext<BigBlocksContextValue | null>(null)

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the BigBlocks configuration context.
 *
 * Must be called inside a `<BigBlocksProvider>`. Returns the context value
 * containing API URLs and optional custom data fetchers.
 *
 * @example
 * ```ts
 * const { apiUrl, ordfsUrl, getBalance } = useBigBlocks()
 *
 * // Fetch balance using custom fetcher or fall back to API
 * if (getBalance) {
 *   const balance = await getBalance(address)
 * } else {
 *   const res = await fetch(`${apiUrl}/owner/${address}/balance`)
 * }
 * ```
 *
 * @throws {Error} When called outside of BigBlocksProvider
 */
export function useBigBlocks(): BigBlocksContextValue {
  const ctx = useContext(BigBlocksContext)
  if (!ctx) {
    throw new Error(
      "useBigBlocks must be used within a <BigBlocksProvider>. " +
        "Wrap your component tree with <BigBlocksProvider> to provide configuration context."
    )
  }
  return ctx
}
