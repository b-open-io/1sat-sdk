/**
 * OpNS Module
 *
 * Actions for managing OpNS name identity bindings.
 * Registers/deregisters identity public keys on OpNS tokens via MAP metadata.
 */

import type { WalletOutput } from '@bsv/sdk'
import { buildTransferOrdinals } from '../ordinals'
import { ONESAT_PROTOCOL, OPNS_BASKET } from '../constants'
import type { Action } from '../types'
import { completeSignedAction } from '../utils/completeSignedAction'
import { signP2PKHInput } from '../utils/signP2PKH'

// ============================================================================
// Types
// ============================================================================

export interface OpnsRegisterRequest {
	/** The OpNS ordinal output to register (from listOutputs) */
	ordinal: WalletOutput
	/** BEEF data from listOutputs (include: 'entire transactions') */
	inputBEEF: number[]
}

export interface OpnsDeregisterRequest {
	/** The OpNS ordinal output to deregister (from listOutputs) */
	ordinal: WalletOutput
	/** BEEF data from listOutputs (include: 'entire transactions') */
	inputBEEF: number[]
}

export interface OpnsOperationResponse {
	txid?: string
	rawtx?: string
	error?: string
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Register an identity key on an OpNS name.
 * Transfers the OpNS ordinal to self with MAP metadata binding the wallet's
 * identity public key, then submits to the OpNS overlay.
 */
export const opnsRegister: Action<
	OpnsRegisterRequest,
	OpnsOperationResponse
> = {
	meta: {
		name: 'opnsRegister',
		description:
			'Register identity key on an OpNS name via MAP metadata',
		category: 'opns',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				ordinal: {
					type: 'object',
					description: 'WalletOutput of the OpNS ordinal from listOutputs',
				},
				inputBEEF: {
					type: 'array',
					description:
						"BEEF from listOutputs with include: 'entire transactions'",
				},
			},
			required: ['ordinal', 'inputBEEF'],
		},
	},
	async execute(ctx, input) {
		try {
			if (!ctx.services) {
				return { error: 'services-required' }
			}

			const { ordinal, inputBEEF } = input

			// Get wallet's identity public key
			const { publicKey: identityPubKey } = await ctx.wallet.getPublicKey({
				identityKey: true,
			})

			// Transfer to self with MAP identity binding
			const params = await buildTransferOrdinals(ctx, {
				transfers: [
					{
						ordinal,
						counterparty: 'self',
						map: {
							'opns.idKey': identityPubKey,
						},
						extraTags: ['opns:published'],
					},
				],
				inputBEEF,
			})

			if ('error' in params) {
				return params
			}

			const createResult = await ctx.wallet.createAction({
				...params,
				options: { signAndProcess: false, randomizeOutputs: false },
			})

			if ('error' in createResult && createResult.error) {
				return { error: String(createResult.error) }
			}

			if (!ordinal.customInstructions) {
				return { error: 'missing-custom-instructions' }
			}

			const { protocolID, keyID } = JSON.parse(ordinal.customInstructions)

			const result = await completeSignedAction(
				ctx.wallet,
				createResult,
				inputBEEF,
				async (tx) => {
					const unlocking = await signP2PKHInput(ctx, tx, 0, protocolID, keyID)
					if (typeof unlocking !== 'string') throw new Error(unlocking.error)
					return { 0: { unlockingScript: unlocking } }
				},
			)

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'opnsRegister',
					input: { outpoint: ordinal.outpoint },
					txid: result.txid,
					rawtx: result.rawtx,
					outputs: [{ index: 0, protocolID: ONESAT_PROTOCOL, keyID: ordinal.outpoint, basket: OPNS_BASKET, satoshis: 1 }],
				})
			}

			return result
		} catch (error) {
			console.error('[opnsRegister]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'opnsRegister',
					input: { outpoint: input.ordinal.outpoint },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Deregister an identity key from an OpNS name.
 * Transfers the OpNS ordinal to self with MAP metadata containing an empty
 * idKey field, explicitly clearing the identity binding on-chain.
 */
export const opnsDeregister: Action<
	OpnsDeregisterRequest,
	OpnsOperationResponse
> = {
	meta: {
		name: 'opnsDeregister',
		description:
			'Remove identity key binding from an OpNS name',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				ordinal: {
					type: 'object',
					description: 'WalletOutput of the OpNS ordinal from listOutputs',
				},
				inputBEEF: {
					type: 'array',
					description:
						"BEEF from listOutputs with include: 'entire transactions'",
				},
			},
			required: ['ordinal', 'inputBEEF'],
		},
	},
	async execute(ctx, input) {
		try {
			const { ordinal, inputBEEF } = input

			// Transfer to self with empty idKey — explicitly clears identity binding
			const params = await buildTransferOrdinals(ctx, {
				transfers: [
					{
						ordinal,
						counterparty: 'self',
						map: {
							'opns.idKey': '',
						},
						extraTags: [],
					},
				],
				inputBEEF,
			})

			if ('error' in params) {
				return params
			}

			const createResult = await ctx.wallet.createAction({
				...params,
				options: { signAndProcess: false, randomizeOutputs: false },
			})

			if ('error' in createResult && createResult.error) {
				return { error: String(createResult.error) }
			}

			if (!ordinal.customInstructions) {
				return { error: 'missing-custom-instructions' }
			}

			const { protocolID, keyID } = JSON.parse(ordinal.customInstructions)

			const result = await completeSignedAction(
				ctx.wallet,
				createResult,
				inputBEEF,
				async (tx) => {
					const unlocking = await signP2PKHInput(ctx, tx, 0, protocolID, keyID)
					if (typeof unlocking !== 'string') throw new Error(unlocking.error)
					return { 0: { unlockingScript: unlocking } }
				},
			)

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'opnsDeregister',
					input: { outpoint: ordinal.outpoint },
					txid: result.txid,
					rawtx: result.rawtx,
					outputs: [{ index: 0, protocolID: ONESAT_PROTOCOL, keyID: ordinal.outpoint, basket: OPNS_BASKET, satoshis: 1 }],
				})
			}

			return result
		} catch (error) {
			console.error('[opnsDeregister]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'opnsDeregister',
					input: { outpoint: input.ordinal.outpoint },
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

/** All OpNS actions for registry */
export const opnsActions = [opnsRegister, opnsDeregister]
