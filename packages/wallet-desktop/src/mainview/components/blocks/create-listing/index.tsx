import type { VariantProps } from 'class-variance-authority'
import { CreateListingUI, type createListingTriggerVariants } from './ui'
import {
	type ListOrdinalParams,
	type ListOrdinalResult,
	type OrdinalItem,
	useCreateListing,
} from './use-create-listing'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
	CreateListingUI,
	createListingTriggerVariants,
	type CreateListingUIProps,
} from './ui'
export {
	useCreateListing,
	type OrdinalItem,
	type ListOrdinalParams,
	type ListOrdinalResult,
	type UseCreateListingReturn,
	type UseCreateListingOptions,
} from './use-create-listing'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateListingProps
	extends VariantProps<typeof createListingTriggerVariants> {
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
	/** Text for the trigger button */
	triggerLabel?: string
	/** Optional CSS class name */
	className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * A dialog-based ordinal listing component for selling NFTs on the global
 * orderbook. Renders a trigger button that opens a dialog with ordinal
 * preview, price input, payout address, and confirm action.
 *
 * @example
 * ```tsx
 * import { CreateListing } from "@/components/blocks/create-listing"
 *
 * <CreateListing
 *   ordinal={{ outpoint: "abc...def.0", name: "My NFT" }}
 *   onList={async (params) => {
 *     return await listOrdinal.execute(ctx, {
 *       ordinal: walletOutput,
 *       price: params.price,
 *       payAddress: params.payAddress,
 *     })
 *   }}
 *   defaultPayAddress="1A1z..."
 * />
 * ```
 */
export function CreateListing({
	ordinal,
	onList,
	onListed,
	onError,
	defaultPayAddress = '',
	triggerLabel = 'List for Sale',
	variant = 'default',
	className,
}: CreateListingProps) {
	const hook = useCreateListing({
		ordinal,
		onList,
		onListed,
		onError,
		defaultPayAddress,
	})

	return (
		<CreateListingUI
			ordinal={ordinal}
			triggerLabel={triggerLabel}
			variant={variant}
			className={className}
			open={hook.open}
			onOpenChange={hook.handleOpenChange}
			priceInput={hook.priceInput}
			onPriceInputChange={hook.setPriceInput}
			payAddress={hook.payAddress}
			onPayAddressChange={hook.setPayAddress}
			isListing={hook.isListing}
			result={hook.result}
			error={hook.error}
			priceSats={hook.priceSats}
			validationError={hook.validationError}
			canSubmit={hook.canSubmit}
			onList={hook.handleList}
		/>
	)
}
