/**
 * Addresses Module
 *
 * Actions for deposit address derivation under P1SAT.
 */

import { type AddressDerivation, P1SAT_PROTOCOL } from '@1sat/types'
import { PublicKey } from '@bsv/sdk'
import type { Action } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface DeriveDepositAddressesInput {
	/** KeyID prefix string (e.g., "yours", "1sat", "mcp") */
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
 * Derive deposit addresses from the wallet's identity key under P1SAT.
 * KeyID format: `<prefix> <index>` (plaintext, no base64).
 */
export const deriveDepositAddresses: Action<
	DeriveDepositAddressesInput,
	DeriveDepositAddressesResult
> = {
	meta: {
		name: 'deriveDepositAddresses',
		description:
			'Derive P1SAT deposit addresses for receiving payments, ordinals, or tokens',
		category: 'addresses',
		inputSchema: {
			type: 'object',
			properties: {
				prefix: {
					type: 'string',
					description: 'KeyID prefix string (e.g., "yours", "1sat", "mcp")',
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

		const derivations: AddressDerivation[] = []

		for (let i = startIndex; i < startIndex + count; i++) {
			const derivationSuffix = String(i)
			const keyID = `${prefix} ${derivationSuffix}`

			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: P1SAT_PROTOCOL,
				keyID,
				forSelf: true,
			})

			derivations.push({
				address: PublicKey.fromString(publicKey).toAddress(),
				index: i,
				derivationPrefix: prefix,
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

export { type AddressDerivation, P1SAT_PROTOCOL }

/** All address actions for registry */
export const addressesActions = [deriveDepositAddresses]
