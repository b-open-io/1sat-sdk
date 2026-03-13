import type { ClientOptions, IndexedOutput } from '@1sat/types'
import { BaseClient } from './BaseClient'

export interface ListingSearchOptions {
	/** Listing status: active, sale, cancel (default: active) */
	status?: string
	/** Content type filter */
	type?: string
	/** Name search prefix */
	q?: string
	/** Results limit (default: 20) */
	limit?: number
	/** Pagination score */
	from?: number
	/** Reverse order (default: true) */
	rev?: boolean
}

/**
 * Client for /1sat/market/* routes.
 * Provides marketplace listing queries.
 *
 * Routes:
 * - GET /listings - Search listings
 * - GET /listing/:outpoint - Get listing by outpoint
 * - GET /origin/:origin - Get active listing by origin
 * - POST /origins - Bulk lookup active listings by origin
 */
export class MarketClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/market`, options)
	}

	/**
	 * Search marketplace listings.
	 */
	async searchListings(opts?: ListingSearchOptions): Promise<IndexedOutput[]> {
		const qs = this.buildQueryString({
			status: opts?.status,
			type: opts?.type,
			q: opts?.q,
			limit: opts?.limit,
			from: opts?.from,
			rev: opts?.rev,
		})
		return this.request<IndexedOutput[]>(`/listings${qs}`)
	}

	/**
	 * Get a single listing by outpoint.
	 */
	async getListing(outpoint: string): Promise<IndexedOutput> {
		return this.request<IndexedOutput>(`/listing/${outpoint}`)
	}

	/**
	 * Get the active listing for an origin.
	 */
	async getListingByOrigin(origin: string): Promise<IndexedOutput> {
		return this.request<IndexedOutput>(`/origin/${origin}`)
	}

	/**
	 * Bulk lookup active listings by origin outpoints.
	 * @param origins - Array of origin outpoint strings
	 */
	async getListingsByOrigins(
		origins: string[],
	): Promise<Record<string, IndexedOutput>> {
		return this.request<Record<string, IndexedOutput>>('/origins', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(origins),
		})
	}
}
