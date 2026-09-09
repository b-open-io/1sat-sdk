/**
 * Payments Module
 *
 * Actions for sending BSV payments.
 */

import { Inscription } from '@1sat/templates'
import { parseOutpoint } from '@1sat/utils'
import {
	type CreateActionArgs,
	type CreateActionOutput,
	P2PKH,
	PrivateKey,
	Script,
	Transaction,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import type { FundingProvider } from '../funding/index.js'
import { getP2pPaymentDestination, sendBeefP2P } from '../paymail.js'
import type { Action, ActionOptions } from '../types.js'

/**
 * Plain BSV sends don't carry any P1Sat semantics — no asset inputs,
 * no basketed outputs, no two-phase signing. They should not surface
 * through the 1Sat permission module. We bypass `executeTrackedAction`
 * (which would add the `'p 1sat action'` dispatch label) and call
 * `wallet.createAction` directly, preserving `fundingProvider` support
 * for callers that fund payments externally.
 */
async function dispatchPlainPayment(
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

function isInsufficientFunds(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error)
	return /insufficient/i.test(msg)
}

async function listDefaultBasketSpendable(
	wallet: WalletInterface,
): Promise<Array<{ satoshis: number; outpoint: string }>> {
	const utxos: Array<{ satoshis: number; outpoint: string }> = []
	let offset = 0
	for (;;) {
		const page = await wallet.listOutputs({
			basket: 'default',
			limit: 1000,
			offset,
		})
		for (const output of page.outputs) {
			if (output.spendable === false || !output.outpoint) continue
			utxos.push({ satoshis: output.satoshis, outpoint: output.outpoint })
		}
		offset += page.outputs.length
		if (page.outputs.length === 0 || offset >= page.totalOutputs) break
	}
	return utxos
}

async function sweepFeeForUtxos(
	destination: string,
	utxos: Array<{ satoshis: number; outpoint: string }>,
): Promise<number> {
	const p2pkh = new P2PKH()
	const unlockingScriptTemplate = p2pkh.unlock(PrivateKey.fromRandom())
	const destScript = p2pkh.lock(destination)
	const tx = new Transaction()
	for (const utxo of utxos) {
		const { txid, vout } = parseOutpoint(utxo.outpoint)
		const source = new Transaction()
		for (let i = 0; i < vout; i++) {
			source.addOutput({ lockingScript: destScript, satoshis: 0 })
		}
		source.addOutput({ lockingScript: destScript, satoshis: utxo.satoshis })
		tx.addInput({
			sourceTXID: txid,
			sourceOutputIndex: vout,
			sourceTransaction: source,
			unlockingScriptTemplate,
		})
	}
	tx.addOutput({ lockingScript: destScript, change: true })
	await tx.fee()
	return tx.getFee()
}

// ============================================================================
// Types
// ============================================================================

export interface SendBsvRequest extends ActionOptions {
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
	tx?: number[]
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

async function deliverP2P(refs: PaymailRef[], beefHex: string): Promise<void> {
	for (const ref of refs) {
		await sendBeefP2P(ref.paymail, beefHex, ref.reference)
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
				// createAction returns AtomicBEEF (BRC-95) but BRC-70 `receive-beef`
				// expects plain BEEF (BRC-62). Strip the atomic wrapper.
				const beefHex = Utils.toHex(
					Transaction.fromAtomicBEEF(result.tx).toBEEF(),
				)
				await deliverP2P(paymailRefs, beefHex)
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

			const utxos = await listDefaultBasketSpendable(ctx.wallet)
			const total = utxos.reduce((sum, u) => sum + u.satoshis, 0)
			if (utxos.length === 0 || total <= 0) {
				return { error: 'insufficient-funds' }
			}

			const lockingScript = new P2PKH().lock(destination).toHex()
			let fee = await sweepFeeForUtxos(destination, utxos)
			let result: { txid?: string; tx?: number[] } | undefined
			for (let attempt = 0; attempt < 20; attempt++) {
				const satoshis = total - fee
				if (satoshis <= 0) {
					return { error: 'insufficient-funds' }
				}
				try {
					result = await dispatchPlainPayment(
						ctx.wallet,
						{
							description: 'Send all BSV',
							outputs: [
								{
									lockingScript,
									satoshis,
									outputDescription: 'Sweep all funds',
									tags: [],
								},
							],
							options: { acceptDelayedBroadcast: false },
						},
						input.fundingProvider,
					)
					break
				} catch (error) {
					if (!isInsufficientFunds(error)) throw error
					fee += 1
				}
			}

			if (!result?.txid) {
				return { error: result ? 'no-txid-returned' : 'insufficient-funds' }
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
