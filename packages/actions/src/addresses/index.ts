/**
 * Addresses Module
 *
 * Actions for deposit address derivation under P1SAT.
 */

import {
	type AddressDerivation,
	ONESAT_PROTOCOL,
	P1SAT_PROTOCOL,
} from '@1sat/types'
import { PublicKey, type WalletProtocol } from '@bsv/sdk'
import type { Action } from '../types.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Default keyID prefix for deposit-address derivation. Picked so any
 * wallet binding the same identity key (yours-wallet, wallet-desktop,
 * CLI, MCP server, etc.) derives the SAME default deposit addresses
 * without coordination. Callers only need to supply a custom prefix
 * when they want a distinct address set for some other purpose.
 */
export const DEFAULT_DEPOSIT_PREFIX = '1sat'

export interface DeriveDepositAddressesInput {
	/**
	 * KeyID prefix string. Defaults to {@link DEFAULT_DEPOSIT_PREFIX}
	 * (`"1sat"`) when omitted. Supply a custom prefix only to derive a
	 * separate address set (e.g. `"mcp"`, app-specific tags).
	 */
	prefix?: string
	/** First index to derive (default: 0) */
	startIndex?: number
	/** Number of addresses to derive (default: 1) */
	count?: number
	/**
	 * BRC-42 derivation protocol. Defaults to {@link ONESAT_PROTOCOL}
	 * (`[0, 'onesat']`). Pass {@link LEGACY_ONESAT_PROTOCOL} (`[0, 'p 1sat']`)
	 * to recover the pre-rename address set, e.g. when scanning for funds
	 * deposited before the protocol rename.
	 */
	protocolID?: WalletProtocol
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
					description:
						'KeyID prefix string. Defaults to "1sat" so any wallet binding the same identity key derives the same default addresses; pass a custom value only for a distinct address set.',
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
			required: [],
		},
	},
	async execute(ctx, input) {
		const {
			prefix = DEFAULT_DEPOSIT_PREFIX,
			startIndex = 0,
			count = 1,
			protocolID = ONESAT_PROTOCOL,
		} = input

		const { publicKey: senderIdentityKey } = await ctx.wallet.getPublicKey({
			identityKey: true,
		})

		const derivations: AddressDerivation[] = []

		for (let i = startIndex; i < startIndex + count; i++) {
			const derivationSuffix = String(i)
			const keyID = `${prefix} ${derivationSuffix}`

			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID,
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
