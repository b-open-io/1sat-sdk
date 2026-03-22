import { useCallback, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PurchaseOrdinalParams {
  /** Outpoint of the listing to purchase */
  outpoint: string
  /** Marketplace address for fees (optional) */
  marketplaceAddress?: string
  /** Marketplace fee rate 0-1 (optional) */
  marketplaceRate?: number
}

export interface PurchaseOrdinalResult {
  /** Transaction ID of the purchase */
  txid?: string
  /** Raw transaction hex */
  rawtx?: string
  /** Error message if purchase failed */
  error?: string
}

export interface UseBuyListingOptions {
  /** Outpoint of the listing (txid.vout format) */
  outpoint: string
  /** Price in satoshis */
  price: number
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
}

export interface UseBuyListingReturn {
  /** Whether a purchase is in progress */
  isPurchasing: boolean
  /** Purchase result */
  result: PurchaseOrdinalResult | null
  /** Error message */
  error: string | null
  /** Whether the thumbnail image failed to load */
  imgError: boolean
  /** Mark the thumbnail as failed */
  setImgError: (failed: boolean) => void
  /** Marketplace fee in satoshis */
  marketFee: number
  /** Total cost in satoshis (price + marketplace fee) */
  totalCost: number
  /** Execute the purchase */
  handlePurchase: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBuyListing({
  outpoint,
  price,
  onPurchase,
  onPurchased,
  onError,
  marketplaceAddress,
  marketplaceRate,
}: UseBuyListingOptions): UseBuyListingReturn {
  const [isPurchasing, setIsPurchasing] = useState(false)
  const [result, setResult] = useState<PurchaseOrdinalResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)

  const marketFee =
    marketplaceAddress && marketplaceRate
      ? Math.ceil(price * marketplaceRate)
      : 0
  const totalCost = price + marketFee

  const handlePurchase = useCallback(async () => {
    setIsPurchasing(true)
    setError(null)
    setResult(null)

    try {
      const purchaseResult = await onPurchase({
        outpoint,
        marketplaceAddress,
        marketplaceRate,
      })

      if (purchaseResult.error) {
        setError(purchaseResult.error)
        onError?.(new Error(purchaseResult.error))
      } else {
        setResult(purchaseResult)
        onPurchased?.(purchaseResult)
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Purchase failed"
      setError(msg)
      onError?.(err instanceof Error ? err : new Error(msg))
    } finally {
      setIsPurchasing(false)
    }
  }, [
    outpoint,
    marketplaceAddress,
    marketplaceRate,
    onPurchase,
    onPurchased,
    onError,
  ])

  return {
    isPurchasing,
    result,
    error,
    imgError,
    setImgError,
    marketFee,
    totalCost,
    handlePurchase,
  }
}
