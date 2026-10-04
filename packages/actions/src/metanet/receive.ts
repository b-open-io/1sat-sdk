/**
 * Collect BRC-169 payments from the wallet's `metanet_inbox`.
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
 * - `payment` null and `content` a BRC-232 transaction delivery: processed as
 *   `syncMandalaInbox` processes it.
 *
 * A message is acknowledged only after its internalize succeeds. Anything
 * else (JSON envelopes, a bad signature or hash, a payment protocol other
 * than BRC-29, a payment whose content is a transaction delivery, a message
 * with nothing to internalize) is left unacknowledged and reported.
 */

import { BRC29_PROTOCOL_ID, METANET_INBOX } from '@1sat/types'
import { TRANSACTION_CBOR_CONTENT_TYPE, mediaType } from '@1sat/utils'
import { Beef, Utils, type WalletInterface } from '@bsv/sdk'
import { internalizeTransactionDelivery } from '../mandala/receive.js'
import type { Action } from '../types.js'
import type { EnvelopePayment } from './envelope.js'
import { type InboxSkip, InboxSkipError, processInbox } from './inbox.js'

/** Label on internalized handle payments */
export const METANET_PAYMENT_LABEL = 'metanet payment'

export interface SyncMetanetInboxInput {
	/** MessageBox server URL (default: "https://messagebox.1sat.app") */
	messageboxUrl?: string
}

/** A message internalized and acknowledged. */
export interface MetanetInboxReceipt {
	messageId: string
	txid: string
	/** Sender identity key, hex */
	sender: string
	/** `payment.satoshis` as the envelope states it (payments only) */
	satoshis?: number
	/** The `text/plain` content (payments only) */
	memo?: string
	/** Mandala tokens received (BRC-232 deliveries only) */
	tokenIds: string[]
}

export interface SyncMetanetInboxResult {
	received: MetanetInboxReceipt[]
	/** Messages left unacknowledged */
	skipped: InboxSkip[]
	error?: string
}

const BRC29_PROTOCOL = BRC29_PROTOCOL_ID[1]

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

export const syncMetanetInbox: Action<
	SyncMetanetInboxInput,
	SyncMetanetInboxResult
> = {
	meta: {
		name: 'syncMetanetInbox',
		description:
			'Collect BRC-169 handle payments (and BRC-232 deliveries) from the metanet_inbox message box and internalize them',
		category: 'sync',
		inputSchema: {
			type: 'object',
			properties: {
				messageboxUrl: {
					type: 'string',
					description:
						'MessageBox server URL (default: "https://messagebox.1sat.app")',
				},
			},
		},
		requiresServices: false,
	},

	async execute(ctx, input) {
		return processInbox(
			ctx.wallet,
			input.messageboxUrl,
			METANET_INBOX,
			async ({ env, sender, entity }, msg): Promise<MetanetInboxReceipt> => {
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
						tokenIds: [],
					}
				}
				if (type === TRANSACTION_CBOR_CONTENT_TYPE) {
					const { txid, tokenIds } = await internalizeTransactionDelivery(
						ctx.wallet,
						entity.body,
					)
					return { messageId: msg.messageId, txid, sender, tokenIds }
				}
				throw new InboxSkipError(
					`nothing to internalize: no payment, content type ${entity.contentType}`,
				)
			},
		)
	},
}
