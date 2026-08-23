/**
 * Collections Module
 *
 * Actions for creating ordinals collections and collection items.
 *
 * A collection is a regular 1-sat ordinal inscription with MAP metadata
 * where subType="collection" and subTypeData describes the collection
 * (description, quantity, traits, rarity labels).
 *
 * A collection item is a regular 1-sat ordinal inscription with MAP metadata
 * where subType="collectionItem" and subTypeData contains collectionId
 * pointing to the parent collection's origin outpoint.
 */

import { Inscription } from '@1sat/templates'
import type {
	CollectionItemAttachment,
	CollectionItemSubTypeData,
	CollectionItemTrait,
	CollectionSubTypeData,
	CollectionTraits,
	RarityLabels,
	Royalty,
} from '@1sat/types'
import { P1SAT_INTENTS, P1SAT_PROTOCOL } from '@1sat/types'
import { parseOutpoint } from '@1sat/utils'
import { P2PKH, PublicKey, Script, Utils } from '@bsv/sdk'
import { MAX_INSCRIPTION_BYTES, ORDINALS_BASKET } from '../constants'
import type { Action, ActionOptions } from '../types'
import { appendMapSuffix } from '../utils/appendMapSuffix'
import { executeSigmaAction } from '../utils/executeSigmaAction'

// ============================================================================
// Types
// ============================================================================

export interface MintCollectionInput extends ActionOptions {
	/** Base64 encoded collection artwork (icon/image) */
	base64Content: string
	/** Content type (MIME type) of the artwork */
	contentType: string
	/** Collection name */
	name: string
	/** Collection description */
	description: string
	/** Total number of items in the collection */
	quantity: number
	/** Optional trait definitions */
	traits?: CollectionTraits
	/** Optional rarity labels */
	rarityLabels?: RarityLabels
	/** Optional royalty configuration */
	royalties?: Royalty[]
	/** MAP app field (default: "1sat-wallet") */
	app?: string
}

export interface MintCollectionOutput {
	txid?: string
	/** Origin outpoint of the collection: "<txid>_0" */
	collectionId?: string
	error?: string
}

export interface MintCollectionItemInput extends ActionOptions {
	/** Base64 encoded item artwork. Mutually exclusive with `ref`. */
	base64Content?: string
	/** Existing ORDFS reference used as the item's default content. */
	ref?: string
	/** Content type of embedded artwork. Required with `base64Content`. */
	contentType?: string
	/** Item name */
	name: string
	/** Collection origin outpoint: "<txid>_<vout>" of the parent collection */
	collectionId: string
	/** Optional mint number within the collection */
	mintNumber?: number
	/** Optional rank within the collection */
	rank?: number
	/** Optional rarity label for the item */
	rarityLabel?: string
	/** Optional item traits */
	traits?: CollectionItemTrait[]
	/** Optional file attachments */
	attachments?: CollectionItemAttachment[]
	/** MAP app field (default: "1sat-wallet") */
	app?: string
}

export interface MintCollectionItemOutput {
	txid?: string
	error?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Build the 36-byte parent outpoint from a collectionId string.
 * Format: 32 bytes txid (reversed to internal byte order) + 4 bytes vout (LE).
 */
function collectionIdToParentBytes(collectionId: string): Uint8Array {
	const { txid, vout } = parseOutpoint(collectionId)
	const txidBytes = Utils.toArray(txid, 'hex').reverse()
	const writer = new Utils.Writer()
	writer.write(txidBytes)
	writer.writeUInt32LE(vout)
	return new Uint8Array(writer.toArray())
}

/**
 * Build MAP metadata record for a collection parent.
 * All values must be strings for MAP protocol.
 */
function buildCollectionMap(
	input: MintCollectionInput,
): Record<string, string> {
	const subTypeData: CollectionSubTypeData = {
		description: input.description,
		quantity: input.quantity,
		rarityLabels: input.rarityLabels ?? [],
		traits: input.traits ?? {},
	}

	const map: Record<string, string> = {
		app: input.app ?? '1sat-wallet',
		type: 'ord',
		name: input.name,
		subType: 'collection',
		subTypeData: JSON.stringify(subTypeData),
	}

	if (input.royalties && input.royalties.length > 0) {
		map.royalties = JSON.stringify(input.royalties)
	}

	return map
}

/**
 * Build MAP metadata record for a collection item.
 * All values must be strings for MAP protocol.
 */
function buildCollectionItemMap(
	input: MintCollectionItemInput,
): Record<string, string> {
	const subTypeData: CollectionItemSubTypeData = {
		collectionId: input.collectionId,
		...(input.mintNumber !== undefined && { mintNumber: input.mintNumber }),
		...(input.rank !== undefined && { rank: input.rank }),
		...(input.rarityLabel !== undefined && {
			rarityLabel: input.rarityLabel,
		}),
		...(input.traits && input.traits.length > 0 && { traits: input.traits }),
		...(input.attachments &&
			input.attachments.length > 0 && { attachments: input.attachments }),
	}

	return {
		app: input.app ?? '1sat-wallet',
		type: 'ord',
		name: input.name,
		subType: 'collectionItem',
		subTypeData: JSON.stringify(subTypeData),
	}
}

/**
 * Build an inscription locking script with P2PKH + MAP suffix.
 */
function buildInscriptionScript(
	address: string,
	content: Uint8Array,
	contentType: string,
	map: Record<string, string>,
	parent?: Uint8Array,
): Script {
	const p2pkhScript = new P2PKH().lock(address)

	const inscription = Inscription.create(content, contentType, {
		scriptSuffix: p2pkhScript,
		parent,
	})
	return appendMapSuffix(new Script(inscription.lock().chunks), map)
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Create a collection parent inscription.
 */
export const mintCollection: Action<MintCollectionInput, MintCollectionOutput> =
	{
		meta: {
			name: 'mintCollection',
			description:
				'Create a new ordinals collection with traits, rarity labels, and royalty configuration',
			category: 'collections',
			inputSchema: {
				type: 'object',
				properties: {
					base64Content: {
						type: 'string',
						description: 'Base64 encoded collection artwork',
					},
					contentType: {
						type: 'string',
						description: 'Content type (MIME type)',
					},
					name: {
						type: 'string',
						description: 'Collection name',
					},
					description: {
						type: 'string',
						description: 'Collection description',
					},
					quantity: {
						type: 'integer',
						description: 'Total number of items in the collection',
					},
					traits: {
						type: 'object',
						description: 'Optional trait definitions',
					},
					rarityLabels: {
						type: 'array',
						description: 'Optional rarity labels',
					},
					royalties: {
						type: 'array',
						description: 'Optional royalty configuration',
					},
					app: {
						type: 'string',
						description: 'MAP app field (default: "1sat-wallet")',
					},
				},
				required: [
					'base64Content',
					'contentType',
					'name',
					'description',
					'quantity',
				],
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

				if (input.quantity < 1) {
					return { error: 'quantity-must-be-positive' }
				}

				const keyID = Date.now().toString()
				const { publicKey } = await ctx.wallet.getPublicKey({
					protocolID: P1SAT_PROTOCOL,
					keyID,
					counterparty: 'self',
					forSelf: true,
				})
				const address = PublicKey.fromString(publicKey).toAddress()

				const map = buildCollectionMap(input)
				const lockingScript = buildInscriptionScript(
					address,
					new Uint8Array(decoded),
					input.contentType,
					map,
				)

				const tags = [
					`type:${input.contentType}`,
					'origin',
					`name:${input.name.slice(0, 64)}`,
					'subType:collection',
				]

				const result = await executeSigmaAction(
					ctx,
					{
						description: `Create collection: ${input.name}`,
						outputs: [
							{
								lockingScript: lockingScript.toHex(),
								satoshis: 1,
								outputDescription: 'Collection inscription',
								basket: ORDINALS_BASKET,
								tags,
								customInstructions: JSON.stringify({
									protocolID: P1SAT_PROTOCOL,
									keyID,
									name: input.name.slice(0, 64),
								}),
							},
						],
						options: {
							acceptDelayedBroadcast: false,
							randomizeOutputs: false,
						},
					},
					P1SAT_INTENTS.ORDINAL_MINT_COLLECTION,
					input.fundingProvider,
				)

				if (!result.txid) {
					return { error: 'no-txid-returned' }
				}

				const collectionId = `${result.txid}_0`

				if (ctx.debug && ctx.log) {
					ctx.log({
						timestamp: new Date().toISOString(),
						action: 'mintCollection',
						input: {
							contentType: input.contentType,
							name: input.name,
							quantity: input.quantity,
						},
						txid: result.txid,
						rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
						outputs: [
							{
								index: 0,
								protocolID: P1SAT_PROTOCOL,
								keyID,
								basket: ORDINALS_BASKET,
								satoshis: 1,
							},
						],
					})
				}

				return {
					txid: result.txid,
					collectionId,
				}
			} catch (error) {
				console.error('[mintCollection]', error)
				if (ctx.debug && ctx.log) {
					ctx.log({
						timestamp: new Date().toISOString(),
						action: 'mintCollection',
						input: { name: input.name },
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
 * Create a collection item inscription linked to a parent collection.
 */
export const mintCollectionItem: Action<
	MintCollectionItemInput,
	MintCollectionItemOutput
> = {
	meta: {
		name: 'mintCollectionItem',
		description:
			'Create a collection item inscription linked to a parent collection via collectionId',
		category: 'collections',
		inputSchema: {
			type: 'object',
			properties: {
				base64Content: {
					type: 'string',
					description:
						'Base64 encoded item artwork; mutually exclusive with ref',
				},
				ref: {
					type: 'string',
					description:
						'Existing ORDFS reference used as the item default content',
				},
				contentType: {
					type: 'string',
					description: 'Content type (MIME type)',
				},
				name: {
					type: 'string',
					description: 'Item name',
				},
				collectionId: {
					type: 'string',
					description:
						'Collection origin outpoint: "<txid>_<vout>" of the parent collection',
				},
				mintNumber: {
					type: 'integer',
					description: 'Optional mint number within the collection',
				},
				rank: {
					type: 'integer',
					description: 'Optional rank within the collection',
				},
				rarityLabel: {
					type: 'string',
					description: 'Optional rarity label for the item',
				},
				traits: {
					type: 'array',
					description: 'Optional item traits',
				},
				attachments: {
					type: 'array',
					description: 'Optional file attachments',
				},
				app: {
					type: 'string',
					description: 'MAP app field (default: "1sat-wallet")',
				},
			},
			required: ['name', 'collectionId'],
		},
	},
	async execute(ctx, input) {
		try {
			const hasContent = input.base64Content !== undefined
			const hasRef = input.ref !== undefined
			if (hasContent === hasRef) {
				return { error: 'exactly-one-of-base64Content-or-ref-required' }
			}
			if (hasContent && !input.contentType) {
				return { error: 'contentType-required-with-base64Content' }
			}
			if (
				hasRef &&
				!/^(_\d+|[0-9a-fA-F]{64}_\d+(:-?\d+)?)$/.test(input.ref as string)
			) {
				return { error: `invalid-ref: ${input.ref}` }
			}

			const content = hasRef
				? new Uint8Array(
						Utils.toArray(JSON.stringify({ '.': input.ref as string }), 'utf8'),
					)
				: new Uint8Array(Utils.toArray(input.base64Content as string, 'base64'))
			const contentType = hasRef ? 'ord-fs/json' : (input.contentType as string)

			if (content.length > MAX_INSCRIPTION_BYTES) {
				return {
					error: `Inscription data too large: ${content.length} bytes (max ${MAX_INSCRIPTION_BYTES})`,
				}
			}

			// Validate collectionId format
			let parentBytes: Uint8Array
			try {
				parentBytes = collectionIdToParentBytes(input.collectionId)
			} catch {
				return { error: `Invalid collectionId format: ${input.collectionId}` }
			}

			const keyID = Date.now().toString()
			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: P1SAT_PROTOCOL,
				keyID,
				counterparty: 'self',
				forSelf: true,
			})
			const address = PublicKey.fromString(publicKey).toAddress()

			const map = buildCollectionItemMap(input)
			const lockingScript = buildInscriptionScript(
				address,
				content,
				contentType,
				map,
				parentBytes,
			)

			const tags = [
				`type:${contentType}`,
				'origin',
				`name:${input.name.slice(0, 64)}`,
				'subType:collectionItem',
				`collectionId:${input.collectionId}`,
			]

			const result = await executeSigmaAction(
				ctx,
				{
					description: `Create collection item: ${input.name}`,
					outputs: [
						{
							lockingScript: lockingScript.toHex(),
							satoshis: 1,
							outputDescription: 'Collection item inscription',
							basket: ORDINALS_BASKET,
							tags,
							customInstructions: JSON.stringify({
								protocolID: P1SAT_PROTOCOL,
								keyID,
								name: input.name.slice(0, 64),
							}),
						},
					],
					options: {
						acceptDelayedBroadcast: false,
						randomizeOutputs: false,
					},
				},
				P1SAT_INTENTS.ORDINAL_MINT_ITEM,
				input.fundingProvider,
			)

			if (!result.txid) {
				return { error: 'no-txid-returned' }
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'mintCollectionItem',
					input: {
						contentType,
						name: input.name,
						collectionId: input.collectionId,
						mintNumber: input.mintNumber,
					},
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: P1SAT_PROTOCOL,
							keyID,
							basket: ORDINALS_BASKET,
							satoshis: 1,
						},
					],
				})
			}

			return { txid: result.txid }
		} catch (error) {
			console.error('[mintCollectionItem]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'mintCollectionItem',
					input: {
						name: input.name,
						collectionId: input.collectionId,
					},
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

/** All collection actions for registry */
export const collectionsActions = [mintCollection, mintCollectionItem]
