/**
 * OpNS paid mining via a mine service (go-opns-mint).
 *
 * The buyer prepays the full price at job creation: POST /jobs answers 402
 * and AuthFetch pays it automatically via BRC-105. The payment txid is the
 * job ID. The service mines every character funded by that payment, delivers
 * the name inscription to the buyer's receive address, and — if the name is
 * lost to another miner — refunds the remaining job funds on request.
 */

import { P1SAT_PROTOCOL } from '@1sat/types'
import { PublicKey, Utils, type WalletInterface } from '@bsv/sdk'
import { AuthFetch } from '@bsv/sdk/auth'
import { OPNS_BASKET } from '../constants'
import type { Action, ActionOptions } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface OpnsMineRequest extends ActionOptions {
	/** Name to mine */
	name: string
	/** Base URL of the mine service, e.g. https://mine.example.com */
	serviceUrl: string
	/**
	 * Address to receive the name inscription. Defaults to the wallet's
	 * P1SAT deposit address (keyID "1sat 0").
	 */
	receiveAddress?: string
	/** How long to wait for mining to complete (default: 300000 ms) */
	timeoutMs?: number
}

/** GET /jobs/:id payload */
export interface OpnsMineJob {
	jobId: string
	name?: string
	state: 'mining' | 'failed' | 'complete' | 'refunded'
	satoshisRemaining?: number
	charsRemaining?: number
	mintTxid?: string
	mintBeef?: string
	refund?: {
		txid: string
		satoshis: number
		derivationPrefix: string
		derivationSuffix: string
		senderIdentityKey: string
		beef?: string
	}
	error?: string
}

export interface OpnsMineResponse {
	/** Job id (= payment txid) — recover later with opnsMineStatus */
	jobId?: string
	state?: string
	/** Txid of the mint transaction delivering the name */
	txid?: string
	error?: string
}

export interface OpnsMineStatusRequest extends ActionOptions {
	jobId: string
	serviceUrl: string
}

export interface OpnsMineRefundRequest extends ActionOptions {
	jobId: string
	serviceUrl: string
}

export interface OpnsMineRefundResponse {
	jobId?: string
	/** Txid of the refund payment */
	txid?: string
	satoshis?: number
	error?: string
}

// ============================================================================
// Helpers
// ============================================================================

const DEPOSIT_KEY_ID = '1sat 0'

async function defaultReceive(wallet: WalletInterface): Promise<string> {
	const { publicKey } = await wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID: DEPOSIT_KEY_ID,
		forSelf: true,
	})
	return PublicKey.fromString(publicKey).toAddress()
}

/**
 * Internalize the mint transaction: the name inscription (output 2) enters
 * the opns basket with custom instructions matching the deposit derivation
 * so opnsRegister/transfer can sign later.
 */
async function internalizeMint(
	wallet: WalletInterface,
	job: OpnsMineJob,
): Promise<void> {
	if (!job.mintBeef) return
	await wallet.internalizeAction({
		tx: Utils.toArray(job.mintBeef, 'base64'),
		outputs: [
			{
				outputIndex: 2,
				protocol: 'basket insertion',
				insertionRemittance: {
					basket: OPNS_BASKET,
					customInstructions: JSON.stringify({
						protocolID: P1SAT_PROTOCOL,
						keyID: DEPOSIT_KEY_ID,
						counterparty: 'self',
					}),
					tags: [
						'opns',
						...(job.name ? [`name:${job.name.slice(0, 64)}`] : []),
					],
				},
			},
		],
		description: `opns name ${job.name ?? ''}`.trim(),
	})
}

/**
 * Internalize a refund as a BRC-29 wallet payment (the refund output is
 * always index 0).
 */
async function internalizeRefund(
	wallet: WalletInterface,
	job: OpnsMineJob,
): Promise<void> {
	if (!job.refund?.beef) return
	await wallet.internalizeAction({
		tx: Utils.toArray(job.refund.beef, 'base64'),
		outputs: [
			{
				outputIndex: 0,
				protocol: 'wallet payment',
				paymentRemittance: {
					derivationPrefix: job.refund.derivationPrefix,
					derivationSuffix: job.refund.derivationSuffix,
					senderIdentityKey: job.refund.senderIdentityKey,
				},
			},
		],
		description: `opns mine refund ${job.name ?? job.jobId}`.trim(),
	})
}

async function getJob(
	authFetch: AuthFetch,
	serviceUrl: string,
	jobId: string,
): Promise<{ status: number; job: OpnsMineJob }> {
	const response = await authFetch.fetch(`${serviceUrl}/jobs/${jobId}`, {
		method: 'GET',
	})
	return {
		status: response.status,
		job: (await response.json()) as OpnsMineJob,
	}
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Have the mine service mine an OpNS name to this wallet's receive address.
 * The full price is paid upfront via the BRC-105 payment flow (AuthFetch
 * handles the 402 automatically); the payment txid is the job ID.
 */
export const opnsMine: Action<OpnsMineRequest, OpnsMineResponse> = {
	meta: {
		name: 'opnsMine',
		description: 'Pay a mine service to mine an OpNS name into this wallet',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Name to mine',
				},
				serviceUrl: {
					type: 'string',
					description: 'Base URL of the mine service',
				},
				receiveAddress: {
					type: 'string',
					description:
						'Address to receive the name (default: P1SAT deposit address)',
				},
				timeoutMs: {
					type: 'integer',
					description: 'Wait for completion this long (default: 300000)',
				},
			},
			required: ['name', 'serviceUrl'],
		},
	},
	async execute(ctx, input) {
		try {
			const serviceUrl = input.serviceUrl.replace(/\/+$/, '')
			const authFetch = new AuthFetch(ctx.wallet)
			const receiveAddress =
				input.receiveAddress ?? (await defaultReceive(ctx.wallet))

			// AuthFetch pays the 402 challenge and retries automatically.
			const created = await authFetch.fetch(`${serviceUrl}/jobs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: input.name, receiveAddress }),
			})
			const createdJson = (await created.json()) as Record<string, unknown>
			if (created.status !== 200 && created.status !== 201) {
				return {
					error:
						(createdJson.error as string) ??
						`job creation failed (${created.status})`,
				}
			}
			const jobId = createdJson.jobId as string

			// Poll until the job resolves or we time out. On timeout the job
			// keeps mining server-side; opnsMineStatus recovers the result.
			const deadline = Date.now() + (input.timeoutMs ?? 300000)
			while (Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 2000))
				const { status, job } = await getJob(authFetch, serviceUrl, jobId)
				if (status !== 200) continue
				if (job.state === 'complete') {
					await internalizeMint(ctx.wallet, job)
					return { jobId, state: job.state, txid: job.mintTxid }
				}
				if (job.state === 'failed') {
					return {
						jobId,
						state: job.state,
						error:
							job.error ??
							'mining failed; remaining funds recoverable with opnsMineRefund',
					}
				}
				if (job.state === 'refunded') {
					await internalizeRefund(ctx.wallet, job)
					return { jobId, state: job.state, error: job.error }
				}
			}
			return {
				jobId,
				state: 'mining',
				error: 'timed out waiting for mining; recover with opnsMineStatus',
			}
		} catch (error) {
			console.error('[opnsMine]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Recover a mine job: fetch its state, internalizing the name (or an issued
 * refund) if the original response was lost.
 */
export const opnsMineStatus: Action<OpnsMineStatusRequest, OpnsMineResponse> = {
	meta: {
		name: 'opnsMineStatus',
		description: 'Check a mine job and internalize the name if complete',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				jobId: {
					type: 'string',
					description: 'Job id (payment txid) from opnsMine',
				},
				serviceUrl: {
					type: 'string',
					description: 'Base URL of the mine service',
				},
			},
			required: ['jobId', 'serviceUrl'],
		},
	},
	async execute(ctx, input) {
		try {
			const serviceUrl = input.serviceUrl.replace(/\/+$/, '')
			const authFetch = new AuthFetch(ctx.wallet)
			const { status, job } = await getJob(authFetch, serviceUrl, input.jobId)
			if (status !== 200) {
				return { error: job.error ?? `status ${status}` }
			}
			if (job.state === 'complete') {
				await internalizeMint(ctx.wallet, job)
				return { jobId: job.jobId, state: job.state, txid: job.mintTxid }
			}
			if (job.state === 'refunded') {
				await internalizeRefund(ctx.wallet, job)
			}
			return { jobId: job.jobId, state: job.state, error: job.error }
		} catch (error) {
			console.error('[opnsMineStatus]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Claim the remaining funds of a failed mine job. The service spends the
 * job's UTXO back to this wallet as a BRC-29 payment, internalized here.
 */
export const opnsMineRefund: Action<
	OpnsMineRefundRequest,
	OpnsMineRefundResponse
> = {
	meta: {
		name: 'opnsMineRefund',
		description: 'Claim the remaining funds of a failed mine job',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				jobId: {
					type: 'string',
					description: 'Job id (payment txid) from opnsMine',
				},
				serviceUrl: {
					type: 'string',
					description: 'Base URL of the mine service',
				},
			},
			required: ['jobId', 'serviceUrl'],
		},
	},
	async execute(ctx, input) {
		try {
			const serviceUrl = input.serviceUrl.replace(/\/+$/, '')
			const authFetch = new AuthFetch(ctx.wallet)
			const response = await authFetch.fetch(
				`${serviceUrl}/jobs/${input.jobId}/refund`,
				{ method: 'POST' },
			)
			const refund = (await response.json()) as OpnsMineJob['refund'] & {
				error?: string
			}
			if (response.status !== 200 || !refund?.beef) {
				return {
					jobId: input.jobId,
					error: refund?.error ?? `refund failed (${response.status})`,
				}
			}
			await internalizeRefund(ctx.wallet, {
				jobId: input.jobId,
				state: 'refunded',
				refund,
			})
			return {
				jobId: input.jobId,
				txid: refund.txid,
				satoshis: refund.satoshis,
			}
		} catch (error) {
			console.error('[opnsMineRefund]', error)
			return {
				jobId: input.jobId,
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}
