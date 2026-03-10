/**
 * Addresses Module
 *
 * Actions for BRC-29 deposit address derivation.
 */

import { type AddressDerivation, BRC29_PROTOCOL_ID } from '@1sat/types'
import { PublicKey, Utils } from '@bsv/sdk'
import type { Action } from '../types'

// ============================================================================
// Encoding helpers
// ============================================================================

function toBase64Prefix(prefix: string): string {
	return Utils.toBase64(Array.from(new TextEncoder().encode(prefix)))
}

function toBase64Suffix(index: number): string {
	return Utils.toBase64([
		(index >>> 24) & 0xff,
		(index >>> 16) & 0xff,
		(index >>> 8) & 0xff,
		index & 0xff,
	])
}

// ============================================================================
// Types
// ============================================================================

export interface DeriveDepositAddressesInput {
	/** Derivation prefix string (e.g., "yours", "1sat", "mcp") */
	prefix: string
	/** First index to derive (default: 0) */
	startIndex?: number
	/** Number of addresses to derive (default: 1) */
	count?: number
}

export interface DeriveDepositAddressesResult {
	derivations: AddressDerivation[]
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Derive BRC-29 deposit addresses from the wallet's identity key.
 */
export const deriveDepositAddresses: Action<
	DeriveDepositAddressesInput,
	DeriveDepositAddressesResult
> = {
	meta: {
		name: 'deriveDepositAddresses',
		description:
			'Derive BRC-29 deposit addresses for receiving payments, ordinals, or tokens',
		category: 'addresses',
		inputSchema: {
			type: 'object',
			properties: {
				prefix: {
					type: 'string',
					description:
						'Derivation prefix string (e.g., "yours", "1sat", "mcp")',
				},
				startIndex: {
					type: 'integer',
					description: 'First index to derive (default: 0)',
				},
				count: {
					type: 'integer',
					description: 'Number of addresses to derive (default: 1)',
				},
			},
			required: ['prefix'],
		},
	},
	async execute(ctx, input) {
		const { prefix, startIndex = 0, count = 1 } = input

		const { publicKey: senderIdentityKey } = await ctx.wallet.getPublicKey({
			identityKey: true,
		})

		const derivationPrefix = toBase64Prefix(prefix)
		const derivations: AddressDerivation[] = []

		for (let i = startIndex; i < startIndex + count; i++) {
			const derivationSuffix = toBase64Suffix(i)
			const keyID = `${derivationPrefix} ${derivationSuffix}`

			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: BRC29_PROTOCOL_ID,
				keyID,
				forSelf: true,
			})

			derivations.push({
				address: PublicKey.fromString(publicKey).toAddress(),
				index: i,
				derivationPrefix,
				derivationSuffix,
				senderIdentityKey,
				publicKey,
			})
		}

		return { derivations }
	},
}

// ============================================================================
// Module exports
// ============================================================================

export { type AddressDerivation, BRC29_PROTOCOL_ID }
export { toBase64Prefix, toBase64Suffix }

/** All address actions for registry */
export const addressesActions = [deriveDepositAddresses]
