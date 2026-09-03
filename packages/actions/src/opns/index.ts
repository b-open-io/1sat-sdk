/**
 * OpNS Module
 *
 * Wallet-owned names live in OPNS_BASKET with id: tags.
 * Self-moves: id → one loadBasketOutputBeef → ordinalSeedTags + domain tags.
 * Ingress (internalizeOpns / buyOpns) stamps full tags including id:.
 */

import { OpNS, OrdLock, outpointToBytes } from '@1sat/templates'
import {
	OPNS_BASKET,
	OPNS_PUBLISHED_TAG,
	OPNS_REGISTER_COUNTERPARTY,
	OPNS_REGISTER_SIG_PLACEHOLDER_LEN,
	P1SAT_PROTOCOL,
	buildInputAssetLabel,
	formatOrdinalOutpoint,
	opnsRegisterKeyId,
	readAssetIdTag,
} from '@1sat/types'
import {
	type BEEF,
	type CreateActionArgs,
	P2PKH,
	PublicKey,
	PushDrop,
	Transaction,
	Utils,
	type WalletCounterparty,
	type WalletOutput,
	type WalletProtocol,
} from '@bsv/sdk'
import { prepareP1SatArgs } from '../apply/index.js'
import {
	buildOrdLockScript,
	buyOrdinal,
	defaultPayAddress,
	deriveCancelAddressInternal,
} from '../ordinals/index.js'
import type { Action, ActionOptions, OneSatContext } from '../types.js'
import {
	executeTrackedAction,
	randomActionId,
} from '../utils/createTrackedAction.js'
import { loadBasketOutputBeef } from '../utils/loadBasketOutput.js'
import { buildOrdinalCustomInstructions } from '../utils/ordinalRemittance.js'
import { ordinalSeedTags } from '../utils/ordinalSeedTags.js'
import { unlockingScriptLengthForInstructions } from '../utils/signOrdinalInput.js'

const OPNS_CONTENT_TYPE = 'application/op-ns'

/**
 * Presentation slots published after the identity key: slot 1 display name
 * (utf8), slot 2 avatar origin outpoint (36 bytes). Slot 1 is an empty push
 * when only an avatar is set; trailing unset slots are omitted.
 */
function profileFields(profileName?: string, avatar?: string): number[][] {
	const displayName = profileName?.trim() ?? ''
	const origin = avatar?.trim() ?? ''
	if (!displayName && !origin) return []

	const nameField = displayName ? Utils.toArray(displayName, 'utf8') : []
	if (!origin) return [nameField]

	const avatarField = outpointToBytes(formatOrdinalOutpoint(origin))
	if (!avatarField) throw new Error(`invalid avatar outpoint: ${origin}`)
	return [nameField, avatarField]
}

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

export interface RegisterOpnsRequest extends OpnsIdInput {
	/**
	 * Display name returned by the paymail public-profile capability.
	 * Presentation only — the OpNS name is the unique, owned value.
	 */
	profileName?: string
	/** Origin outpoint (`txid_vout`) of an on-chain image ordinal */
	avatar?: string
}

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
								`origin:${formatOrdinalOutpoint(outpoint)}`,
								// OpNS keeps name: for listOutputs filter (domain key)
								`name:${name}`,
								idTag,
							],
							customInstructions: buildOrdinalCustomInstructions({
								protocolID: input.protocolID,
								keyID: input.keyID,
								counterparty,
								tags: [`origin:${formatOrdinalOutpoint(outpoint)}`],
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
					profileName: {
						type: 'string',
						description: 'Display name for paymail public-profile',
					},
					avatar: {
						type: 'string',
						description:
							'Origin outpoint (txid_vout) of an on-chain image ordinal',
					},
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

				const keyID = opnsRegisterKeyId(output.outpoint)
				const { publicKey: identityPubKey } = await ctx.wallet.getPublicKey({
					identityKey: true,
				})
				// Complete script, signature field zeroed — apply swaps in the real
				// signature, so the size here is the size on chain.
				const unsealedLock = await new PushDrop(ctx.wallet).lock(
					[
						Utils.toArray(identityPubKey, 'hex'),
						...profileFields(input.profileName, input.avatar),
						new Array(OPNS_REGISTER_SIG_PLACEHOLDER_LEN).fill(0),
					],
					P1SAT_PROTOCOL,
					keyID,
					OPNS_REGISTER_COUNTERPARTY,
					true,
					false,
				)
				const name = nameFromOutput(output)
				const tags = opnsFileTags(output, [OPNS_PUBLISHED_TAG])
				const inputId = readAssetIdTag(output.tags)
				const labels = [
					...(inputId ? [buildInputAssetLabel(OPNS_BASKET, inputId)] : []),
				]

				const args: CreateActionArgs = {
					description: (name
						? `Publish OpNS ${name}`
						: 'Publish OpNS name'
					).slice(0, 50),
					inputBEEF: beef,
					labels,
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
							lockingScript: unsealedLock.toHex(),
							satoshis: 1,
							outputDescription: 'OpNS identity bind',
							basket: OPNS_BASKET,
							tags,
							customInstructions: buildOrdinalCustomInstructions({
								protocolID: P1SAT_PROTOCOL,
								keyID,
								counterparty: OPNS_REGISTER_COUNTERPARTY,
								tags,
								name,
							}),
						},
					],
					options: { randomizeOutputs: false },
				}

				await prepareP1SatArgs(ctx, args)

				return await executeTrackedAction(
					ctx.wallet,
					args,
					input.fundingProvider,
					beef,
					undefined,
					{
						spends: inputId ? [{ basket: OPNS_BASKET, id: inputId }] : [],
						usePermissionModule:
							input.usePermissionModule ??
							input.useOneSatModule ??
							input.useModule,
						permissionScheme: 'opns',
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
			const args: CreateActionArgs = {
				description: (name
					? `Unpublish OpNS ${name}`
					: 'Unpublish OpNS name'
				).slice(0, 50),
				inputBEEF: beef,
				labels: [
					...(inputId ? [buildInputAssetLabel(OPNS_BASKET, inputId)] : []),
				],
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
						customInstructions: buildOrdinalCustomInstructions({
							protocolID: P1SAT_PROTOCOL,
							keyID: outpoint,
							tags,
							name,
						}),
					},
				],
				options: { randomizeOutputs: false },
			}
			await prepareP1SatArgs(ctx, args)

			return await executeTrackedAction(
				ctx.wallet,
				args,
				input.fundingProvider,
				beef,
				undefined,
				{
					spends: inputId ? [{ basket: OPNS_BASKET, id: inputId }] : [],
					usePermissionModule:
						input.usePermissionModule ??
						input.useOneSatModule ??
						input.useModule,
					permissionScheme: 'opns',
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
			const ordLockScript = buildOrdLockScript(
				cancelAddress,
				payAddress,
				input.price,
			)
			const lockingScript = ordLockScript.toHex()

			// Read the price back out of the script we just built, so the tag
			// can never drift from what the chain will actually enforce.
			const encoded = OrdLock.decode(ordLockScript)
			if (!encoded) {
				throw new Error('sellOpns: built OrdLock script failed to decode')
			}
			const tags = opnsFileTags(output, ['ordlock', `price:${encoded.price}`])
			const name = nameFromOutput(output)
			const inputId = readAssetIdTag(output.tags)
			const args: CreateActionArgs = {
				description: `List OpNS for ${input.price} sats`.slice(0, 50),
				inputBEEF: beef,
				labels: [
					...(inputId ? [buildInputAssetLabel(OPNS_BASKET, inputId)] : []),
				],
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
						customInstructions: buildOrdinalCustomInstructions({
							protocolID: P1SAT_PROTOCOL,
							keyID: outpoint,
							tags,
							name,
						}),
					},
				],
				options: { randomizeOutputs: false },
			}
			await prepareP1SatArgs(ctx, args)

			return await executeTrackedAction(
				ctx.wallet,
				args,
				input.fundingProvider,
				beef,
				undefined,
				{
					spends: inputId ? [{ basket: OPNS_BASKET, id: inputId }] : [],
					usePermissionModule:
						input.usePermissionModule ??
						input.useOneSatModule ??
						input.useModule,
					permissionScheme: 'opns',
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
			const args: CreateActionArgs = {
				description: (name
					? `Transfer OpNS ${name}`
					: 'Transfer OpNS name'
				).slice(0, 50),
				inputBEEF: beef,
				labels: [
					...(inputId ? [buildInputAssetLabel(OPNS_BASKET, inputId)] : []),
				],
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
								customInstructions: buildOrdinalCustomInstructions({
									protocolID: P1SAT_PROTOCOL,
									keyID: outpoint,
									tags,
									name,
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
			}
			await prepareP1SatArgs(ctx, args)

			return await executeTrackedAction(
				ctx.wallet,
				args,
				input.fundingProvider,
				beef,
				undefined,
				{
					spends: inputId ? [{ basket: OPNS_BASKET, id: inputId }] : [],
					usePermissionModule:
						input.usePermissionModule ??
						input.useOneSatModule ??
						input.useModule,
					permissionScheme: 'opns',
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

			const args: CreateActionArgs = {
				description: (name
					? `Cancel OpNS listing ${name}`
					: 'Cancel OpNS listing'
				).slice(0, 50),
				inputBEEF,
				labels: [
					...(inputId ? [buildInputAssetLabel(OPNS_BASKET, inputId)] : []),
				],
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
						customInstructions: buildOrdinalCustomInstructions({
							protocolID: P1SAT_PROTOCOL,
							keyID: newKeyID,
							tags,
							name,
						}),
					},
				],
				options: { randomizeOutputs: false },
			}
			await prepareP1SatArgs(ctx, args)

			return await executeTrackedAction(
				ctx.wallet,
				args,
				input.fundingProvider,
				inputBEEF,
				undefined,
				{
					spends: inputId ? [{ basket: OPNS_BASKET, id: inputId }] : [],
					usePermissionModule:
						input.usePermissionModule ??
						input.useOneSatModule ??
						input.useModule,
					permissionScheme: 'opns',
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
		// Hints pass straight through — undefined when the caller has none.
		// `resolveOrdinalTags` resolves origin from ORDFS and, for op-ns content,
		// reads the name from the origin's inscription.
		return buyOrdinal.execute(ctx, {
			outpoint: input.outpoint,
			inputBEEF: input.inputBEEF,
			marketplaceAddress: input.marketplaceAddress,
			marketplaceRate: input.marketplaceRate,
			name: input.name?.slice(0, 64),
			origin: input.origin,
			contentType: OPNS_CONTENT_TYPE,
			fundingProvider: input.fundingProvider,
			basket: OPNS_BASKET,
			tags: ['opns'],
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
