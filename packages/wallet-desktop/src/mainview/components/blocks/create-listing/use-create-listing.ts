import { ORDLOCK_LISTING_CREATE_DISABLED } from '@1sat/types'
import { useCallback, useMemo, useState } from 'react'

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
	onError,
	defaultPayAddress = '',
}: UseCreateListingOptions): UseCreateListingReturn {
	const [open, setOpen] = useState(false)
	const [priceInput, setPriceInput] = useState('')
	const [payAddress, setPayAddress] = useState(defaultPayAddress)
	const [result, setResult] = useState<ListOrdinalResult | null>(null)
	const [error, setError] = useState<string | null>(null)

	const priceSats = useMemo(() => {
		const parsed = Number.parseInt(priceInput, 10)
		if (Number.isNaN(parsed) || parsed < MIN_PRICE_SATS) return 0
		if (parsed > MAX_PRICE_SATS) return MAX_PRICE_SATS
		return parsed
	}, [priceInput])

	const validationError = ORDLOCK_LISTING_CREATE_DISABLED
	const canSubmit = false
	const isListing = false

	const handleList = useCallback(async () => {
		setError(ORDLOCK_LISTING_CREATE_DISABLED)
		onError?.(new Error(ORDLOCK_LISTING_CREATE_DISABLED))
	}, [onError])

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			setOpen(nextOpen)
			if (!nextOpen) {
				setPriceInput('')
				setPayAddress(defaultPayAddress)
				setResult(null)
				setError(null)
			}
		},
		[defaultPayAddress],
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
