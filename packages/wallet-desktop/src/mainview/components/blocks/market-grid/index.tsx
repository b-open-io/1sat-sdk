"use client"

import { MarketGridUI } from "./market-grid-ui"
import {
  useMarketGrid,
  type MarketListing,
  type SortDirection,
  type SortField,
  type UseMarketGridOptions,
  type UseMarketGridReturn,
} from "./use-market-grid"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { ListingCardUI, type ListingCardUIProps } from "./listing-card-ui"
export { MarketGridUI, type MarketGridUIProps } from "./market-grid-ui"
export {
  useMarketGrid,
  type MarketListing,
  type OneSatTxo,
  type SortDirection,
  type SortField,
  type UseMarketGridOptions,
  type UseMarketGridReturn,
} from "./use-market-grid"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketGridProps {
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
  /** Callback when "Buy" is clicked on a listing */
  onBuy: (outpoint: string, price: number) => void
  /** Callback when a listing card is clicked (navigation) */
  onListingClick?: (outpoint: string) => void
  /** Number of skeleton cards to show during loading */
  skeletonCount?: number
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * A responsive grid of ordinal NFT listings from the global orderbook.
 *
 * Fetches active OrdLock listings from the 1sat-stack API and renders each
 * as a card with ORDFS thumbnail, price badge, seller avatar, and buy action.
 * Supports pagination, loading skeletons, error recovery, and empty states.
 *
 * @example
 * ```tsx
 * import { MarketGrid } from "@/components/blocks/market-grid"
 *
 * <MarketGrid
 *   onBuy={(outpoint, price) => {
 *     console.log(`Buy ${outpoint} for ${price} sats`)
 *   }}
 *   onListingClick={(outpoint) => {
 *     router.push(`/ordinal/${outpoint}`)
 *   }}
 * />
 * ```
 */
export function MarketGrid({
  apiUrl,
  pageSize,
  sortBy,
  sortDir,
  contentTypeFilter,
  onBuy,
  onListingClick,
  skeletonCount,
  className,
}: MarketGridProps) {
  const grid = useMarketGrid({
    apiUrl,
    pageSize,
    sortBy,
    sortDir,
    contentTypeFilter,
  })

  return (
    <MarketGridUI
      listings={grid.listings}
      isLoading={grid.isLoading}
      isLoadingMore={grid.isLoadingMore}
      error={grid.error}
      hasMore={grid.hasMore}
      onLoadMore={grid.loadMore}
      onRefresh={grid.refresh}
      onBuy={onBuy}
      onListingClick={onListingClick}
      skeletonCount={skeletonCount}
      className={className}
    />
  )
}
