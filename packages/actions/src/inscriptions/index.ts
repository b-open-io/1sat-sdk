/**
 * Inscriptions Module
 *
 * Actions for creating inscriptions.
 */

import { Inscription, MAP as MAPTemplate } from '@1sat/templates'
import type { Destination } from '@1sat/types'
import { type LockingScript, P2PKH, PublicKey, Script, Utils } from '@bsv/sdk'
import {
	MAX_INSCRIPTION_BYTES,
	ORDINALS_BASKET,
	P1SAT_PROTOCOL,
	SIGMA_BASKET,
} from '../constants'
import { applySigma } from '../signing/sigma'
import type { Action, ActionOptions, OneSatContext } from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { resolveDestination } from '../utils/resolveDestination'
import { signP2PKHInput } from '../utils/signP2PKH'

// ============================================================================
// Types
// ============================================================================

export interface InscribeRequest extends ActionOptions {
	/** Base64 encoded content */
	base64Content: string
	/** Content type (MIME type) */
	contentType: string
	/** Optional MAP metadata */
	map?: Record<string, string>
	/** Sign with BAP identity (Sigma protocol) */
	signWithBAP?: boolean
	/** Where to lock the inscription output. Defaults to self. */
	destination?: Destination
}

export interface InscribeResponse {
	txid?: string
	tx?: number[]
	error?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

function buildInscriptionScript(
	lockingScript: LockingScript,
	base64Content: string,
	contentType: string,
	map?: Record<string, string>,
): Script {
	const content = Utils.toArray(base64Content, 'base64')

	// Build suffix: caller-provided locking script + optional MAP
	const suffix = new Script()
	for (const chunk of lockingScript.chunks) suffix.chunks.push(chunk)
	if (map && Object.keys(map).length > 0) {
		const mapScript = MAPTemplate.set(map)
		for (const chunk of mapScript.chunks) suffix.chunks.push(chunk)
	}

	const inscription = Inscription.create(new Uint8Array(content), contentType, {
		scriptSuffix: suffix,
	})
	return new Script(inscription.lock().chunks)
}

async function inscribeWithSigma(
	ctx: OneSatContext,
	lockingScript: Script,
	tags: string[],
	input: InscribeRequest,
	outputCustomInstructions?: string,
	outputKeyIDForLog?: string,
): Promise<InscribeResponse> {
	const anchorKeyID = `anchor-${Date.now()}`
	const { publicKey: anchorPubKey } = await ctx.wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID: anchorKeyID,
		counterparty: 'self',
		forSelf: true,
	})
	const anchorAddress = PublicKey.fromString(anchorPubKey).toAddress()
	const anchorLockingScript = new P2PKH().lock(anchorAddress)

	// Step 1: Create anchor tx (signed, not broadcast). The anchor is a
	// 2-sat lock-in UTXO that exists only so the inscription tx in step 2
	// can spend it to produce a Sigma signature — it is NOT a P1SAT
	// operation. Bypass the P1SAT label/tracking so the permission module
	// does not dispatch a preview popup for this internal plumbing step.
	const anchorResult = await executeTrackedAction(
		ctx.wallet,
		{
			description: 'Sigma anchor output',
			outputs: [
				{
					lockingScript: anchorLockingScript.toHex(),
					satoshis: 2,
					outputDescription: 'Sigma anchor',
					basket: SIGMA_BASKET,
					customInstructions: JSON.stringify({
						protocolID: P1SAT_PROTOCOL,
						keyID: anchorKeyID,
					}),
				},
			],
			options: {
				noSend: true,
				randomizeOutputs: false,
				acceptDelayedBroadcast: true,
			},
		},
		input.fundingProvider,
		undefined,
		undefined,
		{ bypassP1Sat: true },
	)

	if (!anchorResult.txid) {
		return { error: 'anchor-no-txid' }
	}

	// Compute the Sigma signature using the anchor outpoint. The signature
	// binds to (anchorTxid, vout=0) so it can only be valid in this tx,
	// which is committed to spending that exact input.
	const sigmaScript = await applySigma(
		ctx,
		new Script(lockingScript.chunks),
		{ txid: anchorResult.txid, vout: 0 },
		0, // targetVout — inscription is output 0
		0, // refVin — anchor input is vin 0
	)

	// Step 2: Create inscription tx, spending the anchor and broadcasting both.
	// The anchor is an internal plumbing output — not surfaced to the user
	// as an asset input. Preview renders from the inscription output's tags.
	const result = await executeTrackedAction(
		ctx.wallet,
		{
			description: 'Create inscription',
			inputBEEF: anchorResult.tx,
			inputs: [
				{
					outpoint: `${anchorResult.txid}.0`,
					inputDescription: 'Sigma anchor',
					unlockingScriptLength: 108,
				},
			],
			outputs: [
				{
					lockingScript: sigmaScript.toHex(),
					satoshis: 1,
					outputDescription: 'Inscription',
					basket: ORDINALS_BASKET,
					tags,
					customInstructions: outputCustomInstructions,
				},
			],
			options: {
				randomizeOutputs: false,
				noSend: true,
				noSendChange: anchorResult.noSendChange,
				knownTxids: [anchorResult.txid],
				acceptDelayedBroadcast: true,
				trustSelf: 'known',
				sendWith: [anchorResult.txid],
			},
		},
		input.fundingProvider,
		anchorResult.tx as number[],
		async (tx) => {
			const unlocking = await signP2PKHInput(
				ctx,
				tx,
				0,
				P1SAT_PROTOCOL,
				anchorKeyID,
			)
			if (typeof unlocking !== 'string') throw new Error(unlocking.error)
			return { 0: { unlockingScript: unlocking } }
		},
	)

	if (ctx.debug && ctx.log) {
		ctx.log({
			timestamp: new Date().toISOString(),
			action: 'inscribe',
			input: {
				contentType: input.contentType,
				map: input.map,
				signWithBAP: true,
				anchorTxid: anchorResult.txid,
			},
			txid: result.txid,
			rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
			outputs: [
				{
					index: 0,
					protocolID: P1SAT_PROTOCOL,
					keyID: outputKeyIDForLog,
					basket: ORDINALS_BASKET,
					satoshis: 1,
				},
			],
		})
	}

	return result
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Create an inscription.
 */
export const inscribe: Action<InscribeRequest, InscribeResponse> = {
	meta: {
		name: 'inscribe',
		description: 'Create a new inscription with the given content and type',
		category: 'inscriptions',
		inputSchema: {
			type: 'object',
			properties: {
				base64Content: {
					type: 'string',
					description: 'Base64 encoded content',
				},
				contentType: {
					type: 'string',
					description: 'Content type (MIME type)',
				},
				map: {
					type: 'object',
					description: 'Optional MAP metadata',
					properties: {},
				},
				signWithBAP: {
					type: 'boolean',
					description: 'Sign with BAP identity (Sigma protocol)',
				},
				destination: {
					type: 'object',
					description:
						'Where to lock the inscription output. One of lockingScript (hex), counterparty (pubkey), or address. Defaults to self.',
				},
			},
			required: ['base64Content', 'contentType'],
		},
	},
	async execute(ctx, input) {
		try {
			const decoded = Utils.toArray(input.base64Content, 'base64')
			if (decoded.length > MAX_INSCRIPTION_BYTES) {
				return {
					error: `Inscription data too large: ${decoded.length} bytes (max ${MAX_INSCRIPTION_BYTES})`,
				}
			}

			const resolved = await resolveDestination(ctx, input.destination, {
				protocolID: P1SAT_PROTOCOL,
				keyIDPrefix: 'inscribe',
			})

			const lockingScript = buildInscriptionScript(
				resolved.lockingScript,
				input.base64Content,
				input.contentType,
				input.map,
			)

			const tags = [`type:${input.contentType}`, 'origin']
			if (input.map?.name) {
				tags.push(`name:${input.map.name}`)
			}

			const customInstructions = resolved.customInstructions
				? JSON.stringify({
						protocolID: resolved.customInstructions.protocolID,
						keyID: resolved.customInstructions.keyID,
						...(resolved.customInstructions.counterparty !== undefined && {
							counterparty: resolved.customInstructions.counterparty,
						}),
						...(input.map?.name && { name: input.map.name.slice(0, 64) }),
					})
				: undefined

			if (input.signWithBAP) {
				return await inscribeWithSigma(
					ctx,
					lockingScript,
					tags,
					input,
					customInstructions,
					resolved.customInstructions?.keyID,
				)
			}

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: 'Create inscription',
					outputs: [
						{
							lockingScript: lockingScript.toHex(),
							satoshis: 1,
							outputDescription: 'Inscription',
							basket: ORDINALS_BASKET,
							tags,
							customInstructions,
						},
					],
					options: {
						acceptDelayedBroadcast: false,
						randomizeOutputs: false,
					},
				},
				input.fundingProvider,
			)

			if (!result.txid) {
				return { error: 'no-txid-returned' }
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'inscribe',
					input: {
						contentType: input.contentType,
						map: input.map,
						destination: input.destination,
					},
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: P1SAT_PROTOCOL,
							keyID: resolved.customInstructions?.keyID,
							basket: ORDINALS_BASKET,
							satoshis: 1,
						},
					],
				})
			}

			return {
				txid: result.txid,
				tx: result.tx,
			}
		} catch (error) {
			console.error('[inscribe]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'inscribe',
					input: { contentType: input.contentType, map: input.map },
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

/** All inscription actions for registry */
export const inscriptionsActions = [inscribe]
