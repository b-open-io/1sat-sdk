"use client"

import { type VariantProps } from "class-variance-authority"
import { BuyListingUI, buyListingVariants } from "./ui"
import {
  useBuyListing,
  type PurchaseOrdinalParams,
  type PurchaseOrdinalResult,
  type UseBuyListingReturn,
  type UseBuyListingOptions,
} from "./use-buy-listing"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  BuyListingUI,
  buyListingVariants,
  type BuyListingUIProps,
} from "./ui"
export {
  useBuyListing,
  type PurchaseOrdinalParams,
  type PurchaseOrdinalResult,
  type UseBuyListingReturn,
  type UseBuyListingOptions,
} from "./use-buy-listing"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuyListingProps
  extends VariantProps<typeof buyListingVariants> {
  /** Outpoint of the listing (txid.vout format) */
  outpoint: string
  /** Price in satoshis */
  price: number
  /** Seller display name or address */
  seller?: string
  /** Name of the ordinal */
  name?: string
  /** Content type (MIME type) for the thumbnail */
  contentType?: string
  /** Origin outpoint for thumbnail resolution */
  origin?: string
  /** Callback to execute the purchase action */
  onPurchase: (params: PurchaseOrdinalParams) => Promise<PurchaseOrdinalResult>
  /** Callback on successful purchase */
  onPurchased?: (result: PurchaseOrdinalResult) => void
  /** Callback on error */
  onError?: (error: Error) => void
  /** Marketplace address for fees */
  marketplaceAddress?: string
  /** Marketplace fee rate 0-1 */
  marketplaceRate?: number
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORDFS_CONTENT_URL = "https://ordfs.network/content"

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * A card component for purchasing ordinal NFTs from the global orderbook.
 *
 * Displays a thumbnail from ORDFS, price, optional seller info, marketplace
 * fee breakdown, and a "Buy Now" action. Uses the `purchaseOrdinal` action
 * from `@1sat/actions` via the `onPurchase` callback.
 *
 * @example
 * ```tsx
 * import { BuyListing } from "@/components/blocks/buy-listing"
 *
 * <BuyListing
 *   outpoint="abc123...def.0"
 *   price={50000}
 *   name="Rare Pepe #42"
 *   seller="1A1z..."
 *   onPurchase={async (params) => {
 *     return await purchaseOrdinal.execute(ctx, params)
 *   }}
 * />
 * ```
 */
export function BuyListing({
  outpoint,
  price,
  seller,
  name,
  contentType,
  origin,
  onPurchase,
  onPurchased,
  onError,
  marketplaceAddress,
  marketplaceRate,
  size = "default",
  className,
}: BuyListingProps) {
  const hook = useBuyListing({
    outpoint,
    price,
    onPurchase,
    onPurchased,
    onError,
    marketplaceAddress,
    marketplaceRate,
  })

  const thumbnailUrl = `${ORDFS_CONTENT_URL}/${origin ?? outpoint}`

  return (
    <BuyListingUI
      size={size}
      className={className}
      name={name}
      seller={seller}
      contentType={contentType}
      price={price}
      thumbnailUrl={thumbnailUrl}
      imgError={hook.imgError}
      onImgError={() => hook.setImgError(true)}
      marketFee={hook.marketFee}
      totalCost={hook.totalCost}
      isPurchasing={hook.isPurchasing}
      result={hook.result}
      error={hook.error}
      onPurchase={hook.handlePurchase}
    />
  )
}
