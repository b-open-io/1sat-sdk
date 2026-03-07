/**
 * Payments Module
 *
 * Actions for sending BSV payments.
 */

import { Inscription } from '@bopen-io/templates'
import { type CreateActionOutput, P2PKH, Script, Utils } from '@bsv/sdk'
import { getP2pPaymentDestination, sendTransactionP2P } from '../paymail'
import type { Action } from '../types'

/**
 * Magic constant that tells the wallet to send all available funds minus fees.
 * When an output has this satoshis value, it's adjusted to the maximum fundable amount.
 */
const maxPossibleSatoshis = 2099999999999999

// ============================================================================
// Types
// ============================================================================

export interface SendBsvRequest {
	/** Destination address (P2PKH) */
	address?: string
	/** Destination paymail */
	paymail?: string
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
	rawtx?: string
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

async function deliverP2P(refs: PaymailRef[], txHex: string): Promise<void> {
	for (const ref of refs) {
		await sendTransactionP2P(ref.paymail, txHex, ref.reference)
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
export interface SendBsvInput {
	requests: SendBsvRequest[]
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
								description: 'Destination paymail address',
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

			const outputs: CreateActionOutput[] = []
			const paymailRefs: PaymailRef[] = []

			for (const req of requests) {
				if (req.paymail) {
					const dest = await getP2pPaymentDestination(req.paymail, req.satoshis)
					paymailRefs.push({ paymail: req.paymail, reference: dest.reference })
					for (const output of dest.outputs) {
						outputs.push({
							lockingScript: output.script,
							satoshis: output.satoshis,
							outputDescription: `Paymail payment to ${req.paymail}`,
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

			const result = await ctx.wallet.createAction({
				description: `Send ${requests.length} payment(s)`,
				outputs,
				options: { signAndProcess: true, acceptDelayedBroadcast: false },
			})

			if (!result.txid) {
				return { error: 'no-txid-returned' }
			}

			if (paymailRefs.length > 0 && result.tx) {
				await deliverP2P(paymailRefs, Utils.toHex(result.tx))
			}

			return {
				txid: result.txid,
				rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
			}
		} catch (error) {
			console.error('[sendBsv]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/** Input for sendAllBsv action */
export interface SendAllBsvInput {
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
				return { error: 'sendAllBsv does not support paymail — use sendBsv with a fixed amount' }
			}

			const result = await ctx.wallet.createAction({
				description: 'Send all BSV',
				outputs: [
					{
						lockingScript: new P2PKH().lock(destination).toHex(),
						satoshis: maxPossibleSatoshis,
						outputDescription: 'Sweep all funds',
						tags: [],
					},
				],
				options: { signAndProcess: true, acceptDelayedBroadcast: false },
			})

			if (!result.txid) {
				return { error: 'no-txid-returned' }
			}
			return {
				txid: result.txid,
				rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
			}
		} catch (error) {
			console.error('[sendAllBsv]', error)
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
