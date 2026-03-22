"use client"

import { AlertCircle, Loader2, RefreshCw, Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { ListingCardUI } from "./listing-card-ui"
import type { MarketListing } from "./use-market-grid"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketGridUIProps {
  /** Listings to display */
  listings: MarketListing[]
  /** Whether the initial load is in progress */
  isLoading: boolean
  /** Whether more listings are loading */
  isLoadingMore: boolean
  /** Error message from the most recent fetch */
  error: string | null
  /** Whether there are more listings to load */
  hasMore: boolean
  /** Load next page */
  onLoadMore: () => void
  /** Re-fetch listings from the beginning */
  onRefresh: () => void
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
// Constants
// ---------------------------------------------------------------------------

const ORDFS_CONTENT_URL = "https://ordfs.network/content"

// ---------------------------------------------------------------------------
// Skeleton grid
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-square w-full" />
      <CardContent className="flex flex-col gap-2 p-3 pb-2">
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-3 w-20" />
        </div>
      </CardContent>
      <CardFooter className="p-3 pt-0">
        <Skeleton className="h-8 w-full" />
      </CardFooter>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MarketGridUI({
  listings,
  isLoading,
  isLoadingMore,
  error,
  hasMore,
  onLoadMore,
  onRefresh,
  onBuy,
  onListingClick,
  skeletonCount = 8,
  className,
}: MarketGridUIProps) {
  // Loading state: grid of skeletons
  if (isLoading) {
    return (
      <div className={cn("flex flex-col gap-6", className)}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: skeletonCount }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  // Error state (no listings loaded)
  if (error && listings.length === 0) {
    return (
      <div className={cn("flex flex-col gap-6", className)}>
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-10">
          <AlertCircle className="size-10 text-destructive" />
          <div className="flex flex-col gap-1 text-center">
            <p className="text-sm font-medium">Failed to load listings</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} className="gap-2">
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  // Empty state
  if (listings.length === 0) {
    return (
      <div className={cn("flex flex-col gap-6", className)}>
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-10">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
            <Store className="size-6 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1 text-center">
            <p className="text-sm font-medium">No listings found</p>
            <p className="text-xs text-muted-foreground">
              There are no ordinals listed for sale right now. Check back later.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} className="gap-2">
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
        </div>
      </div>
    )
  }

  // Grid with listings
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {listings.map((listing) => (
          <ListingCardUI
            key={listing.outpoint}
            outpoint={listing.outpoint}
            price={listing.price}
            seller={listing.seller}
            contentType={listing.contentType}
            thumbnailUrl={`${ORDFS_CONTENT_URL}/${listing.origin}`}
            name={listing.name}
            onBuy={onBuy}
            onListingClick={onListingClick}
          />
        ))}
      </div>

      {/* Inline error after partial load */}
      {error && listings.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="gap-2"
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" />
                Loading...
              </>
            ) : (
              "Load More"
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
