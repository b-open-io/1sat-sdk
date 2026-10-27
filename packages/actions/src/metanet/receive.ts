/**
 * Collect the wallet's `transaction-delivery` box: BRC-232 transaction
 * deliveries (1Color tokens, BRC-29 outputs) and BRC-169 payments to a
 * handle.
 *
 * For each message listed (BRC-231 over BRC-104) the shared inbox steps
 * decode the §7.3 DAG-CBOR envelope, verify its §7.2 signature against
 * `sender.identityKey`, decrypt the BRC-78 `content`, check `contentHash`
 * and parse the MIME entity (see `processInbox`). Then:
 *
 * - `payment` set (BRC-169 §6.1): internalize its Atomic BEEF as a BRC-29
 *   `wallet payment` of output 0, remittance `{ derivationPrefix,
 *   derivationSuffix, senderIdentityKey: sender.identityKey }`, label
 *   `metanet payment`, the memo in the description when `content` is
 *   `text/plain`;
 * - `payment` null and `content` a BRC-232 delivery (`contentHash`
 *   required): decode the body strictly. `wallet payment` entries map to
 *   BRC-100 `paymentRemittance`. A `basket insertion` entry must name a
 *   `p color` basket with BRC-207 receipt instructions; its transaction is
 *   first submitted to the asset's topic `tm_color_<assetId>` at `overlay`
 *   (BRC-22), and the STEAK must admit the received output. Then one
 *   `internalizeAction` with every entry copied verbatim.
 *
 * A message is internalized whole or not at all, and acknowledged only after
 * its internalize succeeds. Anything else (a JSON envelope, a bad signature
 * or hash, an unsupported entry or basket, an output the overlay does not
 * admit, a message with nothing to internalize) is left unacknowledged and
 * reported.
 */

import { OverlayClient } from '@1sat/client'
import { BRC29_PROTOCOL_ID, TRANSACTION_DELIVERY_BOX } from '@1sat/types'
import { TRANSACTION_CBOR_CONTENT_TYPE, mediaType } from '@1sat/utils'
import { colorTopic } from '@bsv/color-permission-module'
import {
	Beef,
	type InternalizeOutput,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import { checkColorReceipt } from '../1color/receipt.js'
import type { Action } from '../types.js'
import {
	decodeTransactionDelivery,
	transactionDeliveryBody,
} from './delivery.js'
import type { EnvelopePayment } from './envelope.js'
import { type InboxSkip, InboxSkipError, processInbox } from './inbox.js'

/** Label on internalized handle payments */
export const METANET_PAYMENT_LABEL = 'metanet payment'

export interface SyncTransactionInboxInput {
	/** MessageBox server URL (default: "https://messagebox.1sat.app") */
	messageboxUrl?: string
	/**
	 * Base URL of the BRC-22 overlay that 1Color receipts are submitted to
	 * (`<overlay>/submit`, topic `tm_color_<assetId>`) before they are
	 * internalized. No default: without it, a message with a `p color` entry
	 * is left unacknowledged with reason `overlay-required`; everything else
	 * is processed.
	 */
	overlay?: string
}

/** A message internalized and acknowledged. */
export interface TransactionInboxReceipt {
	messageId: string
	txid: string
	/** Sender identity key, hex */
	sender: string
	/** `payment.satoshis` as the envelope states it (handle payments only) */
	satoshis?: number
	/** The `text/plain` content (handle payments only) */
	memo?: string
	/** 1Color assets received (`<txid>_<vout>`), BRC-232 deliveries only */
	assetIds: string[]
}

export interface SyncTransactionInboxResult {
	received: TransactionInboxReceipt[]
	/** Messages left unacknowledged */
	skipped: InboxSkip[]
	error?: string
}

const BRC29_PROTOCOL = BRC29_PROTOCOL_ID[1]
const COMPRESSED_KEY = /^0[23][0-9a-f]{64}$/

/** Internalize a §7.3 `payment` as a BRC-29 wallet payment of output 0. */
async function internalizeEnvelopePayment(
	wallet: Pick<WalletInterface, 'internalizeAction'>,
	payment: EnvelopePayment,
	sender: string,
	memo: string | undefined,
): Promise<string> {
	if (
		!(payment.protocol instanceof Uint8Array) ||
		Utils.toUTF8(Array.from(payment.protocol)) !== BRC29_PROTOCOL
	) {
		throw new InboxSkipError('payment protocol is not BRC-29')
	}
	if (
		!(payment.derivationPrefix instanceof Uint8Array) ||
		!(payment.derivationSuffix instanceof Uint8Array) ||
		!(payment.beef instanceof Uint8Array)
	) {
		throw new InboxSkipError('malformed payment')
	}
	const beef = Beef.fromBinary(Array.from(payment.beef))
	const txid = beef.atomicTxid ?? beef.txs[beef.txs.length - 1]?.tx?.id('hex')
	if (!txid) throw new InboxSkipError('payment beef has no transaction')
	await wallet.internalizeAction({
		tx: beef.toBinaryAtomic(txid),
		outputs: [
			{
				outputIndex: 0,
				protocol: 'wallet payment',
				paymentRemittance: {
					derivationPrefix: Utils.toBase64(
						Array.from(payment.derivationPrefix),
					),
					derivationSuffix: Utils.toBase64(
						Array.from(payment.derivationSuffix),
					),
					senderIdentityKey: sender,
				},
			},
		],
		labels: [METANET_PAYMENT_LABEL],
		description: (memo ? `Metanet payment: ${memo}` : 'Metanet payment').slice(
			0,
			50,
		),
	})
	return txid
}

/**
 * Internalize one BRC-232 delivery body, whole or not at all: map its
 * entries, submit each 1Color asset's transaction to `tm_color_<assetId>` at
 * `overlay` and require admission of the received outputs, then one
 * `internalizeAction`.
 *
 * @throws when the body is malformed, names an unsupported entry or basket,
 * the overlay does not admit a received output, or the wallet refuses it
 */
export async function internalizeTransactionDelivery(
	wallet: Pick<WalletInterface, 'internalizeAction'>,
	overlay: string | undefined,
	body: Uint8Array,
): Promise<{ txid: string; assetIds: string[] }> {
	const delivery = decodeTransactionDelivery(body)
	const txid = Utils.toHex(Array.from(delivery.txid))
	const beef = Beef.fromBinary(Array.from(delivery.beef))
	const subject = beef.findTxid(txid)?.tx
	if (!subject || subject.id('hex') !== txid) {
		throw new InboxSkipError(`beef does not contain ${txid}`)
	}

	const outputs: InternalizeOutput[] = []
	const received = new Map<string, number[]>()
	for (const entry of delivery.outputs) {
		const { outputIndex } = entry
		if (!subject.outputs[outputIndex]) {
			throw new InboxSkipError(`output ${outputIndex} is not in ${txid}`)
		}
		if (entry.protocol === 'wallet payment') {
			const r = entry.paymentRemittance
			const senderIdentityKey = Utils.toHex(Array.from(r.senderIdentityKey))
			if (!COMPRESSED_KEY.test(senderIdentityKey)) {
				throw new InboxSkipError(
					`output ${outputIndex}: senderIdentityKey is not a compressed key`,
				)
			}
			outputs.push({
				outputIndex,
				protocol: 'wallet payment',
				paymentRemittance: {
					derivationPrefix: r.derivationPrefix,
					derivationSuffix: r.derivationSuffix,
					senderIdentityKey,
				},
			})
			continue
		}
		const { basket, customInstructions, tags } = entry.insertionRemittance
		if (!basket.startsWith('p color ')) {
			throw new InboxSkipError(
				`output ${outputIndex}: unsupported basket ${basket}`,
			)
		}
		// 1Color receipts are submitted to the overlay before internalizing.
		if (!overlay) throw new InboxSkipError('overlay-required')
		const { assetId } = checkColorReceipt(
			subject,
			outputIndex,
			basket,
			customInstructions,
		)
		received.set(assetId, [...(received.get(assetId) ?? []), outputIndex])
		outputs.push({
			outputIndex,
			protocol: 'basket insertion',
			insertionRemittance: {
				basket,
				customInstructions,
				...(tags !== undefined && { tags }),
			},
		})
	}

	// BRC-207: the received output must be admitted before the wallet accepts
	// it, and internalizeAction never submits.
	if (received.size > 0) {
		const client = new OverlayClient((overlay as string).replace(/\/+$/, ''))
		for (const [assetId, indexes] of received) {
			const topic = colorTopic(assetId)
			const steak = await client.submitBrc22(Array.from(delivery.beef), [topic])
			const admitted = steak?.[topic]?.outputsToAdmit ?? []
			for (const i of indexes) {
				if (!admitted.includes(i)) {
					throw new InboxSkipError(`${topic} did not admit ${txid}.${i}`)
				}
			}
		}
	}

	await wallet.internalizeAction({
		tx: beef.toBinaryAtomic(txid),
		outputs,
		description:
			received.size > 0 ? 'Receive 1Color tokens' : 'Receive delivered outputs',
	})
	return { txid, assetIds: [...received.keys()] }
}

export const syncTransactionInbox: Action<
	SyncTransactionInboxInput,
	SyncTransactionInboxResult
> = {
	meta: {
		name: 'syncTransactionInbox',
		description:
			'Collect the transaction-delivery message box: BRC-232 deliveries (1Color tokens, submitted to their overlay topic first; BRC-29 outputs) and BRC-169 handle payments, internalized into the wallet',
		category: 'sync',
		inputSchema: {
			type: 'object',
			properties: {
				messageboxUrl: {
					type: 'string',
					description:
						'MessageBox server URL (default: "https://messagebox.1sat.app")',
				},
				overlay: {
					type: 'string',
					description:
						'Base URL of the BRC-22 overlay that 1Color receipts are submitted to before internalizing; without it, messages with 1Color receipts stay in the box (overlay-required)',
				},
			},
		},
		requiresServices: false,
	},

	async execute(ctx, input) {
		return processInbox(
			ctx.wallet,
			input.messageboxUrl,
			TRANSACTION_DELIVERY_BOX,
			async ({ env, sender, entity, plaintext }, msg) => {
				const type = mediaType(entity.contentType)
				if (env.payment) {
					if (type === TRANSACTION_CBOR_CONTENT_TYPE) {
						throw new InboxSkipError(
							'a payment with transaction-delivery content is not supported',
						)
					}
					const memo =
						type === 'text/plain'
							? Utils.toUTF8(Array.from(entity.body))
							: undefined
					const txid = await internalizeEnvelopePayment(
						ctx.wallet,
						env.payment,
						sender,
						memo,
					)
					return {
						messageId: msg.messageId,
						txid,
						sender,
						satoshis: env.payment.satoshis,
						memo,
						assetIds: [],
					}
				}
				if (type === TRANSACTION_CBOR_CONTENT_TYPE) {
					if (env.contentHash === undefined) {
						throw new InboxSkipError(
							'a BRC-232 delivery requires the envelope contentHash',
						)
					}
					const { txid, assetIds } = await internalizeTransactionDelivery(
						ctx.wallet,
						input.overlay,
						transactionDeliveryBody(plaintext),
					)
					return { messageId: msg.messageId, txid, sender, assetIds }
				}
				throw new InboxSkipError(
					`nothing to internalize: no payment, content type ${entity.contentType}`,
				)
			},
		)
	},
}
