/**
 * OpNS paid mining via a mine service (go-opns-mint).
 *
 * Payment is atomic with delivery: the buyer signs a noSend payment
 * transaction (P) paying the service's BRC-29 derived output; the service
 * spends P's output as a funding input of the final mint transaction (M)
 * and broadcasts the pair together. P only reaches the network when the
 * name does. The name inscription is delivered to the buyer's P1SAT
 * deposit address, so standard ordinals ingestion recovers it even if the
 * response is lost; internalizing M here is the fast path.
 */

import { P1SAT_PROTOCOL } from '@1sat/types'
import { P2PKH, PublicKey, Utils, type WalletInterface } from '@bsv/sdk'
import { AuthFetch } from '@bsv/sdk/auth'
import { OPNS_BASKET } from '../constants'
import type { Action, ActionOptions } from '../types'
import { completeSignedAction } from '../utils/completeSignedAction'
import { createTrackedAction } from '../utils/createTrackedAction'

// ============================================================================
// Types
// ============================================================================

export interface OpnsMineRequest extends ActionOptions {
	/** Name to mine (lowercase a-z, 0-9, hyphen) */
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

export interface OpnsMineJob {
	id: string
	name: string
	state: string
	priceSats: number
	derivationPrefix: string
	derivationSuffix: string
	serverIdentityKey: string
	mintTxid?: string
	mintBeef?: string
	error?: string
}

export interface OpnsMineResponse {
	/** Job id — use opnsMineStatus to recover if state is not complete */
	jobId?: string
	state?: string
	/** Txid of the mint transaction delivering the name */
	txid?: string
	error?: string
}

export interface OpnsMineStatusRequest extends ActionOptions {
	jobId: string
	serviceUrl: string
	/** Receive address the job was created with (for internalize custom instructions) */
	receiveAddress?: string
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

async function postJSON(
	authFetch: AuthFetch,
	url: string,
	body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
	const response = await authFetch.fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	return { status: response.status, json: await response.json() }
}

/**
 * Internalize the mint transaction: the name inscription (output 2) enters
 * the opns basket with custom instructions matching the deposit derivation
 * so opnsRegister/transfer can sign later.
 */
async function internalizeMint(
	wallet: WalletInterface,
	job: { mintBeef?: string; name?: string },
): Promise<string | undefined> {
	if (!job.mintBeef) return undefined
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
					tags: ['opns'],
				},
			},
		],
		description: `opns name ${job.name ?? ''}`.trim(),
	})
	return undefined
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Have the mine service mine an OpNS name for this wallet, paid atomically:
 * create job → sign noSend payment to the service's derived output → the
 * service mines and broadcasts payment + mint together → internalize the
 * name.
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
					description: 'Name to mine (lowercase a-z, 0-9, hyphen)',
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

			// Create (or resume, idempotently) the job.
			const created = await postJSON(authFetch, `${serviceUrl}/jobs`, {
				name: input.name,
				receiveAddress,
			})
			if (created.status !== 200 && created.status !== 201) {
				return {
					error:
						(created.json.error as string) ??
						`job creation failed (${created.status})`,
				}
			}
			const job = created.json as unknown as OpnsMineJob

			// Build the noSend payment to the service's BRC-29 derived output.
			const { publicKey: derivedPublicKey } = await ctx.wallet.getPublicKey({
				protocolID: [2, '3241645161d8'],
				keyID: `${job.derivationPrefix} ${job.derivationSuffix}`,
				counterparty: job.serverIdentityKey,
			})
			const lockingScript = new P2PKH()
				.lock(PublicKey.fromString(derivedPublicKey).toAddress())
				.toHex()

			const createResult = await createTrackedAction(ctx.wallet, {
				description: `opns mine ${input.name}`,
				outputs: [
					{
						satoshis: job.priceSats,
						lockingScript,
						customInstructions: JSON.stringify({
							derivationPrefix: job.derivationPrefix,
							derivationSuffix: job.derivationSuffix,
							payee: job.serverIdentityKey,
						}),
						outputDescription: `opns mine payment ${input.name}`,
					},
				],
				options: { randomizeOutputs: false },
			})

			const reference = createResult.signableTransaction?.reference
			const signed = await completeSignedAction(
				ctx.wallet,
				createResult,
				undefined,
				async () => ({}),
				{ noSend: true },
			)
			if (!signed.tx) {
				return { error: 'payment signing returned no transaction' }
			}

			// Submit the payment; the service mines the final char and
			// broadcasts payment + mint together.
			const paid = await postJSON(
				authFetch,
				`${serviceUrl}/jobs/${job.id}/pay`,
				{ beef: Utils.toBase64(signed.tx) },
			)

			if (paid.status === 400 || paid.status === 409) {
				// Payment rejected or job dead pre-broadcast — release the
				// allocated payment inputs.
				if (reference) {
					await ctx.wallet.abortAction({ reference }).catch(() => {})
				}
				return {
					jobId: job.id,
					state: paid.json.state as string,
					error:
						(paid.json.error as string) ?? `payment rejected (${paid.status})`,
				}
			}

			let current = paid.json as unknown as OpnsMineJob

			// Poll until complete or timeout. On timeout the payment stays
			// intact: the service may still deliver, and opnsMineStatus
			// recovers the result.
			const deadline = Date.now() + (input.timeoutMs ?? 300000)
			while (current.state !== 'complete' && Date.now() < deadline) {
				if (current.state === 'failed') {
					if (reference) {
						await ctx.wallet.abortAction({ reference }).catch(() => {})
					}
					return { jobId: job.id, state: current.state, error: current.error }
				}
				if (current.state === 'refund_due') {
					// Payment broadcast but the name was lost — do NOT abort.
					return { jobId: job.id, state: current.state, error: current.error }
				}
				await new Promise((resolve) => setTimeout(resolve, 2000))
				const polled = await authFetch.fetch(`${serviceUrl}/jobs/${job.id}`, {
					method: 'GET',
				})
				current = (await polled.json()) as OpnsMineJob
			}

			if (current.state !== 'complete') {
				return {
					jobId: job.id,
					state: current.state,
					error: 'timed out waiting for mining; recover with opnsMineStatus',
				}
			}

			await internalizeMint(ctx.wallet, current)
			return { jobId: job.id, state: current.state, txid: current.mintTxid }
		} catch (error) {
			console.error('[opnsMine]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Recover a mine job: fetch its state and internalize the name if the
 * original response was lost.
 */
export const opnsMineStatus: Action<OpnsMineStatusRequest, OpnsMineResponse> = {
	meta: {
		name: 'opnsMineStatus',
		description: 'Check a mine job and internalize the name if complete',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				jobId: { type: 'string', description: 'Job id from opnsMine' },
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
				`${serviceUrl}/jobs/${input.jobId}`,
				{ method: 'GET' },
			)
			const job = (await response.json()) as OpnsMineJob
			if (response.status !== 200) {
				return { error: job.error ?? `status ${response.status}` }
			}
			if (job.state === 'complete') {
				await internalizeMint(ctx.wallet, job)
				return { jobId: job.id, state: job.state, txid: job.mintTxid }
			}
			return { jobId: job.id, state: job.state, error: job.error }
		} catch (error) {
			console.error('[opnsMineStatus]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}
