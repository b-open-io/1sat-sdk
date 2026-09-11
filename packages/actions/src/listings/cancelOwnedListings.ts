/**
 * OPL-4696: cancel wallet-owned OrdLock listings back into BRC-100 baskets.
 * Buy and explicit cancel APIs stay available.
 */

import { OPNS_BASKET, ORDINALS_BASKET, readAssetIdTag } from '@1sat/types'
import { cancelOpnsListing } from '../opns/index.js'
import { cancelOrdinalListing } from '../ordinals/index.js'
import type { Action, ActionOptions, OneSatContext } from '../types.js'

export interface CancelOwnedListingsInput extends ActionOptions {}

export interface CancelOwnedListingsResult {
	cancelled: number
	txids: string[]
	errors: string[]
}

async function cancelBasketListings(
	ctx: OneSatContext,
	basket: string,
	cancel: (
		ctx: OneSatContext,
		input: { id: string },
	) => Promise<{ txid?: string; error?: string }>,
): Promise<CancelOwnedListingsResult> {
	const listed = await ctx.wallet.listOutputs({
		basket,
		tags: ['ordlock'],
		tagQueryMode: 'any',
		includeTags: true,
		limit: 1000,
	})

	const txids: string[] = []
	const errors: string[] = []
	let cancelled = 0

	for (const row of listed.outputs) {
		const id = readAssetIdTag(row.tags)
		if (!id) {
			errors.push(`${row.outpoint}: missing-id`)
			continue
		}
		const result = await cancel(ctx, { id })
		if (result.error) {
			errors.push(`${row.outpoint}: ${result.error}`)
			continue
		}
		cancelled += 1
		if (result.txid) txids.push(result.txid)
	}

	return { cancelled, txids, errors }
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
	async execute(ctx, _input) {
		const ordinals = await cancelBasketListings(
			ctx,
			ORDINALS_BASKET,
			(c, input) => cancelOrdinalListing.execute(c, input),
		)
		const opns = await cancelBasketListings(ctx, OPNS_BASKET, (c, input) =>
			cancelOpnsListing.execute(c, input),
		)
		return {
			cancelled: ordinals.cancelled + opns.cancelled,
			txids: [...ordinals.txids, ...opns.txids],
			errors: [...ordinals.errors, ...opns.errors],
		}
	},
}
