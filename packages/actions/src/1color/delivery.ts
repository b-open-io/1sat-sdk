/**
 * Delivering a broadcast 1Color transaction to its recipient: the BRC-232 MIME
 * entity and its BRC-169 envelope to the handle's `transaction-delivery` box.
 *
 * A 1Color action that names a handle as its destination broadcasts its
 * transaction itself: the module submits it to the asset's overlay as it signs,
 * which is what completes a token action. The delivery is not a BRC-177 handoff
 * (that is `send1Color`, whose recipient submits and whose outputs the sender
 * must not see beforehand); it hands over a transaction that is already
 * settled, with one `basket insertion` receipt per output the recipient gets,
 * each carrying that output's custody so their module can derive its key and
 * file it in its own basket.
 */

import type { HandleResolution } from '@1sat/client'
import { TRANSACTION_DELIVERY_BOX } from '@1sat/types'
import type { TokenRole } from '@bsv/color-permission-module'
import { assetBasket } from '@bsv/color-permission-module'
import { Utils } from '@bsv/sdk'
import { sendEnvelope } from '../metanet/deliver.js'
import { encodeTransactionDeliveryMime } from '../metanet/delivery.js'
import type { OneSatContext } from '../types.js'
import type { ColorCustody } from './custody.js'
import { colorReceiptInstructions } from './receipt.js'

/** One delivered output: where it is and who can prove it is theirs. */
export interface ColorDeliveryOutput {
	outputIndex: number
	role: TokenRole
	custody: ColorCustody
}

/**
 * The BRC-232 entity for a delivered 1Color transaction. Throws on a memo over
 * 2000 UTF-8 bytes, before any transaction exists.
 */
export function colorDeliveryMime(params: {
	txid: number[]
	beef: number[]
	outputs: ColorDeliveryOutput[]
	senderIdentityKey: string
	memo?: string
}): number[] {
	const { txid, beef, outputs, senderIdentityKey, memo } = params
	return Array.from(
		encodeTransactionDeliveryMime({
			version: 1,
			txid: Uint8Array.from(txid),
			beef: Uint8Array.from(beef),
			outputs: outputs.map(({ outputIndex, role, custody }) => ({
				outputIndex,
				protocol: 'basket insertion' as const,
				insertionRemittance: {
					basket: assetBasket(custody.assetId, role),
					customInstructions: colorReceiptInstructions({
						assetId: custody.assetId,
						derivationPrefix: custody.derivationPrefix,
						derivationSuffix: custody.derivationSuffix,
						senderIdentityKey,
					}),
				},
			})),
			// wallet-toolbox cannot issue BRC-177 lifecycle statements yet.
			lifecycles: [],
			...(memo !== undefined && { memo }),
		}),
	)
}

/** Encrypt and sign `plaintext` to `resolution`'s transaction-delivery box. */
export async function deliverColorTransaction(
	ctx: OneSatContext,
	resolution: HandleResolution,
	plaintext: number[],
): Promise<{ messageId: string }> {
	const { publicKey: senderIdentityKey } = await ctx.wallet.getPublicKey({
		identityKey: true,
	})
	const sent = await sendEnvelope(ctx.wallet, resolution, {
		senderIdentityKey,
		plaintext,
		payment: null,
		messageBox: TRANSACTION_DELIVERY_BOX,
	})
	return { messageId: sent.messageId }
}

/** The hex of a base64 derivation value, for a `1color send`-style label. */
export const derivationHex = (value: string): string =>
	Utils.toHex(Utils.toArray(value, 'base64'))
