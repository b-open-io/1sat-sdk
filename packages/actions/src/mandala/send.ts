/**
 * Mandala (BRC-162) send.
 *
 * Destinations:
 * - `{ handle }` — a BRC-169 handle (`@handle@domain` / `handle@domain`),
 *   resolved with `resolveHandle`. A peer send like the next one, delivered
 *   as a §7.3 DAG-CBOR envelope (payment + BRC-78 encrypted note, signed per
 *   §7.2) to the resolved messagebox's `payment_inbox`, in the BRC-231
 *   binary encoding over BRC-104.
 * - `{ identityKey, messagebox }` — a peer send. The recipient key is derived
 *   BRC-42 under {@link MANDALA_PROTOCOL}; the transaction is NOT broadcast
 *   (BRC-169 §6.1: the recipient broadcasts on internalization). It travels
 *   as Atomic BEEF in a BRC-33 message to the recipient's `payment_inbox`,
 *   in the PeerPay body shape (BRC-29) extended with `protocol`,
 *   `outputIndex` and `senderIdentityKey`.
 * - `{ address }` — P2PKH lock, broadcast by the wallet, or, when `overlay`
 *   is set, submitted to that BRC-22 overlay instead (`POST <overlay>/submit`,
 *   `X-Topics: tm_<tokenId>`); the wallet then holds it as a `noSend` action.
 *   `overlay` applies only to this path: peer sends never broadcast.
 *
 * Peer sends are BRC-177 protected `noSend` actions: the wallet broadcasts a
 * funding transaction with one dedicated anchor output sized to fund the
 * send exactly, and builds the send with the anchor as its only wallet input
 * and no change. BRC-100 `createAction` has no option to forbid change; the
 * `p nosend expiry …` label is how the wallet is asked for it. If the
 * recipient has not broadcast by the deadline, the wallet reclaims the anchor
 * (invalidating the send); `abortAction` reclaims early. When delivery to
 * the messagebox fails, the result carries the error together with `txid`
 * and `tx` so the caller can retry delivery or abort.
 */

import {
	type HandleResolution,
	OverlayClient,
	resolveHandle,
} from '@1sat/client'
import { Mandala } from '@1sat/templates'
import {
	MANDALA_PROTOCOL,
	PAYMENT_INBOX,
	mandalaTokenBasket,
	mandalaTokenLabel,
} from '@1sat/types'
import { MessageBoxClient } from '@bsv/message-box-client'
import {
	Beef,
	type CreateActionOutput,
	Hash,
	type LockingScript,
	P2PKH,
	PublicKey,
	Utils,
	type WalletOutput,
} from '@bsv/sdk'
import type { Action, OneSatContext } from '../types.js'
import { executeTrackedAction } from '../utils/createTrackedAction.js'
import { resolveDestination } from '../utils/resolveDestination.js'
import { encryptBrc78 } from './brc78.js'
import { signEnvelope } from './envelope.js'
import { sendCborMessage } from './relay.js'

/** Where a Mandala send goes: exactly one of these shapes. */
export type MandalaDestination =
	| {
			/** BRC-169 handle: `@handle@domain` or `handle@domain` */
			handle: string
	  }
	| {
			/** Recipient identity key (66-char compressed hex) */
			identityKey: string
			/** Recipient messagebox URL (BRC-33) */
			messagebox: string
	  }
	| {
			/** P2PKH address */
			address: string
	  }

/** BRC-177 expiry of a peer send: relative seconds, Unix time, or block height */
export type MandalaSendExpiry =
	| { seconds: number }
	| { timestamp: number }
	| { blockheight: number }

/** Default peer-send expiry: 7 days after the wallet commits the send. */
export const DEFAULT_MANDALA_SEND_EXPIRY: MandalaSendExpiry = {
	seconds: 7 * 24 * 60 * 60,
}

export interface SendMandalaInput {
	/** Token id: the deploy txid (hex); also the name of the token's basket */
	tokenId: string
	/** Amount in raw units */
	amount: bigint | string
	destination: MandalaDestination
	/** Peer sends only: BRC-177 expiry (default {@link DEFAULT_MANDALA_SEND_EXPIRY}) */
	expiry?: MandalaSendExpiry
	/**
	 * Address destinations only: overlay base URL. The transaction is submitted
	 * there (BRC-22, topic `tm_<tokenId>`) instead of the wallet's broadcast.
	 * Ignored for peer sends, which do not broadcast.
	 */
	overlay?: string
}

export interface SendMandalaResult {
	txid?: string
	/** Atomic BEEF of the send */
	tx?: number[]
	/**
	 * `envelope`: BRC-169 envelope to the handle's messagebox, not broadcast;
	 * `message`: BRC-33 to the messagebox, not broadcast; `broadcast`: by the
	 * wallet; `overlay`: submitted to the given overlay, not broadcast by the wallet
	 */
	delivered?: 'envelope' | 'message' | 'broadcast' | 'overlay'
	/** Messagebox message id (peer sends) */
	messageId?: string
	error?: string
}

/** Body sent to `payment_inbox` for an identityKey + messagebox destination */
export interface MandalaPaymentMessage {
	customInstructions: {
		derivationPrefix: string
		derivationSuffix: string
		/** BRC-43 protocol name ({@link MANDALA_PROTOCOL}[1]) */
		protocol: string
	}
	/** Atomic BEEF bytes */
	transaction: number[]
	outputIndex: number
	/** Satoshis on the token output */
	amount: number
	senderIdentityKey: string
}

/** BRC-177 action label for an expiry. */
export function noSendExpiryLabel(expiry: MandalaSendExpiry): string {
	if ('seconds' in expiry) return `p nosend expiry seconds ${expiry.seconds}`
	if ('timestamp' in expiry)
		return `p nosend expiry timestamp ${expiry.timestamp}`
	return `p nosend expiry blockheight ${expiry.blockheight}`
}

function randomBase64(): string {
	return Utils.toBase64(Array.from(crypto.getRandomValues(new Uint8Array(16))))
}

/** Token amount a wallet output carries for `tokenId`, read from its locking script. */
function tokenAmount(
	beef: Beef,
	output: WalletOutput,
	tokenId: string,
): bigint | undefined {
	const [txid, vout] = output.outpoint.split('.')
	const script = beef.findTxid(txid)?.tx?.outputs[Number(vout)]?.lockingScript
	if (!script) return undefined
	const token = Mandala.decode(script)
	if (!token || token.amount === 0n) return undefined
	if (token.role === 'value' && token.tokenId === `${tokenId}_0`) {
		return token.amount
	}
	// A fixed-supply deploy output is the token's first value output.
	if (token.role === 'deploy' && txid === tokenId) return token.amount
	return undefined
}

async function recipientLock(
	ctx: OneSatContext,
	destination: MandalaDestination,
	recipientKey: string | undefined,
): Promise<{
	lockingScript: LockingScript
	derivationPrefix?: string
	derivationSuffix?: string
}> {
	if ('address' in destination) {
		return { lockingScript: new P2PKH().lock(destination.address) }
	}
	if (!recipientKey) throw new Error('no recipient identity key')
	const derivationPrefix = randomBase64()
	const derivationSuffix = randomBase64()
	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: MANDALA_PROTOCOL,
		keyID: `${derivationPrefix} ${derivationSuffix}`,
		counterparty: recipientKey,
	})
	return {
		lockingScript: new P2PKH().lock(
			PublicKey.fromString(publicKey).toAddress(),
		),
		derivationPrefix,
		derivationSuffix,
	}
}

/**
 * Build, sign and send the BRC-169 §7.3 envelope for a handle send. `content`
 * is a BRC-78 encrypted JSON note `{ tokenId, amount }`; `contentHash` is the
 * SHA-256 of that plaintext.
 */
async function deliverEnvelope(
	ctx: OneSatContext,
	resolution: HandleResolution,
	p: {
		senderIdentityKey: string
		derivationPrefix: string
		derivationSuffix: string
		tx: number[]
		tokenId: string
		amount: bigint
	},
): Promise<{ messageId: string }> {
	const plaintext = Utils.toArray(
		JSON.stringify({ tokenId: p.tokenId, amount: p.amount.toString() }),
		'utf8',
	)
	const content = await encryptBrc78(
		ctx.wallet,
		plaintext,
		resolution.identityKey,
	)
	const bytes = (a: number[]) => Uint8Array.from(a)
	const { envelope } = await signEnvelope(
		ctx.wallet,
		{
			metanetHandles: '1.0',
			recipient: {
				handle: resolution.handle,
				tag: resolution.tag,
				domain: resolution.domain,
			},
			sender: { identityKey: bytes(Utils.toArray(p.senderIdentityKey, 'hex')) },
			created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
			payment: {
				derivationPrefix: bytes(Utils.toArray(p.derivationPrefix, 'base64')),
				derivationSuffix: bytes(Utils.toArray(p.derivationSuffix, 'base64')),
				protocol: bytes(Utils.toArray(MANDALA_PROTOCOL[1], 'utf8')),
				satoshis: 1,
				beef: bytes(p.tx),
			},
			contentHash: bytes(Hash.sha256(plaintext)),
		},
		bytes(content),
	)
	return sendCborMessage(
		ctx.wallet,
		resolution.messagebox,
		resolution.identityKey,
		PAYMENT_INBOX,
		envelope,
	)
}

export const sendMandala: Action<SendMandalaInput, SendMandalaResult> = {
	meta: {
		name: 'sendMandala',
		description:
			'Send Mandala (BRC-162) tokens to an identity key + messagebox (not broadcast; delivered as BEEF) or to an address (broadcast)',
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				tokenId: {
					type: 'string',
					description: 'Token id: the deploy txid',
				},
				amount: {
					type: 'string',
					description: 'Amount in raw units (string for bigint)',
				},
				destination: {
					type: 'object',
					description:
						'Exactly one of { handle } (BRC-169), { identityKey, messagebox } or { address }',
				},
				overlay: {
					type: 'string',
					description:
						'Address destinations only: overlay base URL to submit to (topic tm_<tokenId>) instead of the wallet broadcast. Ignored for peer sends.',
				},
				expiry: {
					type: 'object',
					description:
						'Peer sends only: BRC-177 expiry, one of { seconds }, { timestamp }, { blockheight }. Default 7 days.',
				},
			},
			required: ['tokenId', 'amount', 'destination'],
		},
	},

	async execute(ctx, input) {
		try {
			const { destination } = input
			const tokenId = input.tokenId.toLowerCase()
			const amount = BigInt(input.amount)
			const peer = !('address' in destination)
			const overlay = peer ? undefined : input.overlay
			const basket = mandalaTokenBasket(tokenId)

			// Handle: resolve first; the recipient key is derived from it.
			const resolution =
				'handle' in destination
					? await resolveHandle(destination.handle)
					: undefined
			const recipientKey =
				resolution?.identityKey ??
				('identityKey' in destination ? destination.identityKey : undefined)

			const listed = await ctx.wallet.listOutputs({
				basket,
				include: 'entire transactions',
				includeTags: true,
				includeCustomInstructions: true,
				limit: 10000,
			})
			if (!listed.BEEF) return { error: 'no-beef-available' }
			const beef = Beef.fromBinary(Array.from(listed.BEEF))

			const selected: WalletOutput[] = []
			let totalIn = 0n
			for (const o of listed.outputs) {
				if (totalIn >= amount) break
				const amt = tokenAmount(beef, o, tokenId)
				if (amt === undefined) continue
				selected.push(o)
				totalIn += amt
			}
			if (totalIn < amount) return { error: 'insufficient-tokens' }

			const idBytes = Mandala.idFromString(`${tokenId}_0`)
			const recipient = await recipientLock(ctx, destination, recipientKey)
			const outputs: CreateActionOutput[] = [
				{
					lockingScript: Mandala.value(idBytes, amount, {
						lock: recipient.lockingScript,
					})
						.lock()
						.toHex(),
					satoshis: 1,
					outputDescription: 'Mandala tokens',
				},
			]

			const change = totalIn - amount
			if (change > 0n) {
				const self = await resolveDestination(
					ctx,
					{ counterparty: 'self' },
					{ protocolID: MANDALA_PROTOCOL, keyIDPrefix: tokenId },
				)
				outputs.push({
					lockingScript: Mandala.value(idBytes, change, {
						lock: self.lockingScript,
					})
						.lock()
						.toHex(),
					satoshis: 1,
					outputDescription: 'Mandala token change',
					basket,
					// Derivation only: the amount is read from the script.
					customInstructions: JSON.stringify(self.customInstructions),
				})
			}

			const inputBEEF = Array.from(listed.BEEF)
			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: `Send ${amount} Mandala tokens`,
					// Token index labels: listActions({ labels: ['mandala'] }) and
					// mandala:<txid> show this send under the token.
					labels: [
						'mandala',
						mandalaTokenLabel(tokenId),
						...(peer
							? [noSendExpiryLabel(input.expiry ?? DEFAULT_MANDALA_SEND_EXPIRY)]
							: []),
					],
					inputBEEF,
					inputs: selected.map((o) => ({
						outpoint: o.outpoint,
						inputDescription: 'Mandala token input',
						unlockingScriptLength: 108,
					})),
					outputs,
					options:
						peer || overlay
							? { noSend: true, randomizeOutputs: false }
							: { randomizeOutputs: false },
				},
				undefined,
				inputBEEF,
				undefined,
				{
					spends: selected.map((o) => ({
						outpoint: o.outpoint,
						customInstructions: o.customInstructions,
					})),
				},
			)
			if (result.error) return { error: result.error }
			if (!result.txid || !result.tx) return { error: 'no-transaction' }

			if ('address' in destination) {
				if (!overlay) {
					return { txid: result.txid, tx: result.tx, delivered: 'broadcast' }
				}
				try {
					await new OverlayClient(overlay).submitMandala(result.tx, tokenId)
				} catch (error) {
					// The send exists as a noSend action: return it so the caller can
					// retry the submit or abortAction it.
					return {
						txid: result.txid,
						tx: result.tx,
						error: `overlay-submit-failed: ${error instanceof Error ? error.message : String(error)}`,
					}
				}
				return { txid: result.txid, tx: result.tx, delivered: 'overlay' }
			}

			const { publicKey: senderIdentityKey } = await ctx.wallet.getPublicKey({
				identityKey: true,
			})
			const derivationPrefix = recipient.derivationPrefix!
			const derivationSuffix = recipient.derivationSuffix!
			let sent: { messageId: string }
			try {
				if (resolution) {
					sent = await deliverEnvelope(ctx, resolution, {
						senderIdentityKey,
						derivationPrefix,
						derivationSuffix,
						tx: result.tx,
						tokenId,
						amount,
					})
				} else if ('identityKey' in destination) {
					const body: MandalaPaymentMessage = {
						customInstructions: {
							derivationPrefix,
							derivationSuffix,
							protocol: MANDALA_PROTOCOL[1],
						},
						transaction: result.tx,
						outputIndex: 0,
						amount: 1,
						senderIdentityKey,
					}
					const client = new MessageBoxClient({
						walletClient: ctx.wallet,
						host: destination.messagebox,
					})
					sent = await client.sendMessage(
						{
							recipient: destination.identityKey,
							messageBox: PAYMENT_INBOX,
							body,
						},
						destination.messagebox,
					)
				} else {
					return { error: 'unsupported-destination' }
				}
			} catch (error) {
				// The send exists as a noSend action: return it so the caller can
				// retry delivery or abortAction it.
				return {
					txid: result.txid,
					tx: result.tx,
					error: `delivery-failed: ${error instanceof Error ? error.message : String(error)}`,
				}
			}
			return {
				txid: result.txid,
				tx: result.tx,
				delivered: resolution ? 'envelope' : 'message',
				messageId: sent.messageId,
			}
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			}
		}
	},
}
