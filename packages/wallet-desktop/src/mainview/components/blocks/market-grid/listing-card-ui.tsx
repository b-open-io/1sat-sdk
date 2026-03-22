import { useState } from "react"
import { ShoppingCart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListingCardUIProps {
  /** Outpoint of the listing (txid.vout) */
  outpoint: string
  /** Listing price in satoshis */
  price: number
  /** Seller address */
  seller: string
  /** Content type (MIME type) */
  contentType: string
  /** ORDFS thumbnail URL */
  thumbnailUrl: string
  /** Optional ordinal name */
  name: string | null
  /** Click on the "Buy" button */
  onBuy: (outpoint: string, price: number) => void
  /** Click on the card body to navigate */
  onListingClick?: (outpoint: string) => void
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(sats: number): string {
  if (sats >= 100000000) {
    return `${(sats / 100000000).toFixed(8)} BSV`
  }
  if (sats >= 1000000) {
    return `${(sats / 1000000).toFixed(2)}M sats`
  }
  if (sats >= 1000) {
    return `${(sats / 1000).toFixed(1)}K sats`
  }
  return `${sats.toLocaleString()} sats`
}

function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

function sellerInitials(address: string): string {
  if (address.length < 2) return "?"
  return address.slice(0, 2).toUpperCase()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ListingCardUI({
  outpoint,
  price,
  seller,
  contentType,
  thumbnailUrl,
  name,
  onBuy,
  onListingClick,
  className,
}: ListingCardUIProps) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)

  const isImage = contentType.startsWith("image/")

  return (
    <Card
      className={cn(
        "group overflow-hidden transition-shadow hover:shadow-lg",
        onListingClick && "cursor-pointer",
        className,
      )}
      onClick={() => onListingClick?.(outpoint)}
      role={onListingClick ? "button" : undefined}
      tabIndex={onListingClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onListingClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onListingClick(outpoint)
        }
      }}
    >
      {/* Thumbnail */}
      <div className="relative aspect-square overflow-hidden bg-muted">
        {isImage && !imgError ? (
          <>
            {!imgLoaded && (
              <Skeleton className="absolute inset-0 h-full w-full" />
            )}
            <img
              src={thumbnailUrl}
              alt={name ?? "Ordinal listing"}
              className={cn(
                "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105",
                !imgLoaded && "opacity-0",
              )}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div className="text-center text-muted-foreground">
              <ShoppingCart className="mx-auto size-8 opacity-30" />
              <p className="mt-2 text-xs">
                {contentType || "Unknown type"}
              </p>
            </div>
          </div>
        )}

        {/* Price badge overlay */}
        <Badge
          variant="secondary"
          className="absolute bottom-2 right-2 bg-background/90 backdrop-blur-sm"
        >
          {formatPrice(price)}
        </Badge>
      </div>

      <CardContent className="flex flex-col gap-2 p-3 pb-2">
        {/* Name */}
        <h3 className="truncate text-sm font-semibold leading-none">
          {name ?? "Unnamed Ordinal"}
        </h3>

        {/* Seller row */}
        {seller && (
          <div className="flex items-center gap-2">
            <Avatar className="size-5">
              <AvatarFallback className="text-[8px]">
                {sellerInitials(seller)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground">
              {truncateAddress(seller)}
            </span>
          </div>
        )}
      </CardContent>

      <CardFooter className="p-3 pt-0">
        <Button
          className="w-full gap-2"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            onBuy(outpoint, price)
          }}
          aria-label={`Buy ${name ?? "ordinal"} for ${formatPrice(price)}`}
        >
          <ShoppingCart data-icon="inline-start" />
          Buy
        </Button>
      </CardFooter>
    </Card>
  )
}
