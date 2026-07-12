/**
 * OpNS Module
 *
 * Actions for managing OpNS name identity bindings.
 * Registers/deregisters identity public keys on OpNS tokens via MAP metadata.
 */

import type { BEEF, WalletOutput } from '@bsv/sdk'
import { OPNS_BASKET } from '../constants'
import { buildTransferOrdinals } from '../ordinals'
import type { Action, ActionOptions } from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { resolveBeef } from '../utils/resolveBeef'
import { signP2PKHInput } from '../utils/signP2PKH'

// ============================================================================
// Types
// ============================================================================

export interface OpnsRegisterRequest extends ActionOptions {
	/** The OpNS ordinal output to register (from listOutputs) */
	ordinal: WalletOutput
	/** BEEF — resolved automatically via ID tag if omitted */
	inputBEEF?: number[]
}

export interface OpnsDeregisterRequest extends ActionOptions {
	/** The OpNS ordinal output to deregister (from listOutputs) */
	ordinal: WalletOutput
	/** BEEF — resolved automatically via ID tag if omitted */
	inputBEEF?: number[]
}

export interface OpnsOperationResponse {
	txid?: string
	tx?: number[]
	error?: string
}

// ============================================================================
// Actions
// ============================================================================

/** Input for getOpnsNames action */
export interface GetOpnsNamesInput {
	/** Max number of names to return */
	limit?: number
	/** Offset for pagination */
	offset?: number
}

/** Result from getOpnsNames action */
export interface GetOpnsNamesResult {
	outputs: WalletOutput[]
	BEEF?: BEEF
}

/**
 * Get OpNS names from the wallet with BEEF for spending.
 */
export const getOpnsNames: Action<GetOpnsNamesInput, GetOpnsNamesResult> = {
	meta: {
		name: 'getOpnsNames',
		description: 'Get OpNS names from the wallet with BEEF for spending',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				limit: {
					type: 'integer',
					description: 'Max names to return (default: 100)',
				},
				offset: {
					type: 'integer',
					description: 'Offset for pagination (default: 0)',
				},
			},
		},
	},
	async execute(ctx, input) {
		const result = await ctx.wallet.listOutputs({
			basket: OPNS_BASKET,
			includeTags: true,
			includeCustomInstructions: true,
			include: 'entire transactions',
			limit: input.limit ?? 100,
			offset: input.offset ?? 0,
		})
		return {
			outputs: result.outputs,
			BEEF: result.BEEF,
		}
	},
}

/**
 * Register an identity key on an OpNS name.
 * Transfers the OpNS ordinal to self with MAP metadata binding the wallet's
 * identity public key, then submits to the OpNS overlay.
 */
export const opnsRegister: Action<OpnsRegisterRequest, OpnsOperationResponse> =
	{
		meta: {
			name: 'opnsRegister',
			description: 'Register identity key on an OpNS name via MAP metadata',
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
				required: ['ordinal'],
			},
		},
		async execute(ctx, input) {
			try {
				if (!ctx.services) {
					return { error: 'services-required' }
				}

				const { ordinal } = input
				const inputBEEF =
					input.inputBEEF ??
					(await resolveBeef(ctx.wallet, OPNS_BASKET, ordinal))

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

				if (!ordinal.customInstructions) {
					return { error: 'missing-custom-instructions' }
				}
				const { protocolID, keyID, counterparty } = JSON.parse(
					ordinal.customInstructions,
				)

				const result = await executeTrackedAction(
					ctx.wallet,
					{
						...params,
						options: { randomizeOutputs: false },
					},
					input.fundingProvider,
					inputBEEF,
					async (tx) => {
						const unlocking = await signP2PKHInput(
							ctx,
							tx,
							0,
							protocolID,
							keyID,
							counterparty,
						)
						if (typeof unlocking !== 'string') throw new Error(unlocking.error)
						return { 0: { unlockingScript: unlocking } }
					},
				)

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
		description: 'Remove identity key binding from an OpNS name',
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
			required: ['ordinal'],
		},
	},
	async execute(ctx, input) {
		try {
			const { ordinal } = input
			const inputBEEF =
				input.inputBEEF ?? (await resolveBeef(ctx.wallet, OPNS_BASKET, ordinal))

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

			if (!ordinal.customInstructions) {
				return { error: 'missing-custom-instructions' }
			}
			const { protocolID, keyID, counterparty } = JSON.parse(
				ordinal.customInstructions,
			)

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					...params,
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				inputBEEF,
				async (tx) => {
					const unlocking = await signP2PKHInput(
						ctx,
						tx,
						0,
						protocolID,
						keyID,
						counterparty,
					)
					if (typeof unlocking !== 'string') throw new Error(unlocking.error)
					return { 0: { unlockingScript: unlocking } }
				},
			)

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

export {
	opnsMine,
	opnsMineStatus,
	opnsMineRefund,
	type OpnsMineRequest,
	type OpnsMineResponse,
	type OpnsMineStatusRequest,
	type OpnsMineRefundRequest,
	type OpnsMineRefundResponse,
	type OpnsMineJob,
} from './mine'

import { opnsMine, opnsMineRefund, opnsMineStatus } from './mine'

/** All OpNS actions for registry */
export const opnsActions = [
	getOpnsNames,
	opnsRegister,
	opnsDeregister,
	opnsMine,
	opnsMineStatus,
	opnsMineRefund,
]
