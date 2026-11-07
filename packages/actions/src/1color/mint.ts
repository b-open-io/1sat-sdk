/**
 * 1Color (BRC-162) mint through the wallet's BRC-207 `color` module.
 *
 * BRC-162 has no mint output: a mint is a `value` output in a transaction that
 * spends an `authority` of the same token, and minting ends only when no
 * authority output remains. So one `createAction` carries two outputs:
 *
 * 1. output 0, the minted value: `amount` units locked to a fresh `p color` key
 *    of this wallet (the default), or of the holder of a BRC-169 handle given
 *    as `destination`;
 * 2. output 1, the authority, re-locked to a fresh key of this wallet, so the
 *    token stays mintable and the authority never leaves the wallet in the
 *    clear.
 *
 * The plan declares `mint` and `authority-transfer`: the module selects the
 * authority input from the asset's authority basket itself (it needs one
 * authority output in, one out). The module gives a mint no change, which is
 * why the minted amount is exactly what is asked for — a mint creates units, it
 * does not spend a balance.
 *
 * The wallet must hold an authority for the asset; `authorities1Color` reads
 * whether it does.
 *
 * With a handle destination the transaction is delivered (BRC-232) to its
 * `transaction-delivery` box, since the recipient did not build it; the label
 * `1color mint <prefix hex> <suffix hex>` keeps that derivation, so a mint
 * whose delivery failed can be delivered again from the wallet's history.
 */

import type { HandleResolution } from '@1sat/client'
import { OneColor } from '@1sat/templates'
import { Beef, type CreateActionOutput, Utils } from '@bsv/sdk'
import type { Action } from '../types.js'
import {
	colorRemittance,
	newColorCustody,
	resolveColorRecipient,
	selfColorLock,
} from './custody.js'
import {
	colorDeliveryMime,
	deliverColorTransaction,
	derivationHex,
} from './delivery.js'
import { listColorHoldings } from './listing.js'
import {
	INVALID_ASSET_ID,
	colorPlanLabels,
	isColorAssetId,
	noAuthority,
} from './plan.js'

/** Label of the mint's delivery derivation: `1color mint <prefix hex> <suffix hex>`. */
export const COLOR_MINT_LABEL_PREFIX = '1color mint '

export interface Mint1ColorInput {
	/** The asset id, `<txid>_<vout>`; the wallet must hold its authority */
	assetId: string
	/** New units to create, in raw units */
	amount: bigint | string
	/** BRC-169 handle to mint to: `@handle@domain`. Default: this wallet. */
	destination?: { handle: string }
	/** Optional free text carried as the BRC-232 `memo` of the delivery */
	memo?: string
}

export interface Mint1ColorResult {
	txid?: string
	/** AtomicBEEF of the mint */
	tx?: number[]
	assetId?: string
	/** `envelope`: delivered to the handle's messagebox, not broadcast */
	delivered?: 'envelope'
	/** Messagebox message id */
	messageId?: string
	error?: string
}

export const mint1Color: Action<Mint1ColorInput, Mint1ColorResult> = {
	meta: {
		name: 'mint1Color',
		description:
			"Mint new 1Color (BRC-162) supply with the wallet's BRC-207 color module: spends one of the asset's authority outputs, creates `amount` units, and re-locks the authority to a fresh key",
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				assetId: {
					type: 'string',
					description: 'The asset id, <txid>_<vout>',
				},
				amount: {
					type: 'string',
					description: 'New units to create (string for bigint)',
				},
				destination: {
					type: 'object',
					description:
						"{ handle } — a BRC-169 handle to mint to, delivered per BRC-232; omitted, the mint is this wallet's",
				},
				memo: {
					type: 'string',
					description: 'Optional memo carried in the delivery',
				},
			},
			required: ['assetId', 'amount'],
		},
	},

	async execute(ctx, input) {
		try {
			const { assetId } = input
			if (!isColorAssetId(assetId)) return { error: INVALID_ASSET_ID }
			const amount = BigInt(input.amount)
			if (amount <= 0n) return { error: 'amount-must-be-positive' }

			// Read first, as every authority action does: a wallet that holds no
			// authority cannot mint, and it should hear that before it is asked to
			// sign. The module selects the authority input itself, from the same
			// basket, and refuses again if the state moved underneath us.
			const held = await listColorHoldings(ctx, assetId, 'authority')
			if (!held.outputs.some((hold) => hold.spendable)) {
				return { error: noAuthority(assetId) }
			}

			// The minted value: this wallet's own key, or the handle holder's.
			const valueCustody = await newColorCustody(ctx, assetId)
			let valueLock: number[]
			let resolution: HandleResolution | undefined
			let handle: string | undefined
			if (input.destination === undefined) {
				valueLock = await selfColorLock(ctx, valueCustody)
			} else {
				const recipient = await resolveColorRecipient(
					ctx,
					valueCustody,
					input.destination.handle,
				)
				valueLock = recipient.lock
				resolution = recipient.resolution
				handle = recipient.handle
			}

			// The mint keeps minting: the authority, re-locked to a fresh key.
			const authorityCustody = await newColorCustody(ctx, assetId)
			const authorityLock = await selfColorLock(ctx, authorityCustody)

			const outputs: CreateActionOutput[] = [
				{
					lockingScript: OneColor.value(assetId, amount, {
						lock: valueLock,
					})
						.lock()
						.toHex(),
					satoshis: 1,
					outputDescription: 'Minted 1Color tokens',
				},
				{
					lockingScript: OneColor.authority(assetId, {
						lock: authorityLock,
					})
						.lock()
						.toHex(),
					satoshis: 1,
					outputDescription: '1Color minting authority',
				},
			]

			const identityKey = valueCustody.senderIdentityKey
			const delivery = (txid: number[], beef: number[]) =>
				colorDeliveryMime({
					txid,
					beef,
					outputs: [{ outputIndex: 0, role: 'value', custody: valueCustody }],
					senderIdentityKey: identityKey,
					...(input.memo !== undefined && { memo: input.memo }),
				})
			// Check the memo before the mint exists, so a bad memo mints nothing.
			delivery(new Array(32).fill(0), [])

			const created = await ctx.wallet.createAction({
				description:
					handle === undefined
						? `Mint ${amount} 1Color tokens`
						: `Mint ${amount} 1Color tokens to ${handle}`,
				outputs,
				labels: [
					...colorPlanLabels({
						assetId,
						operations: ['mint', 'authority-transfer'],
						ownedOutputs: [
							...(resolution === undefined
								? [colorRemittance(0, valueCustody)]
								: []),
							colorRemittance(1, authorityCustody),
						],
					}),
					...(resolution === undefined
						? []
						: [
								`${COLOR_MINT_LABEL_PREFIX}${derivationHex(valueCustody.derivationPrefix)} ${derivationHex(valueCustody.derivationSuffix)}`,
							]),
				],
				options: { randomizeOutputs: false },
			})
			if (!created.txid || !created.tx) return { error: 'no-transaction' }
			const txid = created.txid
			const tx = Array.from(created.tx)
			if (resolution === undefined) return { txid, tx, assetId }

			try {
				const plaintext = delivery(
					Utils.toArray(txid, 'hex'),
					Beef.fromBinary(tx).toBinary(),
				)
				const { messageId } = await deliverColorTransaction(
					ctx,
					resolution,
					Array.from(plaintext),
				)
				return { txid, tx, assetId, delivered: 'envelope', messageId }
			} catch (error) {
				// The mint is broadcast and submitted; only its receipt is owed.
				return {
					txid,
					tx,
					assetId,
					error: `delivery-failed: ${error instanceof Error ? error.message : String(error)}`,
				}
			}
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			}
		}
	},
}
