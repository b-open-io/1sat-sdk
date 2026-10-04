/**
 * Mandala (BRC-162) send to a BRC-169 handle, delivered per BRC-232.
 *
 * 1. Resolve the handle (`resolveHandle`): identity key + messagebox.
 * 2. When no single token output in `mandala <txid> <vout>` holds exactly `amount`,
 *    split first: an ordinary, broadcast action spending token outputs into
 *    an exact-`amount` output and a remainder, both back to the wallet under
 *    `mandalaProtocol(tokenId)` in the token's basket.
 * 3. The protected send: one `createAction` spending only the exact output,
 *    with one output, the recipient's token output, locked to the key
 *    derived under `mandalaProtocol(tokenId)` with keyID
 *    `<derivationPrefix> <derivationSuffix>` (fresh random base64) and
 *    counterparty = the recipient. `noSend`, labels `mandala`,
 *    `mandala <txid> <vout>` and `p nosend expiry seconds <n>` (BRC-177; the wallet
 *    funds it). It is not broadcast: the recipient broadcasts by
 *    internalizing (BRC-169 §6.1, BRC-232 rule 4).
 * 4. Delivery: a signed BRC-169 §7.3 envelope (DAG-CBOR, BRC-231 body over
 *    BRC-104) to the resolved messagebox, box `mandala_inbox`, `payment:
 *    null`. `content` is BRC-78 encryption (via `wallet.encrypt`) of a MIME
 *    entity of type `application/vnd.metanet.transaction+cbor` whose DAG-CBOR
 *    body is the BRC-232 delivery `{ txid, beef, outputs: [ basket insertion
 *    ] }`; `contentHash` is the SHA-256 of the MIME bytes.
 *
 * When delivery fails the result carries the error with `txid` and `tx`, so
 * the caller can retry delivery or `abortAction` the send.
 */

import { type HandleResolution, resolveHandle } from '@1sat/client'
import { Mandala } from '@1sat/templates'
import {
	MANDALA_INBOX,
	MANDALA_LABEL,
	MANDALA_SEND_EXPIRY_SECONDS,
	mandalaProtocol,
	mandalaTokenBasket,
	mandalaTokenLabel,
} from '@1sat/types'
import { TRANSACTION_CBOR_CONTENT_TYPE, encodeMimeEntity } from '@1sat/utils'
import {
	Beef,
	type CreateActionOutput,
	Hash,
	P2PKH,
	PublicKey,
	Utils,
	type WalletOutput,
	type WalletProtocol,
} from '@bsv/sdk'
import { encode as dagCborEncode } from '@ipld/dag-cbor'
import type { Action, OneSatContext } from '../types.js'
import { executeTrackedAction } from '../utils/createTrackedAction.js'
import { resolveDestination } from '../utils/resolveDestination.js'
import { encryptBrc78 } from './brc78.js'
import { signEnvelope } from './envelope.js'
import { messageRelay } from './relay.js'
import {
	mandalaTokenOf,
	mandalaTokenOutpoint,
	mandalaWireId,
} from './tokenId.js'

export interface SendMandalaInput {
	/** Token: the deploy outpoint, BRC-36 `<txid>.<vout>` (`<txid>_<vout>` accepted) */
	tokenId: string
	/** Amount in raw units */
	amount: bigint | string
	/** BRC-169 handle: `@handle@domain` or `handle@domain` */
	destination: { handle: string }
	/**
	 * BRC-177 `nosend expiry seconds` for the protected send (default
	 * {@link MANDALA_SEND_EXPIRY_SECONDS}, one year).
	 */
	expirySeconds?: number
	/** Optional free text carried as the BRC-232 `memo` */
	memo?: string
}

export interface SendMandalaResult {
	txid?: string
	/** Atomic BEEF of the send */
	tx?: number[]
	/** `envelope`: BRC-169 envelope to the handle's messagebox, not broadcast */
	delivered?: 'envelope'
	/** Messagebox message id */
	messageId?: string
	error?: string
}

/** A BRC-232 `basket insertion` output entry. */
export interface MandalaDeliveryOutput {
	outputIndex: number
	protocol: 'basket insertion'
	protocolID: WalletProtocol
	keyID: string
	/** bstr(33): the key the recipient derives against (the sender's identity) */
	counterparty: Uint8Array
}

/** The BRC-232 DAG-CBOR body a Mandala send delivers. */
export interface MandalaDeliveryBody {
	memo?: string
	/** bstr(32), display byte order (as in the BRC-95 Atomic BEEF header) */
	txid: Uint8Array
	beef: Uint8Array
	outputs: MandalaDeliveryOutput[]
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
	// Authority outputs (amount 0) are not spent by a send.
	if (!token || token.amount === 0n) return undefined
	return mandalaTokenOf(token, txid, Number(vout)) === tokenId
		? token.amount
		: undefined
}

/** A wallet token output to spend: outpoint, its derivation CI, its amount */
interface TokenInput {
	outpoint: string
	customInstructions?: string
	amount: bigint
}

/**
 * A token value output back to the wallet, in the token's basket, with a
 * fresh self-derived key; customInstructions carry only the derivation.
 */
async function selfTokenOutput(
	ctx: OneSatContext,
	tokenId: string,
	amount: bigint,
	outputDescription: string,
): Promise<CreateActionOutput & { customInstructions: string }> {
	const self = await resolveDestination(
		ctx,
		{ counterparty: 'self' },
		{ protocolID: mandalaProtocol(tokenId), keyIDPrefix: 'mandala' },
	)
	return {
		lockingScript: Mandala.value(mandalaWireId(tokenId), amount, {
			lock: self.lockingScript,
		})
			.lock()
			.toHex(),
		satoshis: 1,
		outputDescription,
		basket: mandalaTokenBasket(tokenId),
		customInstructions: JSON.stringify(self.customInstructions),
	}
}

/** Spend wallet token outputs through the shared pipeline. */
function spendTokens(
	ctx: OneSatContext,
	p: {
		description: string
		labels: string[]
		inputs: TokenInput[]
		inputBEEF: number[]
		outputs: CreateActionOutput[]
		noSend: boolean
	},
) {
	return executeTrackedAction(
		ctx.wallet,
		{
			description: p.description,
			labels: [...p.labels],
			inputBEEF: p.inputBEEF,
			inputs: p.inputs.map((i) => ({
				outpoint: i.outpoint,
				inputDescription: 'Mandala token input',
				unlockingScriptLength: 108,
			})),
			outputs: p.outputs,
			options: p.noSend
				? { noSend: true, randomizeOutputs: false }
				: { randomizeOutputs: false },
		},
		undefined,
		p.inputBEEF,
		undefined,
		{
			spends: p.inputs.map((i) => ({
				outpoint: i.outpoint,
				customInstructions: i.customInstructions,
			})),
		},
	)
}

/**
 * Split token inputs into an exact `amount` output (vout 0) and a remainder,
 * both back to the wallet in the token's basket, broadcast normally. Returns
 * the exact output as the next input, with BEEF that carries it.
 */
async function splitExact(
	ctx: OneSatContext,
	p: {
		tokenId: string
		labels: string[]
		inputs: TokenInput[]
		inputBEEF: number[]
		amount: bigint
		change: bigint
	},
): Promise<{ input: TokenInput; beef: number[] } | { error: string }> {
	const exactOut = await selfTokenOutput(
		ctx,
		p.tokenId,
		p.amount,
		'Mandala exact amount',
	)
	// No remainder when the inputs sum to `amount` (an amount-0 Mandala
	// output would be an authority).
	const rest =
		p.change > 0n
			? [await selfTokenOutput(ctx, p.tokenId, p.change, 'Mandala remainder')]
			: []
	const result = await spendTokens(ctx, {
		description: `Split ${p.amount} Mandala tokens`,
		labels: p.labels,
		inputs: p.inputs,
		inputBEEF: p.inputBEEF,
		outputs: [exactOut, ...rest],
		noSend: false,
	})
	if (result.error) return { error: `split-failed: ${result.error}` }
	if (!result.txid || !result.tx)
		return { error: 'split-failed: no-transaction' }
	return {
		input: {
			outpoint: `${result.txid}.0`,
			customInstructions: exactOut.customInstructions,
			amount: p.amount,
		},
		beef: Beef.fromBinary(result.tx).toBinary(),
	}
}

/**
 * Build, sign and send the BRC-169 §7.3 envelope carrying a BRC-232 delivery
 * in its encrypted `content`.
 */
async function deliverEnvelope(
	ctx: OneSatContext,
	resolution: HandleResolution,
	p: {
		senderIdentityKey: string
		body: MandalaDeliveryBody
	},
): Promise<{ messageId: string }> {
	const { memo, ...rest } = p.body
	const body = memo === undefined ? rest : { memo, ...rest }
	const plaintext = Array.from(
		encodeMimeEntity(TRANSACTION_CBOR_CONTENT_TYPE, dagCborEncode(body)),
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
			payment: null,
			contentHash: bytes(Hash.sha256(plaintext)),
		},
		bytes(content),
	)
	return messageRelay.sendCborMessage(
		ctx.wallet,
		resolution.messagebox,
		resolution.identityKey,
		MANDALA_INBOX,
		envelope,
	)
}

export const sendMandala: Action<SendMandalaInput, SendMandalaResult> = {
	meta: {
		name: 'sendMandala',
		description:
			"Send Mandala (BRC-162) tokens to a BRC-169 handle: a protected noSend transaction delivered (BRC-232) in a signed envelope to the handle's mandala_inbox; the recipient broadcasts",
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				tokenId: {
					type: 'string',
					description:
						'Token: the deploy outpoint, BRC-36 <txid>.<vout> (<txid>_<vout> accepted)',
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
			required: ['tokenId', 'amount', 'destination'],
		},
	},

	async execute(ctx, input) {
		try {
			let tokenId: string
			try {
				tokenId = mandalaTokenOutpoint(input.tokenId)
			} catch {
				return { error: 'invalid-token: expected <txid>.<vout>' }
			}
			const amount = BigInt(input.amount)
			if (amount <= 0n) return { error: 'amount-must-be-positive' }
			const basket = mandalaTokenBasket(tokenId)

			// 1. Resolve the handle; the recipient key is derived from it.
			const resolution = await resolveHandle(input.destination.handle)

			const listed = await ctx.wallet.listOutputs({
				basket,
				include: 'entire transactions',
				includeTags: true,
				includeCustomInstructions: true,
				limit: 10000,
			})
			if (!listed.BEEF) return { error: 'no-beef-available' }
			const beef = Beef.fromBinary(Array.from(listed.BEEF))

			// Spendable token outputs, amounts read from the script.
			const candidates: TokenInput[] = []
			for (const o of listed.outputs) {
				const amt = tokenAmount(beef, o, tokenId)
				if (amt === undefined) continue
				candidates.push({
					outpoint: o.outpoint,
					customInstructions: o.customInstructions,
					amount: amt,
				})
			}

			const labels = [MANDALA_LABEL, mandalaTokenLabel(tokenId)]

			// 2. The protected send spends exactly one output of exactly `amount`.
			let exact = candidates.find((c) => c.amount === amount)
			let inputBEEF = Array.from(listed.BEEF)
			if (!exact) {
				const inputs: TokenInput[] = []
				let totalIn = 0n
				for (const c of candidates) {
					if (totalIn >= amount) break
					inputs.push(c)
					totalIn += c.amount
				}
				if (totalIn < amount) return { error: 'insufficient-tokens' }
				const split = await splitExact(ctx, {
					tokenId,
					labels,
					inputs,
					inputBEEF,
					amount,
					change: totalIn - amount,
				})
				if ('error' in split) return { error: split.error }
				exact = split.input
				inputBEEF = split.beef
			}

			// 3. The recipient's output, BRC-29-style derivation under the token's protocol.
			const protocolID = mandalaProtocol(tokenId)
			const keyID = `${randomBase64()} ${randomBase64()}`
			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID,
				keyID,
				counterparty: resolution.identityKey,
			})
			const recipientOutput: CreateActionOutput = {
				lockingScript: Mandala.value(mandalaWireId(tokenId), amount, {
					lock: new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()),
				})
					.lock()
					.toHex(),
				satoshis: 1,
				outputDescription: 'Mandala tokens',
			}

			const expiry = input.expirySeconds ?? MANDALA_SEND_EXPIRY_SECONDS
			const result = await spendTokens(ctx, {
				description: `Send ${amount} Mandala tokens`,
				labels: [...labels, `p nosend expiry seconds ${expiry}`],
				inputs: [exact],
				inputBEEF,
				outputs: [recipientOutput],
				noSend: true,
			})
			if (result.error) return { error: result.error }
			if (!result.txid || !result.tx) return { error: 'no-transaction' }

			// 4. Deliver.
			const { publicKey: senderIdentityKey } = await ctx.wallet.getPublicKey({
				identityKey: true,
			})
			let sent: { messageId: string }
			try {
				sent = await deliverEnvelope(ctx, resolution, {
					senderIdentityKey,
					body: {
						memo: input.memo,
						txid: Uint8Array.from(Utils.toArray(result.txid, 'hex')),
						beef: Uint8Array.from(result.tx),
						outputs: [
							{
								outputIndex: 0,
								protocol: 'basket insertion',
								protocolID,
								keyID,
								counterparty: Uint8Array.from(
									Utils.toArray(senderIdentityKey, 'hex'),
								),
							},
						],
					},
				})
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
				delivered: 'envelope',
				messageId: sent.messageId,
			}
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			}
		}
	},
}
