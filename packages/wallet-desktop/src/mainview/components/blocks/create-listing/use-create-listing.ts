import { useCallback, useMemo, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Represents an ordinal NFT to be listed */
export interface OrdinalItem {
  /** Outpoint in txid.vout format */
  outpoint: string
  /** Display name of the ordinal */
  name?: string
  /** Content type (MIME type) */
  contentType?: string
  /** Origin outpoint for collection grouping */
  origin?: string
}

export interface ListOrdinalParams {
  /** The ordinal to list */
  ordinal: OrdinalItem
  /** Price in satoshis */
  price: number
  /** Address that receives payment on purchase */
  payAddress: string
}

export interface ListOrdinalResult {
  /** Transaction ID of the listing */
  txid?: string
  /** Raw transaction hex */
  rawtx?: string
  /** Error message if listing failed */
  error?: string
}

export interface UseCreateListingOptions {
  /** The ordinal to list for sale */
  ordinal: OrdinalItem
  /** Callback to execute the listing action */
  onList: (params: ListOrdinalParams) => Promise<ListOrdinalResult>
  /** Callback on successful listing */
  onListed?: (result: ListOrdinalResult) => void
  /** Callback on error */
  onError?: (error: Error) => void
  /** Default payout address */
  defaultPayAddress?: string
}

export interface UseCreateListingReturn {
  /** Whether the dialog is open */
  open: boolean
  /** Handle dialog open/close */
  handleOpenChange: (nextOpen: boolean) => void
  /** Current price input string */
  priceInput: string
  /** Set the price input */
  setPriceInput: (value: string) => void
  /** Current payout address */
  payAddress: string
  /** Set the payout address */
  setPayAddress: (value: string) => void
  /** Whether a listing is in progress */
  isListing: boolean
  /** Listing result */
  result: ListOrdinalResult | null
  /** Error message */
  error: string | null
  /** Parsed price in satoshis */
  priceSats: number
  /** Validation error message */
  validationError: string | null
  /** Whether the form can be submitted */
  canSubmit: boolean
  /** Execute the listing */
  handleList: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_PRICE_SATS = 1
const MAX_PRICE_SATS = 2100000000000000

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCreateListing({
  ordinal,
  onList,
  onListed,
  onError,
  defaultPayAddress = "",
}: UseCreateListingOptions): UseCreateListingReturn {
  const [open, setOpen] = useState(false)
  const [priceInput, setPriceInput] = useState("")
  const [payAddress, setPayAddress] = useState(defaultPayAddress)
  const [isListing, setIsListing] = useState(false)
  const [result, setResult] = useState<ListOrdinalResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const priceSats = useMemo(() => {
    const parsed = Number.parseInt(priceInput, 10)
    if (Number.isNaN(parsed) || parsed < MIN_PRICE_SATS) return 0
    if (parsed > MAX_PRICE_SATS) return MAX_PRICE_SATS
    return parsed
  }, [priceInput])

  const validationError = useMemo(() => {
    if (!priceInput) return null
    if (priceSats < MIN_PRICE_SATS) return "Price must be at least 1 satoshi"
    if (priceSats > MAX_PRICE_SATS) return "Price exceeds maximum"
    if (!payAddress.trim()) return "Payout address is required"
    return null
  }, [priceInput, priceSats, payAddress])

  const canSubmit =
    priceSats >= MIN_PRICE_SATS &&
    payAddress.trim().length > 0 &&
    !validationError

  const handleList = useCallback(async () => {
    if (!canSubmit) return

    setIsListing(true)
    setError(null)
    setResult(null)

    try {
      const listResult = await onList({
        ordinal,
        price: priceSats,
        payAddress: payAddress.trim(),
      })

      if (listResult.error) {
        setError(listResult.error)
        onError?.(new Error(listResult.error))
      } else {
        setResult(listResult)
        onListed?.(listResult)
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to create listing"
      setError(msg)
      onError?.(err instanceof Error ? err : new Error(msg))
    } finally {
      setIsListing(false)
    }
  }, [canSubmit, ordinal, priceSats, payAddress, onList, onListed, onError])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isListing) {
        setOpen(nextOpen)
        if (!nextOpen) {
          // Reset form state on close
          setPriceInput("")
          setPayAddress(defaultPayAddress)
          setResult(null)
          setError(null)
        }
      }
    },
    [isListing, defaultPayAddress],
  )

  return {
    open,
    handleOpenChange,
    priceInput,
    setPriceInput,
    payAddress,
    setPayAddress,
    isListing,
    result,
    error,
    priceSats,
    validationError,
    canSubmit,
    handleList,
  }
}
