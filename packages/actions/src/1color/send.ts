/**
 * 1Color (BRC-162) send to a BRC-169 handle through the wallet's BRC-207
 * `color` module, delivered per BRC-232.
 *
 * 1. Resolve the handle (`resolveHandle`): identity key + messagebox.
 * 2. Derive the recipient's key under `colorProtocolID(assetId, prefix,
 *    suffix)` (fresh random base64 prefix and suffix), keyID `color`,
 *    counterparty = the recipient, and build the 1Color value output.
 * 3. One `createAction` with that single output, the BRC-207 plan (assets
 *    `[assetId]`, no owned outputs, one `transfer`) plus the BRC-177 label
 *    `p nosend expiry seconds <n>`, `noSend` and `randomizeOutputs: false`:
 *    the handoff. The module selects the token inputs, splits to the exact
 *    amount when it has to, signs and asks for consent. The action is not
 *    broadcast; the recipient submits it. The action keeps what the delivery
 *    is made from: its description names the handle, and the label
 *    `1color send <prefix hex> <suffix hex>` carries the key derivation, so
 *    a send whose delivery never happened can be rebuilt from the wallet.
 * 4. Delivery: a signed BRC-169 envelope to the resolved messagebox, box
 *    `transaction-delivery`, `payment: null`, whose encrypted content is the
 *    BRC-232 MIME entity with one `basket insertion` receipt into
 *    `p color <assetTag>`.
 *
 * When delivery fails the result carries the error with `txid` and `tx`, so
 * the caller can retry delivery or `abortAction` the send.
 */

import { OneColor } from '@1sat/templates'
import {
	COLOR_SEND_EXPIRY_SECONDS,
	TRANSACTION_DELIVERY_BOX,
} from '@1sat/types'
import { Beef, Utils } from '@bsv/sdk'
import { sendEnvelope } from '../metanet/deliver.js'
import type { Action } from '../types.js'
import { newColorCustody, resolveColorRecipient } from './custody.js'
import { colorDeliveryMime, derivationHex } from './delivery.js'
import { INVALID_ASSET_ID, colorPlanLabels, isColorAssetId } from './plan.js'

/**
 * Label prefix of the send's key derivation: `1color send <prefix hex>
 * <suffix hex>`, the bytes of the base64 derivation prefix and suffix.
 */
export const COLOR_SEND_LABEL_PREFIX = '1color send '

export interface Send1ColorInput {
	/** The asset id, `<txid>_<vout>` */
	assetId: string
	/** Amount in raw units */
	amount: bigint | string
	/** BRC-169 handle: `@handle@domain` or `handle@domain` */
	destination: { handle: string }
	/**
	 * BRC-177 `nosend expiry seconds` for the handoff (default
	 * {@link COLOR_SEND_EXPIRY_SECONDS}, one year).
	 */
	expirySeconds?: number
	/** Optional free text carried as the BRC-232 `memo` */
	memo?: string
}

export interface Send1ColorResult {
	txid?: string
	/** Atomic BEEF of the send */
	tx?: number[]
	/** `envelope`: BRC-169 envelope to the handle's messagebox, not broadcast */
	delivered?: 'envelope'
	/** Messagebox message id */
	messageId?: string
	error?: string
}

export const send1Color: Action<Send1ColorInput, Send1ColorResult> = {
	meta: {
		name: 'send1Color',
		description:
			"Send 1Color (BRC-162) tokens to a BRC-169 handle: a BRC-177 handoff built by the wallet's BRC-207 color module, delivered (BRC-232) in a signed envelope to the handle's transaction-delivery box; the recipient submits it",
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
					description: 'Amount in raw units (string for bigint)',
				},
				destination: {
					type: 'object',
					description: '{ handle } — a BRC-169 handle (@handle@domain)',
				},
				expirySeconds: {
					type: 'integer',
					description:
						'BRC-177 nosend expiry in seconds (default 31536000, one year)',
				},
				memo: {
					type: 'string',
					description: 'Optional memo carried in the delivery',
				},
			},
			required: ['assetId', 'amount', 'destination'],
		},
	},

	async execute(ctx, input) {
		try {
			const { assetId } = input
			if (!isColorAssetId(assetId)) return { error: INVALID_ASSET_ID }
			const amount = BigInt(input.amount)
			if (amount <= 0n) return { error: 'amount-must-be-positive' }

			// 1-2. Resolve the handle; the recipient's output is locked to the key
			// they derive from this custody.
			const custody = await newColorCustody(ctx, assetId)
			const recipient = await resolveColorRecipient(
				ctx,
				custody,
				input.destination.handle,
			)
			const { senderIdentityKey } = custody
			const lockingScript = OneColor.value(assetId, amount, {
				lock: recipient.lock,
			})
				.lock()
				.toHex()

			// The delivery body, checked (memo bound, receipt) before the handoff
			// exists, so a bad memo leaves no noSend action behind.
			const delivery = (txid: number[], beef: number[]) =>
				colorDeliveryMime({
					txid,
					beef,
					outputs: [{ outputIndex: 0, role: 'value', custody }],
					senderIdentityKey,
					...(input.memo !== undefined && { memo: input.memo }),
				})
			delivery(new Array(32).fill(0), [])

			// 3. The handoff; the module funds, splits and signs.
			const expiry = input.expirySeconds ?? COLOR_SEND_EXPIRY_SECONDS
			const result = await ctx.wallet.createAction({
				description: `Send ${amount} 1Color tokens to ${recipient.handle}`,
				outputs: [
					{ lockingScript, satoshis: 1, outputDescription: '1Color tokens' },
				],
				labels: [
					...colorPlanLabels({
						assetId,
						operations: ['transfer'],
						ownedOutputs: [],
					}),
					`${COLOR_SEND_LABEL_PREFIX}${derivationHex(custody.derivationPrefix)} ${derivationHex(custody.derivationSuffix)}`,
					`p nosend expiry seconds ${expiry}`,
				],
				options: { noSend: true, randomizeOutputs: false },
			})
			if (!result.txid || !result.tx) return { error: 'no-transaction' }
			const txid = result.txid
			const tx = Array.from(result.tx)

			// 4. Deliver.
			try {
				const plaintext = delivery(
					Utils.toArray(txid, 'hex'),
					Beef.fromBinary(tx).toBinary(),
				)
				const sent = await sendEnvelope(ctx.wallet, recipient.resolution, {
					senderIdentityKey,
					plaintext: Array.from(plaintext),
					payment: null,
					messageBox: TRANSACTION_DELIVERY_BOX,
				})
				return { txid, tx, delivered: 'envelope', messageId: sent.messageId }
			} catch (error) {
				// The send exists as a noSend action: return it so the caller can
				// retry delivery or abortAction it.
				return {
					txid,
					tx,
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
