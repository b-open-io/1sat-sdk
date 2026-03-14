/**
 * Signing Module
 *
 * Actions for BSM (Bitcoin Signed Message) signing.
 */

import { BSM, BigNumber, PublicKey, Signature, Utils } from '@bsv/sdk'
import { MESSAGE_SIGNING_PROTOCOL } from '../constants'
import type { Action } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface SignBsmRequest {
	/** Message to sign */
	message: string
	/** Message encoding */
	encoding?: 'utf8' | 'hex' | 'base64'
	/** Derivation tag for key selection */
	tag?: {
		label: string
		id: string
		domain: string
		meta: Record<string, string>
	}
}

export interface SignedMessage {
	address: string
	pubKey: string
	message: string
	sig: string
	derivationTag?: SignBsmRequest['tag']
}

export interface SignBsmResponse extends Partial<SignedMessage> {
	error?: string
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Sign a message using BSM (Bitcoin Signed Message) format.
 */
export const signBsm: Action<SignBsmRequest, SignBsmResponse> = {
	meta: {
		name: 'signBsm',
		description: 'Sign a message using BSM (Bitcoin Signed Message) format',
		category: 'signing',
		inputSchema: {
			type: 'object',
			properties: {
				message: { type: 'string', description: 'Message to sign' },
				encoding: {
					type: 'string',
					description: 'Message encoding (utf8, hex, base64)',
					enum: ['utf8', 'hex', 'base64'],
				},
				tag: {
					type: 'object',
					description: 'Derivation tag for key selection',
					properties: {
						label: { type: 'string' },
						id: { type: 'string' },
						domain: { type: 'string' },
						meta: { type: 'object' },
					},
				},
			},
			required: ['message'],
		},
	},
	async execute(ctx, input) {
		try {
			const { message, encoding = 'utf8', tag } = input
			const messageBytes = Utils.toArray(message, encoding)
			const msgHash = BSM.magicHash(messageBytes)
			const keyID = tag ? `${tag.label}:${tag.id}:${tag.domain}` : 'identity'

			const result = await ctx.wallet.createSignature({
				protocolID: MESSAGE_SIGNING_PROTOCOL,
				keyID,
				counterparty: 'self',
				hashToDirectlySign: Array.from(msgHash),
			})

			const pubKeyResult = await ctx.wallet.getPublicKey({
				protocolID: MESSAGE_SIGNING_PROTOCOL,
				keyID,
				forSelf: true,
			})

			const publicKey = PublicKey.fromString(pubKeyResult.publicKey)
			const signature = Signature.fromDER(result.signature)
			const recovery = signature.CalculateRecoveryFactor(
				publicKey,
				new BigNumber(msgHash),
			)

			return {
				address: publicKey.toAddress(),
				pubKey: publicKey.toString(),
				message,
				sig: signature.toCompact(recovery, true, 'base64') as string,
				derivationTag: tag,
			}
		} catch (error) {
			console.error('[signBsm]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

// ============================================================================
// Module exports
// ============================================================================

/** All signing actions for registry */
export const signingActions = [signBsm]

// Signing helpers
export { applyAip, applyBapAip, resolveCurrentKeyId } from './aip'
export { applySigma } from './sigma'
