/**
 * Collect BRC-232 transaction deliveries from the wallet's `mandala_inbox`.
 *
 * For each message listed (BRC-231 over BRC-104): decode the BRC-169 §7.3
 * DAG-CBOR envelope, verify its §7.2 signature against `sender.identityKey`,
 * decrypt the BRC-78 `content` with `wallet.decrypt`, check `contentHash`,
 * parse the MIME entity, require `application/vnd.metanet.transaction+cbor`,
 * decode the DAG-CBOR body and internalize its outputs:
 *
 * - `wallet payment` → `paymentRemittance { derivationPrefix,
 *   derivationSuffix, senderIdentityKey }`;
 * - `basket insertion` under a `mandala <txid> <vout>` protocol → basket
 *   `mandala <txid> <vout>`, customInstructions = the derivation triple as given,
 *   labels `mandala` and `mandala <txid> <vout>`, after checking that the output's
 *   script names that token.
 *
 * A message is internalized whole or not at all, and acknowledged only after
 * its internalize succeeds. Anything else (an unknown content type or
 * protocolID, a token id mismatch, a bad signature, …) leaves the message
 * unacknowledged and is reported. SPV is `internalizeAction`'s.
 */

import { Mandala } from '@1sat/templates'
import {
	MANDALA_INBOX,
	MANDALA_LABEL,
	mandalaTokenBasket,
	mandalaTokenLabel,
	parseMandalaName,
} from '@1sat/types'
import {
	TRANSACTION_CBOR_CONTENT_TYPE,
	mediaType,
	parseMimeEntity,
} from '@1sat/utils'
import {
	Beef,
	Hash,
	type InternalizeOutput,
	Utils,
	type WalletProtocol,
} from '@bsv/sdk'
import { decode as dagCborDecode } from '@ipld/dag-cbor'
import type { Action } from '../types.js'
import { decryptBrc78 } from './brc78.js'
import { decodeEnvelope, verifyEnvelope } from './envelope.js'
import { type CborMessage, messageRelay } from './relay.js'
import { mandalaTokenOf } from './tokenId.js'

export interface SyncMandalaInboxInput {
	/** MessageBox server URL (default: "https://messagebox.1sat.app") */
	messageboxUrl?: string
}

/** A message left in the box, and why. */
export interface MandalaInboxSkip {
	messageId: string
	reason: string
}

/** A message internalized and acknowledged. */
export interface MandalaInboxReceipt {
	messageId: string
	txid: string
	/** Tokens (BRC-36 deploy outpoints `<txid>.<vout>`) of the Mandala outputs received */
	tokenIds: string[]
}

export interface SyncMandalaInboxResult {
	received: MandalaInboxReceipt[]
	/** Messages left unacknowledged */
	skipped: MandalaInboxSkip[]
	error?: string
}

/** BRC-232 body, as decoded */
interface DeliveryBody {
	memo?: string
	txid: Uint8Array
	beef: Uint8Array
	outputs: Array<Record<string, unknown>>
}

const MANDALA_PREFIX = 'mandala '

class Skip extends Error {}

function bytesHex(b: unknown, length: number, what: string): string {
	if (!(b instanceof Uint8Array) || b.length !== length) {
		throw new Skip(`${what} must be ${length} bytes`)
	}
	return Utils.toHex(Array.from(b))
}

/** Build the internalize outputs and labels for one delivery, or throw Skip. */
function planInternalize(body: DeliveryBody): {
	txid: string
	tx: number[]
	outputs: InternalizeOutput[]
	labels: string[]
	tokenIds: string[]
} {
	const txid = bytesHex(body.txid, 32, 'txid')
	if (!(body.beef instanceof Uint8Array)) throw new Skip('beef must be bytes')
	if (!Array.isArray(body.outputs) || body.outputs.length === 0) {
		throw new Skip('outputs must be a non-empty array')
	}
	const beef = Beef.fromBinary(Array.from(body.beef))
	const subject = beef.findTxid(txid)?.tx
	if (!subject) throw new Skip(`beef does not contain ${txid}`)

	const outputs: InternalizeOutput[] = []
	const tokenIds: string[] = []
	const seen = new Set<number>()
	for (const entry of body.outputs) {
		const outputIndex = entry.outputIndex
		if (
			typeof outputIndex !== 'number' ||
			!subject.outputs[outputIndex] ||
			seen.has(outputIndex)
		) {
			throw new Skip(`bad outputIndex ${String(outputIndex)}`)
		}
		seen.add(outputIndex)

		if (entry.protocol === 'wallet payment') {
			if (
				typeof entry.derivationPrefix !== 'string' ||
				typeof entry.derivationSuffix !== 'string'
			) {
				throw new Skip(`output ${outputIndex}: bad payment remittance`)
			}
			outputs.push({
				outputIndex,
				protocol: 'wallet payment',
				paymentRemittance: {
					derivationPrefix: entry.derivationPrefix,
					derivationSuffix: entry.derivationSuffix,
					senderIdentityKey: bytesHex(
						entry.senderIdentityKey,
						33,
						'senderIdentityKey',
					),
				},
			})
			continue
		}

		if (entry.protocol !== 'basket insertion') {
			throw new Skip(
				`output ${outputIndex}: unknown protocol ${String(entry.protocol)}`,
			)
		}
		const protocolID = entry.protocolID as WalletProtocol
		const name = Array.isArray(protocolID) ? protocolID[1] : undefined
		if (typeof name !== 'string' || !name.startsWith(MANDALA_PREFIX)) {
			throw new Skip(
				`output ${outputIndex}: unknown protocolID ${JSON.stringify(protocolID)}`,
			)
		}
		if (typeof entry.keyID !== 'string') {
			throw new Skip(`output ${outputIndex}: keyID must be a string`)
		}
		const counterparty = bytesHex(entry.counterparty, 33, 'counterparty')
		// The protocol names the token by its deploy outpoint; the script's
		// BRC-162 id must name the same outpoint.
		const named = parseMandalaName(name)
		if (!named) {
			throw new Skip(
				`output ${outputIndex}: malformed Mandala protocol ${name}`,
			)
		}
		const tokenId = `${named.txid}.${named.vout}`
		const token = Mandala.decode(subject.outputs[outputIndex].lockingScript)
		const scriptTokenId = token
			? mandalaTokenOf(token, txid, outputIndex)
			: undefined
		if (scriptTokenId === undefined || scriptTokenId !== tokenId) {
			throw new Skip(
				`output ${outputIndex}: token mismatch (protocolID ${tokenId}, script ${scriptTokenId ?? 'none'})`,
			)
		}
		outputs.push({
			outputIndex,
			protocol: 'basket insertion',
			insertionRemittance: {
				basket: mandalaTokenBasket(tokenId),
				customInstructions: JSON.stringify({
					protocolID,
					keyID: entry.keyID,
					counterparty,
				}),
			},
		})
		if (!tokenIds.includes(tokenId)) tokenIds.push(tokenId)
	}

	const labels = tokenIds.length
		? [MANDALA_LABEL, ...tokenIds.map(mandalaTokenLabel)]
		: []
	return { txid, tx: beef.toBinaryAtomic(txid), outputs, labels, tokenIds }
}

export const syncMandalaInbox: Action<
	SyncMandalaInboxInput,
	SyncMandalaInboxResult
> = {
	meta: {
		name: 'syncMandalaInbox',
		description:
			'Collect BRC-232 transaction deliveries (Mandala tokens, BRC-29 payments) from the mandala_inbox message box and internalize them',
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
		const messagebox =
			input.messageboxUrl?.replace(/\/+$/, '') || 'https://messagebox.1sat.app'
		const received: MandalaInboxReceipt[] = []
		const skipped: MandalaInboxSkip[] = []
		const acknowledged: string[] = []

		let messages: CborMessage[]
		try {
			messages = await messageRelay.listCborMessages(
				ctx.wallet,
				messagebox,
				MANDALA_INBOX,
			)
		} catch (error) {
			return {
				received,
				skipped,
				error: error instanceof Error ? error.message : String(error),
			}
		}

		for (const msg of messages) {
			try {
				let env: ReturnType<typeof decodeEnvelope>
				try {
					env = decodeEnvelope(msg.body)
				} catch {
					throw new Skip('not a DAG-CBOR BRC-169 envelope')
				}
				if (!(await verifyEnvelope(env))) {
					throw new Skip('envelope signature does not verify')
				}
				const sender = bytesHex(env.sender.identityKey, 33, 'sender')
				const plaintext = await decryptBrc78(ctx.wallet, env.content, sender)
				if (
					env.contentHash !== undefined &&
					Utils.toHex(Hash.sha256(plaintext)) !==
						Utils.toHex(Array.from(env.contentHash))
				) {
					throw new Skip('contentHash does not match the content')
				}
				const entity = parseMimeEntity(plaintext)
				if (mediaType(entity.contentType) !== TRANSACTION_CBOR_CONTENT_TYPE) {
					throw new Skip(`unsupported content type ${entity.contentType}`)
				}
				const plan = planInternalize(dagCborDecode(entity.body) as DeliveryBody)
				await ctx.wallet.internalizeAction({
					tx: plan.tx,
					outputs: plan.outputs,
					...(plan.labels.length && { labels: plan.labels }),
					description: plan.tokenIds.length
						? 'Receive Mandala tokens'
						: 'Receive delivered outputs',
				})
				acknowledged.push(msg.messageId)
				received.push({
					messageId: msg.messageId,
					txid: plan.txid,
					tokenIds: plan.tokenIds,
				})
			} catch (error) {
				skipped.push({
					messageId: msg.messageId,
					reason: error instanceof Error ? error.message : String(error),
				})
			}
		}

		if (acknowledged.length > 0) {
			try {
				await messageRelay.acknowledgeCborMessages(
					ctx.wallet,
					messagebox,
					acknowledged,
				)
			} catch (error) {
				return {
					received,
					skipped,
					error: `acknowledge-failed: ${error instanceof Error ? error.message : String(error)}`,
				}
			}
		}
		return { received, skipped }
	},
}
