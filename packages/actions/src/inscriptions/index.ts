/**
 * Inscriptions Module
 *
 * Actions for creating inscriptions.
 */

import { Inscription, MAP as MAPTemplate } from '@bopen-io/templates'
import { P2PKH, PublicKey, Script, Utils } from '@bsv/sdk'
import {
	MAX_INSCRIPTION_BYTES,
	ONESAT_PROTOCOL,
	ORDINALS_BASKET,
} from '../constants'
import type { Action } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface InscribeRequest {
	/** Base64 encoded content */
	base64Content: string
	/** Content type (MIME type) */
	contentType: string
	/** Optional MAP metadata */
	map?: Record<string, string>
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

			// Build tags - type is always included, name from MAP if provided
			const tags = [`type:${input.contentType}`]
			if (input.map?.name) {
				tags.push(`name:${input.map.name}`)
			}

			const result = await ctx.wallet.createAction({
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
			console.error('[inscribe]', error)
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
