/**
 * Payments Module
 *
 * Actions for sending BSV payments.
 */

import {
	type HandleResolution,
	domainOffersHandles,
	parseHandle,
	resolveHandle,
} from '@1sat/client'
import { Inscription } from '@1sat/templates'
import {
	BRC29_PROTOCOL_ID,
	HANDLE_CERT_TYPE,
	MESSAGE_SIGNING_PROTOCOL,
	METANET_INBOX,
	METANET_SEND_EXPIRY_SECONDS,
} from '@1sat/types'
import { encodeMimeEntity } from '@1sat/utils'
import {
	BSM,
	BigNumber,
	type CreateActionArgs,
	type CreateActionOutput,
	MasterCertificate,
	P2PKH,
	PublicKey,
	Script,
	Signature,
	Transaction,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import type { FundingProvider } from '../funding/index.js'
import { randomBase64, sendEnvelope } from '../metanet/deliver.js'
import {
	type P2pMetadata,
	getP2pPaymentDestination,
	sendBeefP2P,
} from '../paymail.js'
import type { Action, ActionOptions } from '../types.js'

/**
 * Plain BSV sends don't carry any P1Sat semantics — no asset inputs,
 * no basketed outputs, no two-phase signing. They should not surface
 * through the 1Sat permission module. We bypass `executeTrackedAction`
 * (which would add the `'p 1sat action'` dispatch label) and call
 * `wallet.createAction` directly, preserving `fundingProvider` support
 * for callers that fund payments externally.
 */
export async function dispatchPlainPayment(
	wallet: import('@bsv/sdk').WalletInterface,
	args: CreateActionArgs,
	fundingProvider?: FundingProvider,
): Promise<{ txid?: string; tx?: number[] }> {
	const toArray = (b?: number[] | Uint8Array): number[] | undefined => {
		if (b === undefined) return undefined
		return Array.isArray(b) ? b : Array.from(b)
	}
	if (fundingProvider) {
		const funded = await fundingProvider.fund(args)
		return { txid: funded.txid, tx: toArray(funded.tx) }
	}
	const result = await wallet.createAction(args)
	return { txid: result.txid, tx: toArray(result.tx) }
}

const maxPossibleSatoshis = 2099999999999999

// ============================================================================
// Types
// ============================================================================

export interface SendBsvRequest extends ActionOptions {
	/** Destination address (P2PKH) */
	address?: string
	/**
	 * Destination paymail. Tried as a BRC-169 handle first: when the domain's
	 * `manifest.json` carries `metanet.handles` the payment goes to the handle
	 * (see {@link SendBsvRequest.handle}), otherwise by paymail as before.
	 *
	 * @deprecated Paymail is to be deprecated; use `handle`.
	 */
	paymail?: string
	/**
	 * Destination BRC-169 handle. `@handle@domain` (optional `+tag`) is
	 * BRC-169 only. A bare `handle@domain` is BRC-169 when
	 * `https://<domain>/manifest.json` carries `metanet.handles`, and paymail
	 * otherwise. A handle payment is a BRC-29 output in a protected `noSend`
	 * action (BRC-177), delivered in a signed envelope to the handle's
	 * `metanet_inbox`; the recipient broadcasts it. It must be the only
	 * request.
	 */
	handle?: string
	/** Memo for a handle payment, sent as the envelope's `text/plain` content */
	memo?: string
	/** Amount in satoshis */
	satoshis: number
	/** Custom locking script (hex) */
	script?: string
	/** OP_RETURN data */
	data?: string[]
	/** Inscription data */
	inscription?: {
		base64Data: string
		mimeType: string
		map?: Record<string, string>
	}
}

export interface SendBsvResponse {
	txid?: string
	tx?: number[]
	/** `envelope`: a handle payment, delivered to the handle's messagebox, not broadcast */
	delivered?: 'envelope'
	/** Messagebox message id of a handle payment's envelope */
	messageId?: string
	error?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

interface PaymailRef {
	paymail: string
	reference: string
}

function isPaymail(address: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
}

/**
 * Resolve a payment recipient as a BRC-169 handle, or return undefined when
 * it is paymail. `@handle@domain` is always a handle (resolution errors
 * throw, no fallback); a bare `handle@domain` is a handle when
 * `https://<domain>/manifest.json` carries `metanet.handles`, and paymail
 * otherwise.
 */
export async function resolvePaymentHandle(
	recipient: string,
): Promise<HandleResolution | undefined> {
	const target = recipient.trim()
	if (target.startsWith('@')) return resolveHandle(target)
	let domain: string
	try {
		domain = parseHandle(target).domain
	} catch {
		// Not handle-shaped (e.g. a dotless domain): paymail as before.
		return undefined
	}
	return (await domainOffersHandles(domain)) ? resolveHandle(target) : undefined
}

/**
 * BRC-169 §6.1 payment to a handle: resolve it, build a BRC-29 output in a
 * protected `noSend` action (BRC-177, funded by the wallet), and deliver the
 * Atomic BEEF in a signed envelope to the handle's `metanet_inbox`. The
 * action is not broadcast; the recipient broadcasts it on internalization.
 */
async function sendToHandle(
	wallet: WalletInterface,
	resolution: HandleResolution,
	satoshis: number,
	memo = '',
): Promise<SendBsvResponse> {
	const derivationPrefix = randomBase64()
	const derivationSuffix = randomBase64()
	const { publicKey } = await wallet.getPublicKey({
		protocolID: BRC29_PROTOCOL_ID,
		keyID: `${derivationPrefix} ${derivationSuffix}`,
		counterparty: resolution.identityKey,
	})
	const name = `${resolution.handle}@${resolution.domain}`
	const result = await wallet.createAction({
		description: `Payment to ${name}`.slice(0, 50),
		outputs: [
			{
				lockingScript: new P2PKH()
					.lock(PublicKey.fromString(publicKey).toAddress())
					.toHex(),
				satoshis,
				outputDescription: 'Payment to handle',
			},
		],
		labels: [`p nosend expiry seconds ${METANET_SEND_EXPIRY_SECONDS}`],
		options: { noSend: true, randomizeOutputs: false },
	})
	if (!result.txid || !result.tx) return { error: 'no-transaction' }
	const tx = Array.from(result.tx)

	const { publicKey: senderIdentityKey } = await wallet.getPublicKey({
		identityKey: true,
	})
	const plaintext = Array.from(
		encodeMimeEntity('text/plain; charset=utf-8', Utils.toArray(memo, 'utf8')),
	)
	try {
		const sent = await sendEnvelope(wallet, resolution, {
			senderIdentityKey,
			plaintext,
			payment: {
				derivationPrefix: Uint8Array.from(
					Utils.toArray(derivationPrefix, 'base64'),
				),
				derivationSuffix: Uint8Array.from(
					Utils.toArray(derivationSuffix, 'base64'),
				),
				protocol: Uint8Array.from(Utils.toArray(BRC29_PROTOCOL_ID[1], 'utf8')),
				satoshis,
				beef: Uint8Array.from(tx),
			},
			messageBox: METANET_INBOX,
		})
		return {
			txid: result.txid,
			tx,
			delivered: 'envelope',
			messageId: sent.messageId,
		}
	} catch (error) {
		// The payment exists as a noSend action: return it so the caller can
		// retry delivery or abortAction it.
		return {
			txid: result.txid,
			tx,
			error: `delivery-failed: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

async function deliverP2P(
	refs: PaymailRef[],
	beefHex: string,
	metadata?: P2pMetadata,
): Promise<void> {
	for (const ref of refs) {
		await sendBeefP2P(ref.paymail, beefHex, ref.reference, metadata)
	}
}

async function assertOwnedPaymail(
	wallet: WalletInterface,
	from: string,
): Promise<void> {
	const [alias, domain] = from.toLowerCase().split('@')
	if (!alias || !domain) throw new Error('invalid from paymail')
	const { certificates } = await wallet.listCertificates({
		types: [HANDLE_CERT_TYPE],
		certifiers: [],
		limit: 10000,
	})
	for (const cert of certificates) {
		if (!cert.keyring) continue
		const fields = await MasterCertificate.decryptFields(
			wallet,
			cert.keyring,
			cert.fields,
			cert.certifier,
		)
		if (fields.handle === alias && fields.domain === domain) return
	}
	throw new Error('from paymail is not certified in this wallet')
}

async function senderMetadata(
	wallet: WalletInterface,
	from: string,
	txid: string,
): Promise<P2pMetadata> {
	const messageBytes = Utils.toArray(txid, 'utf8')
	const msgHash = BSM.magicHash(messageBytes)
	const result = await wallet.createSignature({
		protocolID: MESSAGE_SIGNING_PROTOCOL,
		keyID: 'identity',
		counterparty: 'self',
		hashToDirectlySign: Array.from(msgHash),
	})
	const pubKeyResult = await wallet.getPublicKey({
		protocolID: MESSAGE_SIGNING_PROTOCOL,
		keyID: 'identity',
		forSelf: true,
	})
	const publicKey = PublicKey.fromString(pubKeyResult.publicKey)
	const signature = Signature.fromDER(result.signature)
	const recovery = signature.CalculateRecoveryFactor(
		publicKey,
		new BigNumber(msgHash),
	)
	return {
		sender: from,
		pubkey: pubKeyResult.publicKey,
		signature: signature.toCompact(recovery, true, 'base64') as string,
	}
}

function buildInscriptionScript(
	address: string,
	base64Data: string,
	mimeType: string,
): Script {
	const content = Utils.toArray(base64Data, 'base64')
	const inscription = Inscription.create(new Uint8Array(content), mimeType)
	const inscriptionScript = inscription.lock()
	const p2pkhScript = new P2PKH().lock(address)

	const combined = new Script()
	for (const chunk of inscriptionScript.chunks) combined.chunks.push(chunk)
	for (const chunk of p2pkhScript.chunks) combined.chunks.push(chunk)
	return combined
}

// ============================================================================
// Actions
// ============================================================================

/** Input for sendBsv action */
export interface SendBsvInput extends ActionOptions {
	requests: SendBsvRequest[]
	/** Optional certified paymail this wallet sends as */
	from?: string
}

/**
 * Send BSV to one or more destinations.
 */
export const sendBsv: Action<SendBsvInput, SendBsvResponse> = {
	meta: {
		name: 'sendBsv',
		description:
			'Send BSV to one or more destinations (addresses, scripts, or OP_RETURN)',
		category: 'payments',
		inputSchema: {
			type: 'object',
			properties: {
				requests: {
					type: 'array',
					description: 'Array of payment requests',
					items: {
						type: 'object',
						properties: {
							address: {
								type: 'string',
								description: 'Destination P2PKH address',
							},
							paymail: {
								type: 'string',
								description:
									'Destination paymail address (deprecated; tried as a BRC-169 handle first)',
							},
							handle: {
								type: 'string',
								description:
									'Destination BRC-169 handle: @handle@domain (BRC-169 only) or handle@domain (BRC-169 if the domain offers handles, else paymail). Must be the only request.',
							},
							memo: {
								type: 'string',
								description: 'Memo carried with a handle payment',
							},
							satoshis: { type: 'integer', description: 'Amount in satoshis' },
							script: {
								type: 'string',
								description: 'Custom locking script (hex)',
							},
							data: {
								type: 'array',
								description: 'OP_RETURN data elements',
								items: { type: 'string' },
							},
						},
						required: ['satoshis'],
					},
				},
				from: {
					type: 'string',
					description: 'Certified paymail to send as',
				},
			},
			required: ['requests'],
		},
	},
	async execute(ctx, input) {
		try {
			const { requests } = input
			if (!requests || requests.length === 0) {
				return { error: 'no-requests' }
			}

			for (const req of requests) {
				const recipient = req.handle ?? req.paymail
				if (!recipient) continue
				const resolution = await resolvePaymentHandle(recipient)
				if (resolution === undefined) continue
				if (requests.length !== 1) {
					return { error: 'handle-payment-must-be-the-only-request' }
				}
				return await sendToHandle(
					ctx.wallet,
					resolution,
					req.satoshis,
					req.memo,
				)
			}

			const outputs: CreateActionOutput[] = []
			const paymailRefs: PaymailRef[] = []

			for (const req of requests) {
				// A bare handle@domain whose domain offers no handles is paymail.
				const paymail = req.paymail ?? req.handle
				if (paymail) {
					const dest = await getP2pPaymentDestination(paymail, req.satoshis)
					paymailRefs.push({ paymail, reference: dest.reference })
					for (const output of dest.outputs) {
						outputs.push({
							lockingScript: output.script,
							satoshis: output.satoshis,
							outputDescription: `Paymail payment to ${paymail}`,
							tags: [],
						})
					}
					continue
				}

				let lockingScript: Script

				if (req.script) {
					lockingScript = Script.fromHex(req.script)
				} else if (req.address) {
					if (req.inscription) {
						lockingScript = buildInscriptionScript(
							req.address,
							req.inscription.base64Data,
							req.inscription.mimeType,
						)
					} else {
						lockingScript = new P2PKH().lock(req.address)
					}
				} else if (req.data && req.data.length > 0) {
					try {
						lockingScript = Script.fromASM(
							`OP_0 OP_RETURN ${req.data.join(' ')}`,
						)
					} catch {
						return { error: 'invalid-data' }
					}
				} else {
					return { error: 'invalid-request' }
				}

				outputs.push({
					lockingScript: lockingScript.toHex(),
					satoshis: req.satoshis,
					outputDescription: `Payment of ${req.satoshis} sats`,
					tags: [],
				})
			}

			const result = await dispatchPlainPayment(
				ctx.wallet,
				{
					description: `Send ${requests.length} payment(s)`,
					outputs,
					options: { acceptDelayedBroadcast: false },
				},
				input.fundingProvider,
			)

			if (!result.txid) {
				return { error: 'no-txid-returned' }
			}

			if (paymailRefs.length > 0 && result.tx) {
				const beefHex = Utils.toHex(
					Transaction.fromAtomicBEEF(result.tx).toBEEF(),
				)
				let metadata: P2pMetadata | undefined
				if (input.from) {
					await assertOwnedPaymail(ctx.wallet, input.from)
					if (!result.txid) throw new Error('no-txid-returned')
					metadata = await senderMetadata(ctx.wallet, input.from, result.txid)
				}
				await deliverP2P(paymailRefs, beefHex, metadata)
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sendBsv',
					input: { requestCount: requests.length },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
				})
			}

			return {
				txid: result.txid,
				tx: result.tx,
			}
		} catch (error) {
			console.error('[sendBsv]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sendBsv',
					input: { requestCount: input.requests?.length },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/** Input for sendAllBsv action */
export interface SendAllBsvInput extends ActionOptions {
	/** Destination address to send all funds to */
	destination: string
}

/**
 * Send all BSV to a destination address.
 */
export const sendAllBsv: Action<SendAllBsvInput, SendBsvResponse> = {
	meta: {
		name: 'sendAllBsv',
		description: 'Send all BSV from wallet to a single destination address',
		category: 'payments',
		inputSchema: {
			type: 'object',
			properties: {
				destination: {
					type: 'string',
					description: 'Destination P2PKH address to send all funds to',
				},
			},
			required: ['destination'],
		},
	},
	async execute(ctx, input) {
		try {
			const { destination } = input
			if (isPaymail(destination)) {
				return {
					error:
						'sendAllBsv does not support paymail — use sendBsv with a fixed amount',
				}
			}

			const result = await dispatchPlainPayment(
				ctx.wallet,
				{
					description: 'Send all BSV',
					outputs: [
						{
							lockingScript: new P2PKH().lock(destination).toHex(),
							satoshis: maxPossibleSatoshis,
							outputDescription: 'Sweep all funds',
							tags: [],
						},
					],
					options: { acceptDelayedBroadcast: false },
				},
				input.fundingProvider,
			)

			if (!result.txid) {
				return { error: 'no-txid-returned' }
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sendAllBsv',
					input: { destination },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
				})
			}

			return {
				txid: result.txid,
				tx: result.tx,
			}
		} catch (error) {
			console.error('[sendAllBsv]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sendAllBsv',
					input: { destination: input.destination },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

// ============================================================================
// Module exports
// ============================================================================

/** All payment actions for registry */
export const paymentsActions = [sendBsv, sendAllBsv]
