/**
 * OpNS Module
 *
 * Wallet-owned names live in OPNS_BASKET with id: tags.
 * Self-moves: id → one loadBasketOutputBeef → ordinalSeedTags + domain tags.
 * Ingress (internalizeOpns / buyOpns) stamps full tags including id:.
 */

import { OpNS, OrdLock } from '@1sat/templates'
import {
	OPNS_BASKET,
	OPNS_PUBLISHED_TAG,
	OPNS_PUSHDROP_TEMPLATE,
	OPNS_REGISTER_COUNTERPARTY,
	P1SAT_PROTOCOL,
	buildInputAssetLabel,
	opnsRegisterKeyId,
	readAssetIdTag,
} from '@1sat/types'
import {
	type BEEF,
	P2PKH,
	PublicKey,
	PushDrop,
	Transaction,
	Utils,
	type WalletCounterparty,
	type WalletOutput,
	type WalletProtocol,
} from '@bsv/sdk'
import {
	buildOrdLockScript,
	buyOrdinal,
	defaultPayAddress,
	deriveCancelAddressInternal,
} from '../ordinals'
import type { Action, ActionOptions, OneSatContext } from '../types'
import {
	executeTrackedAction,
	randomActionId,
} from '../utils/createTrackedAction'
import { loadBasketOutputBeef } from '../utils/loadBasketOutput'
import { ordinalSeedTags } from '../utils/ordinalSeedTags'
import {
	signOrdinalInput,
	unlockingScriptLengthForInstructions,
} from '../utils/signOrdinalInput'

const OPNS_CONTENT_TYPE = 'application/op-ns'

export { opnsRegisterKeyId } from '@1sat/types'

// ============================================================================
// Types
// ============================================================================

export interface OpnsOperationResponse {
	txid?: string
	tx?: number[]
	error?: string
}

/** Wallet-owned OpNS spend: id of the basket row (bare or id: prefix). */
export interface OpnsIdInput extends ActionOptions {
	/** Tracking id of the OpNS UTXO in the OPNS basket */
	id: string
}

export type RegisterOpnsRequest = OpnsIdInput
export type DeregisterOpnsRequest = OpnsIdInput

export interface SellOpnsRequest extends OpnsIdInput {
	price: number
	/** Payment receive address; default P1SAT keyID `1sat 0` */
	payAddress?: string
}

export interface SendOpnsRequest extends OpnsIdInput {
	counterparty?: string
	address?: string
}

export interface CancelOpnsListingRequest extends OpnsIdInput {}

export interface ListOpnsInput {
	tags?: string[]
	tagQueryMode?: 'all' | 'any'
	names?: string[]
	/** ids to filter (appended as id: tags) */
	ids?: string[]
	include?: 'locking scripts' | 'entire transactions'
	includeCustomInstructions?: boolean
	includeTags?: boolean
	includeLabels?: boolean
	limit?: number
	offset?: number
}

export interface ListOpnsResult {
	outputs: WalletOutput[]
	BEEF?: BEEF
	totalOutputs?: number
}

export interface InternalizeOpnsInput {
	/** AtomicBEEF (BRC-95) */
	tx: number[]
	protocolID: WalletProtocol
	keyID: string
	counterparty?: WalletCounterparty
}

export interface InternalizeOpnsResult {
	txid?: string
	outpoint?: string
	name?: string
	id?: string
	error?: string
}

// ============================================================================
// Helpers
// ============================================================================

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

function nameFromOutput(out: WalletOutput): string | undefined {
	const fromTag = out.tags?.find((t) => t.startsWith('name:'))?.slice(5)
	if (fromTag) return fromTag.slice(0, 64)
	if (!out.customInstructions) return undefined
	try {
		const n = JSON.parse(out.customInstructions).name
		return typeof n === 'string' && n ? n.slice(0, 64) : undefined
	} catch {
		return undefined
	}
}

/** Load OPNS row + BEEF from wallet storage by id. */
async function loadOpnsSpend(
	ctx: OneSatContext,
	input: OpnsIdInput,
): Promise<{ output: WalletOutput; beef: number[] } | { error: string }> {
	return loadBasketOutputBeef(ctx.wallet, OPNS_BASKET, input.id)
}

/** Ordinal seed + opns domain tag; optional extras (ordlock, published, …). */
function opnsFileTags(output: WalletOutput, extra: string[] = []): string[] {
	const tags = ordinalSeedTags(output)
	if (!tags.includes('opns')) tags.unshift('opns')
	for (const e of extra) {
		if (e && !tags.includes(e)) tags.push(e)
	}
	return tags
}

// ============================================================================
// listOpns
// ============================================================================

export const listOpns: Action<ListOpnsInput, ListOpnsResult> = {
	meta: {
		name: 'listOpns',
		description:
			'List OpNS names from the wallet (metadata by default; optional BEEF)',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				tags: { type: 'array', items: { type: 'string' } },
				tagQueryMode: { type: 'string', enum: ['all', 'any'] },
				names: { type: 'array', items: { type: 'string' } },
				ids: { type: 'array', items: { type: 'string' } },
				include: {
					type: 'string',
					enum: ['locking scripts', 'entire transactions'],
				},
				includeCustomInstructions: { type: 'boolean' },
				includeTags: { type: 'boolean' },
				includeLabels: { type: 'boolean' },
				limit: { type: 'integer' },
				offset: { type: 'integer' },
			},
		},
	},
	async execute(ctx, input) {
		const tags = [...(input.tags ?? [])]
		for (const n of input.names ?? []) {
			if (n) tags.push(`name:${n}`)
		}
		for (const id of input.ids ?? []) {
			if (id) tags.push(id.startsWith('id:') ? id : `id:${id}`)
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

// ============================================================================
// internalizeOpns (ingress)
// ============================================================================

export const internalizeOpns: Action<
	InternalizeOpnsInput,
	InternalizeOpnsResult
> = {
	meta: {
		name: 'internalizeOpns',
		description:
			'Internalize a foreign-created OpNS mint (AtomicBEEF) into the OPNS basket',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				tx: { type: 'array', items: { type: 'integer' } },
				protocolID: { type: 'array' },
				keyID: { type: 'string' },
				counterparty: { type: 'string' },
			},
			required: ['tx', 'protocolID', 'keyID'],
		},
	},
	async execute(ctx, input) {
		try {
			const parsed = Transaction.fromAtomicBEEF(input.tx)
			const txid = parsed.id('hex')
			const delivery = findMintNameDelivery(parsed)
			if (!delivery) return { error: 'not-an-opns-mint' }
			const { vout, name } = delivery
			const outpoint = `${txid}.${vout}`
			const actionId = randomActionId()
			const idTag = `id:${actionId}_${vout}`
			const counterparty = input.counterparty ?? 'self'
			await ctx.wallet.internalizeAction({
				tx: input.tx,
				outputs: [
					{
						outputIndex: vout,
						protocol: 'basket insertion',
						insertionRemittance: {
							basket: OPNS_BASKET,
							tags: [
								'opns',
								`type:${OPNS_CONTENT_TYPE}`,
								`origin:${outpoint}`,
								`name:${name}`,
								idTag,
							],
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
				outpoint,
				name,
				id: `${actionId}_${vout}`,
			}
		} catch (err) {
			return {
				error: err instanceof Error ? err.message : String(err),
			}
		}
	},
}

// ============================================================================
// register / deregister
// ============================================================================

export const registerOpns: Action<RegisterOpnsRequest, OpnsOperationResponse> =
	{
		meta: {
			name: 'registerOpns',
			description:
				'Bind BRC-100 identity key to an OpNS name via signed PushDrop',
			category: 'opns',
			inputSchema: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'OPNS basket tracking id' },
				},
				required: ['id'],
			},
		},
		async execute(ctx, input) {
			try {
				const loaded = await loadOpnsSpend(ctx, input)
				if ('error' in loaded) return loaded
				const { output, beef } = loaded
				if (!output.customInstructions) {
					return { error: 'missing-custom-instructions' }
				}

				const { publicKey: identityPubKey } = await ctx.wallet.getPublicKey({
					identityKey: true,
				})
				const keyID = opnsRegisterKeyId(output.outpoint)
				const lockingScript = await new PushDrop(ctx.wallet).lock(
					[Utils.toArray(identityPubKey, 'hex')],
					P1SAT_PROTOCOL,
					keyID,
					OPNS_REGISTER_COUNTERPARTY,
					true,
					true,
				)

				const name = nameFromOutput(output)
				const tags = opnsFileTags(output, [OPNS_PUBLISHED_TAG])
				const inputId = readAssetIdTag(output.tags)

				return await executeTrackedAction(
					ctx.wallet,
					{
						description: 'Register OpNS identity bind',
						inputBEEF: beef,
						...(inputId && {
							labels: [buildInputAssetLabel(OPNS_BASKET, inputId)],
						}),
						inputs: [
							{
								outpoint: output.outpoint,
								inputDescription: 'OpNS name to register',
								unlockingScriptLength: unlockingScriptLengthForInstructions(
									output.customInstructions,
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
					beef,
					async (tx) => {
						const unlocking = await signOrdinalInput(
							ctx,
							tx,
							0,
							output.customInstructions as string,
						)
						if (typeof unlocking !== 'string') throw new Error(unlocking.error)
						return { 0: { unlockingScript: unlocking } }
					},
				)
			} catch (error) {
				console.error('[registerOpns]', error)
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
	}

export const deregisterOpns: Action<
	DeregisterOpnsRequest,
	OpnsOperationResponse
> = {
	meta: {
		name: 'deregisterOpns',
		description:
			'Remove identity bind from an OpNS name (self-transfer to P2PKH)',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
			},
			required: ['id'],
		},
	},
	async execute(ctx, input) {
		try {
			const loaded = await loadOpnsSpend(ctx, input)
			if ('error' in loaded) return loaded
			const { output, beef } = loaded
			if (!output.customInstructions) {
				return { error: 'missing-custom-instructions' }
			}

			const outpoint = output.outpoint
			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: P1SAT_PROTOCOL,
				keyID: outpoint,
				counterparty: 'self',
				forSelf: true,
			})
			const address = PublicKey.fromString(publicKey).toAddress()
			const tags = opnsFileTags(output)
			const name = nameFromOutput(output)
			const inputId = readAssetIdTag(output.tags)

			return await executeTrackedAction(
				ctx.wallet,
				{
					description: 'Deregister OpNS identity bind',
					inputBEEF: beef,
					...(inputId && {
						labels: [buildInputAssetLabel(OPNS_BASKET, inputId)],
					}),
					inputs: [
						{
							outpoint,
							inputDescription: 'OpNS name to deregister',
							unlockingScriptLength: unlockingScriptLengthForInstructions(
								output.customInstructions,
							),
						},
					],
					outputs: [
						{
							lockingScript: new P2PKH().lock(address).toHex(),
							satoshis: 1,
							outputDescription: 'OpNS name (unbound)',
							basket: OPNS_BASKET,
							tags,
							customInstructions: JSON.stringify({
								protocolID: P1SAT_PROTOCOL,
								keyID: outpoint,
								...(name && { name }),
							}),
						},
					],
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				beef,
				async (tx) => {
					const unlocking = await signOrdinalInput(
						ctx,
						tx,
						0,
						output.customInstructions as string,
					)
					if (typeof unlocking !== 'string') throw new Error(unlocking.error)
					return { 0: { unlockingScript: unlocking } }
				},
			)
		} catch (error) {
			console.error('[deregisterOpns]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

// ============================================================================
// sell / send / cancel
// ============================================================================

export const sellOpns: Action<SellOpnsRequest, OpnsOperationResponse> = {
	meta: {
		name: 'sellOpns',
		description: 'List an OpNS name for sale',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				price: { type: 'integer' },
				payAddress: {
					type: 'string',
					description: 'Payment address (default: P1SAT keyID 1sat 0)',
				},
			},
			required: ['id', 'price'],
		},
	},
	async execute(ctx, input) {
		try {
			if (input.price <= 0) return { error: 'invalid-price' }
			const loaded = await loadOpnsSpend(ctx, input)
			if ('error' in loaded) return loaded
			const { output, beef } = loaded
			if (!output.customInstructions) {
				return { error: 'missing-custom-instructions' }
			}

			const outpoint = output.outpoint
			const payAddress = input.payAddress ?? (await defaultPayAddress(ctx))
			const cancelAddress = await deriveCancelAddressInternal(ctx, outpoint)
			const lockingScript = buildOrdLockScript(
				cancelAddress,
				payAddress,
				input.price,
			).toHex()
			const tags = opnsFileTags(output, ['ordlock', `price:${input.price}`])
			const name = nameFromOutput(output)
			const inputId = readAssetIdTag(output.tags)

			return await executeTrackedAction(
				ctx.wallet,
				{
					description: `List OpNS for ${input.price} sats`,
					inputBEEF: beef,
					...(inputId && {
						labels: [buildInputAssetLabel(OPNS_BASKET, inputId)],
					}),
					inputs: [
						{
							outpoint,
							inputDescription: 'OpNS name to list',
							unlockingScriptLength: unlockingScriptLengthForInstructions(
								output.customInstructions,
							),
						},
					],
					outputs: [
						{
							lockingScript,
							satoshis: 1,
							outputDescription: `List OpNS for ${input.price} sats`,
							basket: OPNS_BASKET,
							tags,
							customInstructions: JSON.stringify({
								protocolID: P1SAT_PROTOCOL,
								keyID: outpoint,
								...(name && { name }),
							}),
						},
					],
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				beef,
				async (tx) => {
					const unlocking = await signOrdinalInput(
						ctx,
						tx,
						0,
						output.customInstructions as string,
					)
					if (typeof unlocking !== 'string') throw new Error(unlocking.error)
					return { 0: { unlockingScript: unlocking } }
				},
			)
		} catch (error) {
			console.error('[sellOpns]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

export const sendOpns: Action<SendOpnsRequest, OpnsOperationResponse> = {
	meta: {
		name: 'sendOpns',
		description: 'Transfer an OpNS name to a new owner',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				counterparty: { type: 'string' },
				address: { type: 'string' },
			},
			required: ['id'],
		},
	},
	async execute(ctx, input) {
		try {
			if (!input.counterparty && !input.address) {
				return { error: 'must-provide-counterparty-or-address' }
			}
			const loaded = await loadOpnsSpend(ctx, input)
			if ('error' in loaded) return loaded
			const { output, beef } = loaded
			if (!output.customInstructions) {
				return { error: 'missing-custom-instructions' }
			}

			const outpoint = output.outpoint
			const isSelf = input.counterparty === 'self'
			let recipientAddress: string
			if (input.counterparty) {
				const { publicKey } = await ctx.wallet.getPublicKey({
					protocolID: P1SAT_PROTOCOL,
					keyID: outpoint,
					counterparty: input.counterparty,
					forSelf: isSelf,
				})
				recipientAddress = PublicKey.fromString(publicKey).toAddress()
			} else {
				recipientAddress = input.address as string
			}

			const inputId = readAssetIdTag(output.tags)
			const name = nameFromOutput(output)
			const tags = opnsFileTags(output)

			return await executeTrackedAction(
				ctx.wallet,
				{
					description: 'Transfer OpNS name',
					inputBEEF: beef,
					...(inputId && {
						labels: [buildInputAssetLabel(OPNS_BASKET, inputId)],
					}),
					inputs: [
						{
							outpoint,
							inputDescription: 'OpNS name to transfer',
							unlockingScriptLength: unlockingScriptLengthForInstructions(
								output.customInstructions,
							),
						},
					],
					outputs: [
						isSelf
							? {
									lockingScript: new P2PKH().lock(recipientAddress).toHex(),
									satoshis: 1,
									outputDescription: 'OpNS self-transfer',
									basket: OPNS_BASKET,
									tags,
									customInstructions: JSON.stringify({
										protocolID: P1SAT_PROTOCOL,
										keyID: outpoint,
										...(name && { name }),
									}),
								}
							: {
									lockingScript: new P2PKH().lock(recipientAddress).toHex(),
									satoshis: 1,
									outputDescription: 'OpNS transfer',
									tags: [],
								},
					],
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				beef,
				async (tx) => {
					const unlocking = await signOrdinalInput(
						ctx,
						tx,
						0,
						output.customInstructions as string,
					)
					if (typeof unlocking !== 'string') throw new Error(unlocking.error)
					return { 0: { unlockingScript: unlocking } }
				},
			)
		} catch (error) {
			console.error('[sendOpns]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

export const cancelOpnsListing: Action<
	CancelOpnsListingRequest,
	OpnsOperationResponse
> = {
	meta: {
		name: 'cancelOpnsListing',
		description: 'Cancel an OpNS name listing back into the OPNS basket',
		category: 'opns',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
			},
			required: ['id'],
		},
	},
	async execute(ctx, input) {
		try {
			const loaded = await loadOpnsSpend(ctx, input)
			if ('error' in loaded) return loaded
			const { output: listing, beef: inputBEEF } = loaded
			const outpoint = listing.outpoint
			if (!listing.customInstructions) {
				return { error: 'missing-custom-instructions' }
			}

			const {
				protocolID: signProtocolID,
				keyID: signKeyID,
				counterparty: signCounterparty,
			} = JSON.parse(listing.customInstructions)

			const newKeyID = outpoint
			const cancelAddress = await deriveCancelAddressInternal(ctx, newKeyID)
			const tags = opnsFileTags(listing)
			const name = nameFromOutput(listing)
			const inputId = readAssetIdTag(listing.tags)

			const cancelUnlock = OrdLock.cancelWithWallet(
				ctx.wallet,
				signProtocolID,
				signKeyID,
				signCounterparty,
			)

			return await executeTrackedAction(
				ctx.wallet,
				{
					description: 'Cancel OpNS listing',
					inputBEEF,
					...(inputId && {
						labels: [buildInputAssetLabel(OPNS_BASKET, inputId)],
					}),
					inputs: [
						{
							outpoint,
							inputDescription: 'Listed OpNS name',
							unlockingScriptLength: 108,
						},
					],
					outputs: [
						{
							lockingScript: new P2PKH().lock(cancelAddress).toHex(),
							satoshis: 1,
							outputDescription: 'Cancelled OpNS listing',
							basket: OPNS_BASKET,
							tags,
							customInstructions: JSON.stringify({
								protocolID: P1SAT_PROTOCOL,
								keyID: newKeyID,
								...(name && { name }),
							}),
						},
					],
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				inputBEEF,
				async (tx) => {
					const unlockingScript = await cancelUnlock.sign(tx, 0)
					return { 0: { unlockingScript: unlockingScript.toHex() } }
				},
			)
		} catch (error) {
			console.error('[cancelOpnsListing]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

export interface BuyOpnsRequest extends ActionOptions {
	outpoint: string
	/** BEEF for the listing tx; else services fetch */
	inputBEEF?: number[]
	name?: string
	origin?: string
	marketplaceAddress?: string
	marketplaceRate?: number
}

/**
 * Buy an OpNS listing and file into the OPNS basket with full tags.
 */
export const buyOpns: Action<BuyOpnsRequest, OpnsOperationResponse> = {
	meta: {
		name: 'buyOpns',
		description: 'Purchase an OpNS name listing into the OPNS basket',
		category: 'opns',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				outpoint: { type: 'string' },
				inputBEEF: { type: 'array', items: { type: 'integer' } },
				name: { type: 'string' },
				origin: { type: 'string' },
				marketplaceAddress: { type: 'string' },
				marketplaceRate: { type: 'number' },
			},
			required: ['outpoint'],
		},
	},
	async execute(ctx, input) {
		const name = input.name?.slice(0, 64)
		const origin = input.origin ?? input.outpoint
		const tags = [
			'opns',
			`type:${OPNS_CONTENT_TYPE}`,
			`origin:${origin}`,
			...(name ? [`name:${name}`] : []),
		]
		return buyOrdinal.execute(ctx, {
			outpoint: input.outpoint,
			inputBEEF: input.inputBEEF,
			marketplaceAddress: input.marketplaceAddress,
			marketplaceRate: input.marketplaceRate,
			name,
			origin,
			contentType: OPNS_CONTENT_TYPE,
			fundingProvider: input.fundingProvider,
			basket: OPNS_BASKET,
			tags,
		})
	},
}

export const opnsActions = [
	listOpns,
	internalizeOpns,
	registerOpns,
	deregisterOpns,
	sellOpns,
	sendOpns,
	cancelOpnsListing,
	buyOpns,
]
