/**
 * Read a 1Color token's minting authorities in this wallet.
 *
 * A page needs this before it shows a Token Manager at all: an authority
 * deploy (amount 0) leaves the creator holding the minting capability, and
 * only that output lets them `mint1Color` or `endAuthority1Color`. This reads
 * the asset's authority basket through the wallet's BRC-207 module, so the
 * answer is what this wallet holds — not what exists on chain. It includes the
 * deploy output itself when the deploy was an authority deploy, since that
 * output *is* the token's first authority.
 *
 * `spendableThroughModule: false` marks an output the module will not spend
 * (filed without its derivation suffix tag); `mint1Color` will not select it
 * and `endAuthority1Color` with `all` refuses it, so a page can say so before
 * it asks anyone to sign.
 *
 * The asset's value balance comes along because every Token Manager page that
 * asks for the authorities also shows what they can still create, and reading
 * it is otherwise one more hand-rolled basket read per page.
 */

import type { Action } from '../types.js'
import { listColorHoldings } from './listing.js'
import { INVALID_ASSET_ID, isColorAssetId } from './plan.js'

export interface Authorities1ColorInput {
	/** The asset id, `<txid>_<vout>` */
	assetId: string
}

export interface Authorities1ColorResult {
	/** How many authority outputs this wallet holds */
	count?: number
	outputs?: Array<{
		/** `<txid>.<vout>` */
		outpoint: string
		satoshis: number
		/** False while a pending action holds it */
		spendable: boolean
		/** False when the color module will not spend it */
		spendableThroughModule: boolean
	}>
	/** The asset's value balance, in raw units, so a page can show both */
	valueBalance?: string
	error?: string
}

export const authorities1Color: Action<
	Authorities1ColorInput,
	Authorities1ColorResult
> = {
	meta: {
		name: 'authorities1Color',
		description:
			"This wallet's unspent 1Color (BRC-162) authority outputs for an asset, read through the wallet's BRC-207 color module, with its value balance: what `mint1Color` and `endAuthority1Color` can act on",
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				assetId: {
					type: 'string',
					description: 'The asset id, <txid>_<vout>',
				},
			},
			required: ['assetId'],
		},
	},
	async execute(ctx, input) {
		try {
			const { assetId } = input
			if (!isColorAssetId(assetId)) return { error: INVALID_ASSET_ID }
			const authorities = await listColorHoldings(ctx, assetId, 'authority')
			const value = await listColorHoldings(ctx, assetId, 'value')
			return {
				count: authorities.outputs.length,
				outputs: authorities.outputs.map((hold) => ({
					outpoint: hold.outpoint,
					satoshis: hold.satoshis,
					spendable: hold.spendable,
					spendableThroughModule: hold.spendableThroughModule,
				})),
				valueBalance: value.outputs
					.reduce((total, hold) => total + hold.amount, 0n)
					.toString(),
			}
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			}
		}
	},
}
