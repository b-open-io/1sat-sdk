/**
 * OPL-4696: cancel wallet-owned OrdLock listings back into BRC-100 baskets.
 * Buy and explicit cancel APIs stay available.
 */

import { OPNS_BASKET, ORDINALS_BASKET, readAssetIdTag } from '@1sat/types'
import type { WalletInterface } from '@bsv/sdk'
import { cancelOpnsListing } from '../opns/index.js'
import { cancelOrdinalListing } from '../ordinals/index.js'
import type { Action, ActionOptions, OneSatContext } from '../types.js'

export interface CancelOwnedListingsInput extends ActionOptions {
	/** Stop discovery and further cancellations when the caller closes or changes wallets. */
	signal?: AbortSignal
}

export interface CancelOwnedListingsResult {
	cancelled: number
	txids: string[]
	errors: string[]
}

interface Listing {
	outpoint: string
	id?: string
}

async function discoverBasketListings(
	wallet: WalletInterface,
	basket: string,
	assertActive: () => Promise<void>,
	seenOutpoints: Set<string>,
): Promise<Listing[]> {
	const listings: Listing[] = []
	const ids = new Set<string>()
	let total: number | undefined
	do {
		await assertActive()
		const page = await wallet.listOutputs({
			basket,
			tags: ['ordlock'],
			tagQueryMode: 'any',
			includeTags: true,
			limit:
				total === undefined ? 1000 : Math.min(1000, total - listings.length),
			offset: listings.length,
		})
		await assertActive()
		if (!Number.isSafeInteger(page.totalOutputs) || page.totalOutputs < 0) {
			throw new Error(`${basket}: invalid-listing-total`)
		}
		if (total !== undefined && total !== page.totalOutputs) {
			throw new Error(`${basket}: listing-total-changed; retry discovery`)
		}
		total = page.totalOutputs
		if (!page.outputs.length && listings.length < total) {
			throw new Error(`${basket}: listing-discovery-made-no-progress`)
		}
		if (listings.length + page.outputs.length > total) {
			throw new Error(`${basket}: inconsistent-listing-total`)
		}
		for (const row of page.outputs) {
			if (seenOutpoints.has(row.outpoint)) {
				throw new Error(`${basket}: duplicate-listing-output:${row.outpoint}`)
			}
			const id = readAssetIdTag(row.tags)
			if (id && ids.has(id)) {
				throw new Error(`${basket}: duplicate-listing-id:${id}`)
			}
			seenOutpoints.add(row.outpoint)
			if (id) ids.add(id)
			listings.push({ outpoint: row.outpoint, id })
		}
	} while (listings.length < total)

	return listings
}

/**
 * Cancel every wallet-owned OrdLock listing (1sat + opns baskets).
 * Used on wallet load and as a migration helper. Does not disable buy/cancel.
 */
export const cancelOwnedListings: Action<
	CancelOwnedListingsInput,
	CancelOwnedListingsResult
> = {
	meta: {
		name: 'cancelOwnedListings',
		description:
			'Cancel all wallet-owned OrdLock listings back into the 1sat/opns baskets',
		category: 'ordinals',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx, input) {
		const result: CancelOwnedListingsResult = {
			cancelled: 0,
			txids: [],
			errors: [],
		}
		const { signal, ...options } = input
		const wallet = ctx.wallet
		const capturedContext: OneSatContext = { ...ctx, wallet }
		try {
			signal?.throwIfAborted()
			const { publicKey: identityKey } = await wallet.getPublicKey({
				identityKey: true,
			})
			if (!identityKey) throw new Error('missing-wallet-identity')
			const assertActive = async () => {
				signal?.throwIfAborted()
				if (ctx.wallet !== wallet) throw new Error('wallet-changed')
				const current = await wallet.getPublicKey({ identityKey: true })
				signal?.throwIfAborted()
				if (ctx.wallet !== wallet || current.publicKey !== identityKey) {
					throw new Error('wallet-changed')
				}
			}

			// Snapshot both baskets before cancellations remove rows from paginated queries.
			const baskets = [
				{ basket: ORDINALS_BASKET, action: cancelOrdinalListing },
				{ basket: OPNS_BASKET, action: cancelOpnsListing },
			]
			const pending = []
			const seenOutpoints = new Set<string>()
			for (const { basket, action } of baskets) {
				const listings = await discoverBasketListings(
					wallet,
					basket,
					assertActive,
					seenOutpoints,
				)
				pending.push({ action, listings })
			}
			for (const { action, listings } of pending) {
				for (const { id, outpoint } of listings) {
					await assertActive()
					if (!id) {
						result.errors.push(`${outpoint}: missing-id`)
						continue
					}
					try {
						const cancelled = await action.execute(capturedContext, {
							...options,
							id,
						})
						if (cancelled.error) throw new Error(cancelled.error)
						if (!cancelled.txid?.trim()) throw new Error('missing-txid')
						result.cancelled += 1
						result.txids.push(cancelled.txid)
					} catch (error) {
						result.errors.push(
							`${outpoint}: ${error instanceof Error ? error.message : String(error)}`,
						)
					}
				}
			}
			await assertActive()
		} catch (error) {
			result.errors.push(error instanceof Error ? error.message : String(error))
		}
		return result
	},
}
