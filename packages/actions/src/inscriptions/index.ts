/**
 * Inscriptions Module
 *
 * Actions for creating inscriptions.
 */

import { Inscription, MAP as MAPTemplate } from '@1sat/templates'
import { P2PKH, PublicKey, Script, Utils } from '@bsv/sdk'
import {
	MAX_INSCRIPTION_BYTES,
	ONESAT_PROTOCOL,
	ORDINALS_BASKET,
	SIGMA_BASKET,
} from '../constants'
import { applySigma } from '../signing/sigma'
import type { Action, ActionOptions, OneSatContext } from '../types'
import { completeSignedAction } from '../utils/completeSignedAction'
import { executeTrackedAction } from '../utils/createTrackedAction'
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
}

export interface InscribeResponse {
	txid?: string
	rawtx?: string
	error?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

function buildInscriptionScript(
	address: string,
	base64Content: string,
	contentType: string,
	map?: Record<string, string>,
): Script {
	const content = Utils.toArray(base64Content, 'base64')
	const p2pkhScript = new P2PKH().lock(address)

	// Build suffix: P2PKH + optional MAP
	const suffix = new Script()
	for (const chunk of p2pkhScript.chunks) suffix.chunks.push(chunk)
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
	keyID: string,
	tags: string[],
	input: InscribeRequest,
): Promise<InscribeResponse> {
	const anchorKeyID = `anchor-${keyID}`
	const { publicKey: anchorPubKey } = await ctx.wallet.getPublicKey({
		protocolID: ONESAT_PROTOCOL,
		keyID: anchorKeyID,
		counterparty: 'self',
		forSelf: true,
	})
	const anchorAddress = PublicKey.fromString(anchorPubKey).toAddress()
	const anchorLockingScript = new P2PKH().lock(anchorAddress)

	// Step 1: Create anchor tx (signed, not broadcast)
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
						protocolID: ONESAT_PROTOCOL,
						keyID: anchorKeyID,
					}),
				},
			],
			options: {
				signAndProcess: true,
				noSend: true,
				randomizeOutputs: false,
				acceptDelayedBroadcast: true,
			},
		},
		input.fundingProvider,
	)

	if (!anchorResult.txid) {
		return { error: 'anchor-no-txid' }
	}

	// Step 2: Apply Sigma signature using anchor outpoint
	const sigmaScript = await applySigma(
		ctx,
		lockingScript,
		{ txid: anchorResult.txid, vout: 0 },
		0, // targetVout — inscription is output 0
		0, // refVin — anchor input is vin 0
	)

	// Step 3: Create inscription tx, spending the anchor and broadcasting both
	const inscribeResult = await executeTrackedAction(
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
					customInstructions: JSON.stringify({
						protocolID: ONESAT_PROTOCOL,
						keyID,
						...(input.map?.name && { name: input.map.name.slice(0, 64) }),
					}),
				},
			],
			options: {
				signAndProcess: false,
				randomizeOutputs: false,
				noSend: true,
				noSendChange: anchorResult.noSendChange,
				knownTxids: [anchorResult.txid],
				acceptDelayedBroadcast: true,
				trustSelf: 'known',
			},
		},
		input.fundingProvider,
	)

	if ('error' in inscribeResult && inscribeResult.error) {
		return { error: String(inscribeResult.error) }
	}

	const result = await completeSignedAction(
		ctx.wallet,
		inscribeResult,
		anchorResult.tx as number[],
		async (tx) => {
			const unlocking = await signP2PKHInput(
				ctx,
				tx,
				0,
				ONESAT_PROTOCOL,
				anchorKeyID,
			)
			if (typeof unlocking !== 'string') throw new Error(unlocking.error)
			return { 0: { unlockingScript: unlocking } }
		},
		{
			acceptDelayedBroadcast: true,
			sendWith: [anchorResult.txid],
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
			rawtx: result.rawtx,
			outputs: [
				{
					index: 0,
					protocolID: ONESAT_PROTOCOL,
					keyID,
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

			const keyID = Date.now().toString()
			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: ONESAT_PROTOCOL,
				keyID,
				counterparty: 'self',
				forSelf: true,
			})
			const address = PublicKey.fromString(publicKey).toAddress()

			const lockingScript = buildInscriptionScript(
				address,
				input.base64Content,
				input.contentType,
				input.map,
			)

			const tags = [`type:${input.contentType}`, 'origin']
			if (input.map?.name) {
				tags.push(`name:${input.map.name}`)
			}

			if (input.signWithBAP) {
				return await inscribeWithSigma(ctx, lockingScript, keyID, tags, input)
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
							customInstructions: JSON.stringify({
								protocolID: ONESAT_PROTOCOL,
								keyID,
								...(input.map?.name && { name: input.map.name.slice(0, 64) }),
							}),
						},
					],
					options: {
						signAndProcess: true,
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
					input: { contentType: input.contentType, map: input.map },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: ONESAT_PROTOCOL,
							keyID,
							basket: ORDINALS_BASKET,
							satoshis: 1,
						},
					],
				})
			}

			return {
				txid: result.txid,
				rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
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
