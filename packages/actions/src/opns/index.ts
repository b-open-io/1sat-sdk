/**
 * OpNS Module
 *
 * Actions for managing OpNS names. Identity bind is a signed PushDrop on the
 * name UTXO (field0 = BRC-100 identity key). Moving the name spends that
 * script and re-locks under the normal ordinal formats (P2PKH / OrdLock).
 */

import { OpNS } from '@1sat/templates'
import {
	OPNS_BASKET,
	OPNS_PUBLISHED_TAG,
	OPNS_PUSHDROP_TEMPLATE,
	OPNS_REGISTER_COUNTERPARTY,
	P1SAT_PROTOCOL,
	opnsRegisterKeyId,
} from '@1sat/types'
import {
	PushDrop,
	Transaction,
	Utils,
	type BEEF,
	type WalletCounterparty,
	type WalletOutput,
	type WalletProtocol,
} from '@bsv/sdk'
import { buildTransferOrdinals, listOrdinal, transferOrdinals } from '../ordinals'
import type { Action, ActionOptions, OneSatContext } from '../types'
import {
	executeTrackedAction,
	randomActionId,
} from '../utils/createTrackedAction'
import { resolveBeef } from '../utils/resolveBeef'
import {
	signOrdinalInput,
	unlockingScriptLengthForInstructions,
} from '../utils/signOrdinalInput'

export { opnsRegisterKeyId } from '@1sat/types'

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

/** Input for getOpnsNames — listOutputs-shaped; basket is always OPNS. */
export interface GetOpnsNamesInput {
	/** Output tags to filter (listOutputs tags) */
	tags?: string[]
	/** How multiple tags combine (default: any when any tags/names present) */
	tagQueryMode?: 'all' | 'any'
	/** Convenience: appended as `name:${n}` tags (same tagQueryMode) */
	names?: string[]
	/** Omit for metadata-only (no BEEF). Use entire transactions when batch BEEF is required. */
	include?: 'locking scripts' | 'entire transactions'
	includeCustomInstructions?: boolean
	includeTags?: boolean
	includeLabels?: boolean
	limit?: number
	offset?: number
}

/** Result from getOpnsNames action */
export interface GetOpnsNamesResult {
	outputs: WalletOutput[]
	BEEF?: BEEF
	totalOutputs?: number
}

/** Input for internalizeOpns — receive a foreign-created OpNS mint into the wallet. */
export interface InternalizeOpnsInput {
	/** Mint tx as AtomicBEEF (BRC-95) — same format internalizeAction requires */
	tx: number[]
	/** Spend derivation for the receive lock (same path used to build receiveAddress) */
	protocolID: WalletProtocol
	keyID: string
	counterparty?: WalletCounterparty
}

/** Result from internalizeOpns */
export interface InternalizeOpnsResult {
	txid?: string
	outpoint?: string
	name?: string
	error?: string
}

/** Locate the name delivery output on an OpNS mint tx (nodes at i,i+1 → name at i+2). */
function findMintNameDelivery(tx: Transaction): {
	vout: number
	name: string
} | null {
	for (let i = 0; i + 2 < tx.outputs.length; i++) {
		const parent = OpNS.decode(tx.outputs[i].lockingScript)
		const child = OpNS.decode(tx.outputs[i + 1].lockingScript)
		if (!parent || !child) continue
		const name = child.domain.trim().slice(0, 64)
		if (!name) continue
		return { vout: i + 2, name }
	}
	return null
}

// ============================================================================
// Helpers
// ============================================================================

function sourceNameFromOrdinal(ordinal: WalletOutput): string | undefined {
	if (ordinal.customInstructions) {
		try {
			const name = JSON.parse(ordinal.customInstructions).name
			if (typeof name === 'string' && name) return name
		} catch {}
	}
	return ordinal.tags?.find((t) => t.startsWith('name:'))?.slice(5)
}

async function signSingleOrdinalInput(
	ctx: OneSatContext,
	ordinal: WalletOutput,
) {
	if (!ordinal.customInstructions) {
		return { error: 'missing-custom-instructions' as const }
	}
	return {
		sign: async (tx: Parameters<typeof signOrdinalInput>[1]) => {
			const unlocking = await signOrdinalInput(
				ctx,
				tx,
				0,
				ordinal.customInstructions as string,
			)
			if (typeof unlocking !== 'string') throw new Error(unlocking.error)
			return { 0: { unlockingScript: unlocking } }
		},
	}
}

// ============================================================================
// Actions
// ============================================================================

/**
 * List OpNS names in the wallet. Mirrors listOutputs (fixed OPNS basket).
 * Metadata-only by default; pass include: 'entire transactions' for batch BEEF.
 */
export const getOpnsNames: Action<GetOpnsNamesInput, GetOpnsNamesResult> = {
	meta: {
		name: 'getOpnsNames',
		description:
			'List OpNS names from the wallet (metadata by default; optional BEEF)',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				tags: {
					type: 'array',
					description: 'Filter tags (listOutputs tags)',
					items: { type: 'string' },
				},
				tagQueryMode: {
					type: 'string',
					enum: ['all', 'any'],
					description: 'How tags combine (default any when filtering)',
				},
				names: {
					type: 'array',
					description: 'Appended as name:${n} tags',
					items: { type: 'string' },
				},
				include: {
					type: 'string',
					enum: ['locking scripts', 'entire transactions'],
					description: 'Omit for metadata-only (no BEEF)',
				},
				includeCustomInstructions: { type: 'boolean' },
				includeTags: { type: 'boolean' },
				includeLabels: { type: 'boolean' },
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
		const tags = [...(input.tags ?? [])]
		for (const n of input.names ?? []) {
			if (n) tags.push(`name:${n}`)
		}
		const filtering = tags.length > 0
		const result = await ctx.wallet.listOutputs({
			basket: OPNS_BASKET,
			...(filtering && {
				tags,
				tagQueryMode: input.tagQueryMode ?? 'any',
			}),
			...(input.include && { include: input.include }),
			includeCustomInstructions: input.includeCustomInstructions ?? true,
			includeTags: input.includeTags ?? true,
			...(input.includeLabels != null && {
				includeLabels: input.includeLabels,
			}),
			limit: input.limit ?? 100,
			offset: input.offset ?? 0,
		})
		return {
			outputs: result.outputs,
			BEEF: result.BEEF,
			totalOutputs: result.totalOutputs,
		}
	},
}

/**
 * Internalize an OpNS mint delivery into the wallet model (basket, name tag, id:).
 * Caller supplies BEEF + the spend derivation used for the receive lock.
 */
export const internalizeOpns: Action<
	InternalizeOpnsInput,
	InternalizeOpnsResult
> = {
	meta: {
		name: 'internalizeOpns',
		description:
			'Internalize a foreign-created OpNS mint into the wallet with tracking tags',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				tx: {
					type: 'array',
					description: 'Mint AtomicBEEF (BRC-95) bytes',
					items: { type: 'integer' },
				},
				protocolID: {
					type: 'array',
					description: 'Wallet protocol for spend derivation',
				},
				keyID: {
					type: 'string',
					description: 'Key ID for spend derivation',
				},
				counterparty: {
					type: 'string',
					description: 'Counterparty for spend derivation (default self)',
				},
			},
			required: ['tx', 'protocolID', 'keyID'],
		},
	},
	async execute(_ctx, input) {
		try {
			const parsed = Transaction.fromAtomicBEEF(input.tx)
			const txid = parsed.id('hex')
			const delivery = findMintNameDelivery(parsed)
			if (!delivery) {
				return { error: 'not-an-opns-mint' }
			}
			const { vout, name } = delivery
			const actionId = randomActionId()
			const counterparty = input.counterparty ?? 'self'
			await _ctx.wallet.internalizeAction({
				tx: input.tx,
				outputs: [
					{
						outputIndex: vout,
						protocol: 'basket insertion',
						insertionRemittance: {
							basket: OPNS_BASKET,
							tags: ['opns', `name:${name}`, `id:${actionId}_${vout}`],
							customInstructions: JSON.stringify({
								protocolID: input.protocolID,
								keyID: input.keyID,
								counterparty,
								name,
							}),
						},
					},
				],
				description: `opns name ${name}`.slice(0, 50),
			})
			return {
				txid,
				outpoint: `${txid}.${vout}`,
				name,
			}
		} catch (err) {
			return {
				error: err instanceof Error ? err.message : String(err),
			}
		}
	},
}

/**
 * Bind the wallet identity key to an OpNS name via signed PushDrop.
 *
 * Lock: PushDrop under [0,'p 1sat'] / opns:{inputOutpoint} / anyone, forSelf.
 * fields[0] = identity pubkey bytes; field-sig included (same derivation).
 */
export const opnsRegister: Action<OpnsRegisterRequest, OpnsOperationResponse> =
	{
		meta: {
			name: 'opnsRegister',
			description:
				'Bind BRC-100 identity key to an OpNS name via signed PushDrop',
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
				if (!ordinal.customInstructions) {
					return { error: 'missing-custom-instructions' }
				}

				const inputBEEF =
					input.inputBEEF ??
					(await resolveBeef(ctx.wallet, OPNS_BASKET, ordinal))

				const { publicKey: identityPubKey } = await ctx.wallet.getPublicKey({
					identityKey: true,
				})
				const keyID = opnsRegisterKeyId(ordinal.outpoint)
				const lockingScript = await new PushDrop(ctx.wallet).lock(
					[Utils.toArray(identityPubKey, 'hex')],
					P1SAT_PROTOCOL,
					keyID,
					OPNS_REGISTER_COUNTERPARTY,
					true,
					true,
				)

				const tags = [
					...(ordinal.tags ?? []).filter(
						(t) => t !== OPNS_PUBLISHED_TAG && !t.startsWith('ordlock'),
					),
					OPNS_PUBLISHED_TAG,
				]
				const name = sourceNameFromOrdinal(ordinal)

				const result = await executeTrackedAction(
					ctx.wallet,
					{
						description: 'Register OpNS identity bind',
						inputBEEF,
						inputs: [
							{
								outpoint: ordinal.outpoint,
								inputDescription: 'OpNS name to register',
								unlockingScriptLength: unlockingScriptLengthForInstructions(
									ordinal.customInstructions,
								),
							},
						],
						outputs: [
							{
								lockingScript: lockingScript.toHex(),
								satoshis: 1,
								outputDescription: 'OpNS identity bind',
								basket: OPNS_BASKET,
								tags,
								customInstructions: JSON.stringify({
									protocolID: P1SAT_PROTOCOL,
									keyID,
									counterparty: OPNS_REGISTER_COUNTERPARTY,
									template: OPNS_PUSHDROP_TEMPLATE,
									...(name && { name }),
								}),
							},
						],
						options: { randomizeOutputs: false },
					},
					input.fundingProvider,
					inputBEEF,
					async (tx) => {
						const unlocking = await signOrdinalInput(
							ctx,
							tx,
							0,
							ordinal.customInstructions as string,
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
 * Remove an identity bind by self-transferring to plain P2PKH.
 * Spending the PushDrop clears the on-chain bind.
 */
export const opnsDeregister: Action<
	OpnsDeregisterRequest,
	OpnsOperationResponse
> = {
	meta: {
		name: 'opnsDeregister',
		description: 'Remove identity bind from an OpNS name (self-transfer to P2PKH)',
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

			const params = await buildTransferOrdinals(ctx, {
				transfers: [
					{
						ordinal,
						counterparty: 'self',
						extraTags: [],
					},
				],
				inputBEEF,
			})

			if ('error' in params) {
				return params
			}

			// Drop published tag on the plain self-transfer output
			if (params.outputs?.[0]?.tags) {
				params.outputs[0].tags = params.outputs[0].tags.filter(
					(t) => t !== OPNS_PUBLISHED_TAG,
				)
			}

			const signer = await signSingleOrdinalInput(ctx, ordinal)
			if ('error' in signer) return signer

			return await executeTrackedAction(
				ctx.wallet,
				{
					...params,
					description: 'Deregister OpNS identity bind',
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				inputBEEF,
				signer.sign,
			)
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

export interface OpnsListRequest extends ActionOptions {
	/** The OpNS ordinal output to list (from listOutputs) */
	ordinal: WalletOutput
	/** BEEF — resolved automatically via ID tag if omitted */
	inputBEEF?: number[]
	/** Price in satoshis */
	price: number
	/** Address that receives payment on purchase */
	payAddress: string
}

/**
 * List an OpNS name for sale.
 * Spends the current lock (PushDrop or P2PKH); OrdLock output has no identity bind.
 */
export const opnsList: Action<OpnsListRequest, OpnsOperationResponse> = {
	meta: {
		name: 'opnsList',
		description: 'List an OpNS name for sale',
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
				price: { type: 'integer', description: 'Price in satoshis' },
				payAddress: {
					type: 'string',
					description: 'Address to receive payment on purchase',
				},
			},
			required: ['ordinal', 'price', 'payAddress'],
		},
	},
	async execute(ctx, input) {
		return listOrdinal.execute(ctx, input)
	},
}

export interface OpnsTransferRequest extends ActionOptions {
	/** The OpNS ordinal output to transfer (from listOutputs) */
	ordinal: WalletOutput
	/** Recipient's identity public key (preferred) */
	counterparty?: string
	/** Raw P2PKH address */
	address?: string
	/** BEEF — resolved automatically via ID tag if omitted */
	inputBEEF?: number[]
}

/**
 * Transfer an OpNS name to a new owner.
 * Spends the current lock; recipient gets plain P2PKH (bind does not carry forward).
 */
export const opnsTransfer: Action<OpnsTransferRequest, OpnsOperationResponse> =
	{
		meta: {
			name: 'opnsTransfer',
			description: 'Transfer an OpNS name to a new owner',
			category: 'opns',
			inputSchema: {
				type: 'object',
				properties: {
					ordinal: {
						type: 'object',
						description: 'WalletOutput of the OpNS ordinal from listOutputs',
					},
					counterparty: {
						type: 'string',
						description: 'Recipient identity public key (hex)',
					},
					address: {
						type: 'string',
						description: 'Recipient P2PKH address',
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
			return transferOrdinals.execute(ctx, {
				transfers: [
					{
						ordinal: input.ordinal,
						counterparty: input.counterparty,
						address: input.address,
					},
				],
				inputBEEF: input.inputBEEF,
				fundingProvider: input.fundingProvider,
			})
		},
	}

/** All OpNS actions for registry (paid mine lives on 1sat.name / orchestrator). */
export const opnsActions = [
	getOpnsNames,
	internalizeOpns,
	opnsRegister,
	opnsDeregister,
	opnsList,
	opnsTransfer,
]
