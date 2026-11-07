/**
 * 1Color (BRC-162) authority operations through the wallet's BRC-207 `color`
 * module: hand the minting capability to someone else, or end it.
 *
 * BRC-162 makes the authority an output like any other, holding no units:
 * whoever holds it can mint. A transaction spends authorities and creates
 * authorities, and BRC-207 names what that did:
 *
 * - one in, one out to another holder: `authority-transfer`;
 * - any number in, none out: `authority-end`.
 *
 * `transferAuthority1Color` builds the first: one authority output locked to
 * the recipient's `p color` key, and no authority output of our own — the
 * module selects exactly one of our authorities for it. The transaction goes to
 * the overlay like any token action, and the recipient gets it (BRC-232) in
 * their handle's `transaction-delivery` box, since they did not build it; the
 * label `1color authority <prefix hex> <suffix hex>` keeps the derivation a
 * failed delivery would need.
 *
 * `endAuthority1Color` builds the second: the authority inputs are spent with no
 * authority output, so no authority exists anywhere after it. That is the
 * lock-supply commitment — BRC-162 minting ends only when no authority output
 * remains — so `all` spends every authority this wallet holds in one
 * transaction, which is the only version of the claim a token page can advertise.
 * The wallet holding more than one authority is unusual (it comes from a split);
 * without `all`, the module ends one of them.
 */

import { OneColor } from '@1sat/templates'
import type { CreateActionInput, CreateActionOutput } from '@bsv/sdk'
import { Beef, Utils } from '@bsv/sdk'
import type { Action } from '../types.js'
import { newColorCustody, resolveColorRecipient } from './custody.js'
import {
	colorDeliveryMime,
	deliverColorTransaction,
	derivationHex,
} from './delivery.js'
import { listColorHoldings, sourceBeef } from './listing.js'
import {
	INVALID_ASSET_ID,
	colorPlanLabels,
	isColorAssetId,
	noAuthority,
} from './plan.js'

/** Label of the transfer's delivery derivation: `1color authority <prefix hex> <suffix hex>`. */
export const COLOR_AUTHORITY_LABEL_PREFIX = '1color authority '

/** BRC-207 token inputs sign with P2PKH; the module sizes them the same way. */
const TOKEN_INPUT_UNLOCK_LENGTH = 108

export interface EndAuthority1ColorInput {
	/** The asset id, `<txid>_<vout>` */
	assetId: string
	/** Spend every authority this wallet holds, not just one */
	all?: boolean
}

export interface EndAuthority1ColorResult {
	txid?: string
	/** AtomicBEEF of the transaction that ended the authority */
	tx?: number[]
	assetId?: string
	/** Authorities this transaction spent */
	authorityOutputs?: number
	/** Authorities this wallet held before it, so a page can say "1 of 3 ended" */
	authorityOutputsHeld?: number
	error?: string
}

export const endAuthority1Color: Action<
	EndAuthority1ColorInput,
	EndAuthority1ColorResult
> = {
	meta: {
		name: 'endAuthority1Color',
		description:
			"End a 1Color (BRC-162) token's minting authority through the wallet's BRC-207 color module: the authority inputs are spent with no authority output, so no supply can ever be minted again",
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				assetId: {
					type: 'string',
					description: 'The asset id, <txid>_<vout>',
				},
				all: {
					type: 'boolean',
					description:
						'Spend every authority output this wallet holds (default: one, which leaves any others mintable)',
				},
			},
			required: ['assetId'],
		},
	},

	async execute(ctx, input) {
		try {
			const { assetId } = input
			if (!isColorAssetId(assetId)) return { error: INVALID_ASSET_ID }

			// Read first: the page wants the error before it asks anyone to sign,
			// and `all` has to name the inputs it is spending.
			const listing = await listColorHoldings(ctx, assetId, 'authority', {
				sources: input.all === true,
			})
			const held = listing.outputs.filter((hold) => hold.spendable)
			if (held.length === 0) return { error: noAuthority(assetId) }
			const untagged = held.find((hold) => !hold.spendableThroughModule)
			if (untagged !== undefined) {
				return {
					error: `authority-without-suffix-tag: ${untagged.outpoint} was filed without its derivation suffix tag and the color module cannot spend it`,
				}
			}

			let inputs: CreateActionInput[] | undefined
			let inputBEEF: number[] | undefined
			let authorityOutputs = 1
			if (input.all === true) {
				// Named inputs, so the module selects none: BRC-207 reads
				// any number of authority inputs with no authority output as
				// `authority-end` either way.
				inputs = held.map((hold) => ({
					outpoint: hold.outpoint,
					unlockingScriptLength: TOKEN_INPUT_UNLOCK_LENGTH,
					inputDescription: '1Color minting authority',
				}))
				inputBEEF = sourceBeef(
					listing,
					held.map((hold) => hold.outpoint),
				)
				authorityOutputs = held.length
			}

			const created = await ctx.wallet.createAction({
				description:
					authorityOutputs === 1
						? `End 1Color authority ${assetId}`
						: `End ${authorityOutputs} 1Color authorities`,
				...(inputs === undefined ? {} : { inputs }),
				...(inputBEEF === undefined ? {} : { inputBEEF }),
				outputs: [],
				labels: colorPlanLabels({
					assetId,
					operations: ['authority-end'],
					ownedOutputs: [],
				}),
				options: { randomizeOutputs: false },
			})
			if (!created.txid || !created.tx) return { error: 'no-transaction' }
			return {
				txid: created.txid,
				tx: Array.from(created.tx),
				assetId,
				authorityOutputs,
				authorityOutputsHeld: held.length,
			}
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			}
		}
	},
}

export interface TransferAuthority1ColorInput {
	/** The asset id, `<txid>_<vout>`; the wallet must hold its authority */
	assetId: string
	/** BRC-169 handle of the new holder: `@handle@domain` */
	destination: { handle: string }
	/** Optional free text carried as the BRC-232 `memo` of the delivery */
	memo?: string
}

export interface TransferAuthority1ColorResult {
	txid?: string
	/** AtomicBEEF of the transfer */
	tx?: number[]
	assetId?: string
	/** `envelope`: delivered to the handle's messagebox, not broadcast */
	delivered?: 'envelope'
	messageId?: string
	error?: string
}

export const transferAuthority1Color: Action<
	TransferAuthority1ColorInput,
	TransferAuthority1ColorResult
> = {
	meta: {
		name: 'transferAuthority1Color',
		description:
			"Hand a 1Color (BRC-162) token's minting authority to a BRC-169 handle through the wallet's BRC-207 color module, delivered (BRC-232) in a signed envelope to the handle's transaction-delivery box",
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				assetId: {
					type: 'string',
					description: 'The asset id, <txid>_<vout>',
				},
				destination: {
					type: 'object',
					description: '{ handle } — a BRC-169 handle: @handle@domain',
				},
				memo: {
					type: 'string',
					description: 'Optional memo carried in the delivery',
				},
			},
			required: ['assetId', 'destination'],
		},
	},

	async execute(ctx, input) {
		try {
			const { assetId } = input
			if (!isColorAssetId(assetId)) return { error: INVALID_ASSET_ID }
			const held = await listColorHoldings(ctx, assetId, 'authority')
			if (!held.outputs.some((hold) => hold.spendable)) {
				return { error: noAuthority(assetId) }
			}

			// One authority in, one out to them: `authority-transfer`, which the
			// module funds with exactly one authority input from the basket.
			const custody = await newColorCustody(ctx, assetId)
			const recipient = await resolveColorRecipient(
				ctx,
				custody,
				input.destination.handle,
			)
			const outputs: CreateActionOutput[] = [
				{
					lockingScript: OneColor.authority(assetId, { lock: recipient.lock })
						.lock()
						.toHex(),
					satoshis: 1,
					outputDescription: '1Color minting authority',
				},
			]

			const senderIdentityKey = custody.senderIdentityKey
			const delivery = (txid: number[], beef: number[]) =>
				colorDeliveryMime({
					txid,
					beef,
					outputs: [{ outputIndex: 0, role: 'authority', custody }],
					senderIdentityKey,
					...(input.memo !== undefined && { memo: input.memo }),
				})
			// Check the memo before the authority moves, so a bad memo moves nothing.
			delivery(new Array(32).fill(0), [])

			const created = await ctx.wallet.createAction({
				description: `Transfer 1Color authority ${assetId} to ${recipient.handle}`,
				outputs,
				labels: [
					...colorPlanLabels({
						assetId,
						operations: ['authority-transfer'],
						ownedOutputs: [],
					}),
					`${COLOR_AUTHORITY_LABEL_PREFIX}${derivationHex(custody.derivationPrefix)} ${derivationHex(custody.derivationSuffix)}`,
				],
				options: { randomizeOutputs: false },
			})
			if (!created.txid || !created.tx) return { error: 'no-transaction' }
			const txid = created.txid
			const tx = Array.from(created.tx)

			try {
				const plaintext = delivery(
					Utils.toArray(txid, 'hex'),
					Beef.fromBinary(tx).toBinary(),
				)
				const { messageId } = await deliverColorTransaction(
					ctx,
					recipient.resolution,
					Array.from(plaintext),
				)
				return { txid, tx, assetId, delivered: 'envelope', messageId }
			} catch (error) {
				// The authority has moved and the overlay knows; only the
				// recipient's copy of it is owed.
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
