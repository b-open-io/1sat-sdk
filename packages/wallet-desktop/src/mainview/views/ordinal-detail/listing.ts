import type { OrdinalInfo } from '../../../shared/types.js'

export interface OrdLockListing {
	outpoint: string
	priceSats?: number
	origin: string
}

/** MarketClient /market/origin returns one IndexedOutput, with data.ordlock. */
export function parseListing(raw: unknown): OrdLockListing | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
	const output = raw as {
		outpoint?: unknown
		spend?: unknown
		data?: {
			ordlock?: { price?: unknown; origin?: unknown; spend_type?: unknown }
		}
	}
	const listing = output.data?.ordlock
	if (
		typeof output.outpoint !== 'string' ||
		!listing ||
		output.spend ||
		listing.spend_type
	)
		return null
	return {
		outpoint: output.outpoint,
		origin:
			typeof listing.origin === 'string' ? listing.origin : output.outpoint,
		priceSats:
			typeof listing.price === 'number' &&
			Number.isSafeInteger(listing.price) &&
			listing.price >= 0
				? listing.price
				: undefined,
	}
}

/** Wallet tags determine owner cancellation availability, independently of price or indexer availability. */
export function ownedListing(output: OrdinalInfo): OrdLockListing | null {
	if (!output.tags.includes('ordlock')) return null
	const price = output.tags.find((tag) => tag.startsWith('price:'))?.slice(6)
	const value = price === undefined ? undefined : Number(price)
	return {
		outpoint: output.outpoint,
		origin:
			output.tags.find((tag) => tag.startsWith('origin:'))?.slice(7) ??
			output.outpoint,
		priceSats:
			value !== undefined && Number.isSafeInteger(value) && value >= 0
				? value
				: undefined,
	}
}
