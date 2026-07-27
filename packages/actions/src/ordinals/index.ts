/**
 * Ordinals Module
 *
 * Actions for managing ordinals/inscriptions.
 * Returns WalletOutput[] directly from the SDK - no custom mapping needed.
 */

import { MAP as MAPTemplate } from '@1sat/templates'
import { OrdLock } from '@1sat/templates'
import {
	P1SAT_INTENTS,
	buildInputAssetLabel,
	nameFromMap,
	ordinalTagsFromMetadata,
	readAssetIdTag,
} from '@1sat/types'
import { parseOutpoint } from '@1sat/utils'
import {
	type BEEF,
	Beef,
	BigNumber,
	type CreateActionArgs,
	LockingScript,
	OP,
	P2PKH,
	PublicKey,
	Script,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletOutput,
} from '@bsv/sdk'
import { prepareP1SatArgs } from '../apply'
import {
	OPNS_BASKET,
	ORDINALS_BASKET,
	ORD_LOCK_PREFIX,
	ORD_LOCK_SUFFIX,
	P1SAT_PROTOCOL,
} from '../constants'
import type {
	Action,
	ActionLogEntry,
	ActionOptions,
	OneSatContext,
} from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { loadBasketOutputBeef } from '../utils/loadBasketOutput'
import { ordinalSeedTags } from '../utils/ordinalSeedTags'
import {
	signOrdinalInput,
	unlockingScriptLengthForInstructions,
} from '../utils/signOrdinalInput'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve ordinal tags (type, origin, name) and basket for a self-spend output.
 * Fetches missing data from ORDFS when services are available.
 *
 * Source can be either existing tags (from a WalletOutput) or explicit fields
 * (from metadata or function args). Both are normalized into the same resolution.
 */
export async function resolveOrdinalTags(
	ctx: OneSatContext,
	outpoint: string,
	source?: {
		tags?: string[]
		contentType?: string
		origin?: string
		name?: string
	},
): Promise<{ tags: string[]; basket: string }> {
	// Extract known values from source tags or explicit fields.
	// `type:` is hierarchical (e.g. both `type:image` and `type:image/png`)
	// — collect every value so we can re-emit the full set.
	const contentTypes: string[] = source?.contentType ? [source.contentType] : []
	let origin = source?.origin
	let name = source?.name

	if (source?.tags) {
		for (const tag of source.tags) {
			if (tag.startsWith('type:')) {
				const ct = tag.slice(5)
				if (!contentTypes.includes(ct)) contentTypes.push(ct)
			}
			if (!origin && tag === 'origin') origin = outpoint
			else if (!origin && tag.startsWith('origin:')) origin = tag.slice(7)
			if (name === undefined && tag.startsWith('name:')) name = tag.slice(5)
		}
	}
	// Primary content type for downstream branching (basket selection, OPNS,
	// MAP-name extraction). Most specific value comes last when the indexer
	// pushes hierarchical `[category, fullType]`, so pick the trailing entry.
	const contentType =
		contentTypes.length > 0 ? contentTypes[contentTypes.length - 1] : undefined

	// Fetch missing type/origin from ORDFS metadata (seq -2 = origin resolution)
	let resolvedContentType = contentType
	if ((!resolvedContentType || !origin) && ctx.services) {
		try {
			const metadata = await ctx.services.ordfs.getMetadata(outpoint, -2)

			// Canonical tags from the shared builder, then split back out —
			// every ORDFS-derived tag decision lives in one place.
			for (const tag of ordinalTagsFromMetadata(metadata)) {
				if (tag.startsWith('type:')) {
					const ct = tag.slice(5)
					if (!contentTypes.includes(ct)) contentTypes.push(ct)
				}
			}
			if (!resolvedContentType && metadata.contentType) {
				resolvedContentType = metadata.contentType
			}

			// ORDFS is authoritative for origin. A caller-supplied value is a
			// hint at best — for a listing it is the seller's outpoint, which
			// is not an origin at all.
			origin = metadata.origin ?? origin

			// Non-OPNS: MAP metadata carries the name. OpNS derives its own
			// from the inscription content, below.
			if (
				name === undefined &&
				resolvedContentType !== 'application/op-ns'
			) {
				name = nameFromMap(metadata.map)
			}
		} catch {
			// Fall through with whatever we have
		}
	}

	// No outpoint fallback. An outpoint is not an origin — for a listing it is
	// the seller's output, which holds no inscription. When ORDFS could not
	// resolve one, emit no origin tag rather than a false one; the same rule
	// `OriginIndexer` and `verifyOrdinal` follow.

	// OPNS: name is inscription content
	if (
		name === undefined &&
		resolvedContentType === 'application/op-ns' &&
		origin &&
		ctx.services
	) {
		try {
			const content = await ctx.services.ordfs.getContent(origin)
			name = new TextDecoder().decode(content.data).trim()
		} catch {
			// Fall through
		}
	}

	const tags: string[] = []
	for (const ct of contentTypes) tags.push(`type:${ct}`)
	if (origin) tags.push(`origin:${origin}`)
	if (name) tags.push(`name:${name.slice(0, 64)}`)

	const basket =
		resolvedContentType === 'application/op-ns' ? OPNS_BASKET : ORDINALS_BASKET

	return { tags, basket }
}

// ============================================================================
// Types
// ============================================================================

type PubKeyHex = string

export interface TransferItem {
	/** Tracking id in the ordinals basket (wallet-owned) */
	id: string
	/** Recipient's identity public key (preferred) */
	counterparty?: PubKeyHex
	/** Raw P2PKH address */
	address?: string
	/** Optional MAP metadata to append to the output script */
	map?: Record<string, string>
}

export interface TransferOrdinalsRequest extends ActionOptions {
	/** Ordinals to transfer with their destinations */
	transfers: TransferItem[]
}

export interface BurnOrdinalsRequest extends ActionOptions {
	/** Tracking ids in the ordinals basket */
	ids: string[]
	/** Application name for MAP metadata (default: "1sat") */
	app?: string
}

export interface SellOrdinalRequest extends ActionOptions {
	/** Tracking id in the ordinals basket (wallet-owned) */
	id: string
	/** Price in satoshis */
	price: number
	/** Payment receive address; default P1SAT keyID `1sat 0` */
	payAddress?: string
	/** Optional MAP metadata to append to the listing output script */
	map?: Record<string, string>
}

export interface BuyOrdinalRequest extends ActionOptions {
	/** Outpoint of listing to purchase */
	outpoint: string
	/** BEEF for the listing tx (hex/bytes); else services fetch */
	inputBEEF?: number[]
	/** Marketplace address for fees */
	marketplaceAddress?: string
	/** Marketplace fee rate (0-1) */
	marketplaceRate?: number
	/** Optional content type - looked up from ordfs API if not provided */
	contentType?: string
	/** Optional origin outpoint - looked up from ordfs API if not provided */
	origin?: string
	/** Optional name from MAP metadata - looked up from ordfs API if not provided */
	name?: string
	/** Basket for the purchased output (default: ordinals) */
	basket?: string
	/** Tags for the purchased output; default resolveOrdinalTags for ordinals ingress */
	tags?: string[]
	/** Override intent (e.g. buyOpns → opns.purchase). Default ordinal.purchase. */
	p1satIntent?: string
}

export interface OrdinalOperationResponse {
	txid?: string
	tx?: number[]
	error?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Cancel/list key address for an outpoint (P1SAT self). */
export async function deriveCancelAddressInternal(
	ctx: OneSatContext,
	outpoint: string,
): Promise<string> {
	const result = await ctx.wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID: outpoint,
		forSelf: true,
	})
	return PublicKey.fromString(result.publicKey).toAddress()
}

/** Default OrdLock payment address: P1SAT keyID `1sat 0`, self. */
export async function defaultPayAddress(ctx: OneSatContext): Promise<string> {
	const result = await ctx.wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID: '1sat 0',
		counterparty: 'self',
		forSelf: true,
	})
	return PublicKey.fromString(result.publicKey).toAddress()
}

export function buildOrdLockScript(
	ordAddress: string,
	payAddress: string,
	price: number,
): Script {
	const cancelPkh = Utils.fromBase58Check(ordAddress).data as number[]
	const payPkh = Utils.fromBase58Check(payAddress).data as number[]
	const payoutScript = new P2PKH().lock(payPkh).toBinary()

	const writer = new Utils.Writer()
	writer.writeUInt64LEBn(new BigNumber(price))
	writer.writeVarIntNum(payoutScript.length)
	writer.write(payoutScript)
	const payoutOutput = writer.toArray()

	return new Script()
		.writeScript(Script.fromHex(ORD_LOCK_PREFIX))
		.writeBin(cancelPkh)
		.writeBin(payoutOutput)
		.writeScript(Script.fromHex(ORD_LOCK_SUFFIX))
}

function buildSerializedOutput(satoshis: number, script: number[]): number[] {
	const writer = new Utils.Writer()
	writer.writeUInt64LEBn(new BigNumber(satoshis))
	writer.writeVarIntNum(script.length)
	writer.write(script)
	return writer.toArray()
}

async function buildPurchaseUnlockingScript(
	tx: Transaction,
	inputIndex: number,
	sourceSatoshis: number,
	lockingScript: LockingScript,
): Promise<UnlockingScript> {
	if (tx.outputs.length < 2) {
		throw new Error('Malformed transaction: requires at least 2 outputs')
	}

	const script = new UnlockingScript().writeBin(
		buildSerializedOutput(
			tx.outputs[0].satoshis ?? 0,
			tx.outputs[0].lockingScript.toBinary(),
		),
	)

	if (tx.outputs.length > 2) {
		const writer = new Utils.Writer()
		for (const output of tx.outputs.slice(2)) {
			writer.write(
				buildSerializedOutput(
					output.satoshis ?? 0,
					output.lockingScript.toBinary(),
				),
			)
		}
		script.writeBin(writer.toArray())
	} else {
		script.writeOpCode(OP.OP_0)
	}

	const input = tx.inputs[inputIndex]
	const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
	if (!sourceTXID) {
		throw new Error('sourceTXID is required')
	}

	const preimage = TransactionSignature.format({
		sourceTXID,
		sourceOutputIndex: input.sourceOutputIndex,
		sourceSatoshis,
		transactionVersion: tx.version,
		otherInputs: [],
		inputIndex,
		outputs: tx.outputs,
		inputSequence: input.sequence ?? 0xffffffff,
		subscript: lockingScript,
		lockTime: tx.lockTime,
		scope:
			TransactionSignature.SIGHASH_ALL |
			TransactionSignature.SIGHASH_ANYONECANPAY |
			TransactionSignature.SIGHASH_FORKID,
	})

	return script.writeBin(preimage).writeOpCode(OP.OP_0)
}

// ============================================================================
// Builder functions (utilities for advanced use)
// ============================================================================

async function loadOrdinalSpend(
	ctx: OneSatContext,
	id: string,
): Promise<{ output: WalletOutput; beef: number[] } | { error: string }> {
	return loadBasketOutputBeef(ctx.wallet, ORDINALS_BASKET, id)
}

function nameFromOutput(
	output: WalletOutput,
	tags?: string[],
): string | undefined {
	if (output.customInstructions) {
		try {
			const n = JSON.parse(output.customInstructions).name
			if (typeof n === 'string' && n) return n.slice(0, 64)
		} catch {}
	}
	const fromTags = (tags ?? output.tags)
		?.find((t) => t.startsWith('name:'))
		?.slice(5)
	return fromTags?.slice(0, 64)
}

/**
 * Build CreateActionArgs for transferring one or more ordinals.
 * Loads each id once from the ordinals basket.
 */
export async function buildTransferOrdinals(
	ctx: OneSatContext,
	request: TransferOrdinalsRequest,
): Promise<
	(CreateActionArgs & { sources: WalletOutput[] }) | { error: string }
> {
	const { transfers } = request

	if (!transfers.length) {
		return { error: 'no-transfers' }
	}

	const inputs: CreateActionArgs['inputs'] = []
	const outputs: CreateActionArgs['outputs'] = []
	const labels: string[] = []
	const sources: WalletOutput[] = []
	const beefParts: number[][] = []

	for (const item of transfers) {
		const { id, counterparty, address, map } = item
		if (!id) return { error: 'missing-id' }
		if (!counterparty && !address) {
			return { error: 'must-provide-counterparty-or-address' }
		}

		const loaded = await loadOrdinalSpend(ctx, id)
		if ('error' in loaded) return loaded
		const { output: ordinal, beef } = loaded
		sources.push(ordinal)
		beefParts.push(beef)

		const outpoint = ordinal.outpoint
		const sourceType = ordinal.tags
			?.find((t) => t.startsWith('type:'))
			?.slice(5)
		if (sourceType === 'application/bsv-20') {
			return {
				error: `Cannot transfer BSV-20 token ${outpoint} through ordinal transfer — use BSV-21 transfer instead`,
			}
		}

		const isSelf = counterparty === 'self'

		let recipientAddress: string
		if (counterparty) {
			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: P1SAT_PROTOCOL,
				keyID: outpoint,
				counterparty,
				forSelf: isSelf,
			})
			recipientAddress = PublicKey.fromString(publicKey).toAddress()
		} else if (address) {
			recipientAddress = address
		} else {
			return { error: 'must-provide-counterparty-or-address' }
		}

		const tags = ordinalSeedTags(ordinal)
		const basket = ORDINALS_BASKET

		inputs?.push({
			outpoint,
			inputDescription: 'Ordinal to transfer',
			unlockingScriptLength: unlockingScriptLengthForInstructions(
				ordinal.customInstructions,
			),
		})

		const inputId = readAssetIdTag(ordinal.tags)
		if (inputId) labels.push(buildInputAssetLabel(basket, inputId))

		const p2pkhScript = new P2PKH().lock(recipientAddress)
		let lockingScript: string
		if (map && Object.keys(map).length > 0) {
			const mapScript = MAPTemplate.set(map)
			const combined = new Script()
			for (const chunk of p2pkhScript.chunks) combined.chunks.push(chunk)
			for (const chunk of mapScript.chunks) combined.chunks.push(chunk)
			lockingScript = new LockingScript(combined.chunks).toHex()
		} else {
			lockingScript = p2pkhScript.toHex()
		}

		const sourceName = nameFromOutput(ordinal, tags)

		if (isSelf) {
			outputs?.push({
				lockingScript,
				satoshis: 1,
				outputDescription: 'Ordinal self-transfer',
				basket,
				tags,
				customInstructions: JSON.stringify({
					protocolID: P1SAT_PROTOCOL,
					keyID: outpoint,
					...(sourceName && { name: sourceName }),
				}),
			})
		} else {
			outputs?.push({
				lockingScript,
				satoshis: 1,
				outputDescription: address
					? 'Ordinal transfer to external address'
					: 'Ordinal transfer',
				tags: [],
			})
		}
	}

	if (!beefParts.length) return { error: 'missing-input-beef' }
	const inputBEEF = beefParts[0]

	return {
		description:
			transfers.length === 1
				? 'Transfer ordinal'
				: `Transfer ${transfers.length} ordinals`,
		inputBEEF,
		inputs,
		outputs,
		labels,
		sources,
	}
}

/**
 * Build CreateActionArgs for listing an ordinal for sale.
 * Loads id once from the ordinals basket.
 */
export async function buildListOrdinal(
	ctx: OneSatContext,
	request: SellOrdinalRequest,
): Promise<(CreateActionArgs & { source: WalletOutput }) | { error: string }> {
	const { id, price, map } = request

	if (!id) return { error: 'missing-id' }
	if (price <= 0) return { error: 'invalid-price' }

	const loaded = await loadOrdinalSpend(ctx, id)
	if ('error' in loaded) return loaded
	const { output: ordinal, beef } = loaded

	const payAddress = request.payAddress ?? (await defaultPayAddress(ctx))
	const outpoint = ordinal.outpoint

	const cancelAddress = await deriveCancelAddressInternal(ctx, outpoint)
	const ordLockScript = buildOrdLockScript(cancelAddress, payAddress, price)

	// Append MAP metadata when provided — OP_RETURN terminates before the
	// MAP data, so the OrdLock spend paths are unaffected.
	let lockingScript: string
	if (map && Object.keys(map).length > 0) {
		const mapScript = MAPTemplate.set(map)
		const combined = new Script()
		for (const chunk of ordLockScript.chunks) combined.chunks.push(chunk)
		for (const chunk of mapScript.chunks) combined.chunks.push(chunk)
		lockingScript = new LockingScript(combined.chunks).toHex()
	} else {
		lockingScript = ordLockScript.toHex()
	}

	// Read the price back out of the script we just built, so the tag can
	// never drift from what the chain will actually enforce.
	const encoded = OrdLock.decode(ordLockScript)
	if (!encoded) {
		throw new Error('sellOrdinal: built OrdLock script failed to decode')
	}

	const tags = [
		...ordinalSeedTags(ordinal),
		'ordlock',
		`price:${encoded.price}`,
	]
	const basket = ORDINALS_BASKET
	const sourceName = nameFromOutput(ordinal, tags)

	const inputId = readAssetIdTag(ordinal.tags)
	const labels = inputId ? [buildInputAssetLabel(basket, inputId)] : undefined

	return {
		description: `List ordinal for ${price} sats`,
		inputBEEF: beef,
		...(labels && { labels }),
		inputs: [
			{
				outpoint,
				inputDescription: 'Ordinal to list',
				unlockingScriptLength: unlockingScriptLengthForInstructions(
					ordinal.customInstructions,
				),
			},
		],
		outputs: [
			{
				lockingScript,
				satoshis: 1,
				outputDescription: `List ordinal for ${price} sats`,
				basket,
				tags,
				customInstructions: JSON.stringify({
					protocolID: P1SAT_PROTOCOL,
					keyID: outpoint,
					...(sourceName && { name: sourceName }),
				}),
			},
		],
		source: ordinal,
	}
}

/**
 * Build CreateActionArgs for burning one or more ordinals.
 * Does NOT execute - returns params for createAction.
 */
export async function buildBurnOrdinals(
	ctx: OneSatContext,
	request: BurnOrdinalsRequest,
): Promise<
	(CreateActionArgs & { sources: WalletOutput[] }) | { error: string }
> {
	const ordinals: WalletOutput[] = []
	const beefParts: number[][] = []

	if (!request.ids?.length) {
		return { error: 'no-ordinals' }
	}
	for (const id of request.ids) {
		const loaded = await loadOrdinalSpend(ctx, id)
		if ('error' in loaded) return loaded
		ordinals.push(loaded.output)
		beefParts.push(loaded.beef)
	}

	const inputs: CreateActionArgs['inputs'] = ordinals.map((ordinal) => ({
		outpoint: ordinal.outpoint,
		inputDescription: 'Ordinal to burn',
		unlockingScriptLength: unlockingScriptLengthForInstructions(
			ordinal.customInstructions,
		),
	}))

	const mapScript = MAPTemplate.set({
		app: request.app ?? '1sat',
		type: 'ord',
		op: 'burn',
	})
	const burnScript = new Script()
		.writeOpCode(OP.OP_FALSE)
		.writeScript(mapScript)

	const labels = ordinals
		.map((o) => readAssetIdTag(o.tags))
		.filter((id): id is string => Boolean(id))
		.map((id) => buildInputAssetLabel(ORDINALS_BASKET, id))

	return {
		description:
			ordinals.length === 1
				? 'Burn ordinal'
				: `Burn ${ordinals.length} ordinals`,
		inputBEEF: beefParts[0],
		...(labels.length > 0 && { labels }),
		inputs,
		outputs: [
			{
				lockingScript: burnScript.toHex(),
				satoshis: 0,
				outputDescription: 'Burn ordinals',
			},
		],
		sources: ordinals,
	}
}

// ============================================================================
// Actions
// ============================================================================

/** Input for listOrdinals action */
export interface ListOrdinalsInput {
	tags?: string[]
	tagQueryMode?: 'all' | 'any'
	ids?: string[]
	/** Omit for metadata-only (no BEEF). */
	include?: 'locking scripts' | 'entire transactions'
	includeCustomInstructions?: boolean
	includeTags?: boolean
	includeLabels?: boolean
	limit?: number
	offset?: number
}

/** Result from listOrdinals action */
export interface ListOrdinalsResult {
	outputs: WalletOutput[]
	BEEF?: BEEF
	totalOutputs?: number
}

/**
 * List ordinals in the wallet. Metadata (tags/CI) by default; BEEF on demand.
 */
export const listOrdinals: Action<ListOrdinalsInput, ListOrdinalsResult> = {
	meta: {
		name: 'listOrdinals',
		description:
			'List ordinals/inscriptions (metadata by default; optional BEEF)',
		category: 'ordinals',
		inputSchema: {
			type: 'object',
			properties: {
				tags: { type: 'array', items: { type: 'string' } },
				tagQueryMode: { type: 'string', enum: ['all', 'any'] },
				ids: { type: 'array', items: { type: 'string' } },
				include: {
					type: 'string',
					enum: ['locking scripts', 'entire transactions'],
				},
				limit: {
					type: 'integer',
					description: 'Max ordinals to return (default: 100)',
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
		for (const id of input.ids ?? []) {
			if (id) tags.push(id.startsWith('id:') ? id : `id:${id}`)
		}
		const filtering = tags.length > 0
		const result = await ctx.wallet.listOutputs({
			basket: ORDINALS_BASKET,
			...(filtering && {
				tags,
				tagQueryMode: input.tagQueryMode ?? 'any',
			}),
			...(input.include && { include: input.include }),
			includeTags: input.includeTags ?? true,
			includeCustomInstructions: input.includeCustomInstructions ?? true,
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
 * Transfer an ordinal to a new owner.
 */
export const sendOrdinals: Action<
	TransferOrdinalsRequest,
	OrdinalOperationResponse
> = {
	meta: {
		name: 'sendOrdinals',
		description: 'Transfer one or more ordinals to new owners',
		category: 'ordinals',
		inputSchema: {
			type: 'object',
			properties: {
				transfers: {
					type: 'array',
					description: 'Ordinals to transfer with destinations',
					items: {
						type: 'object',
						properties: {
							id: {
								type: 'string',
								description: 'Tracking id in the ordinals basket',
							},
							counterparty: {
								type: 'string',
								description: 'Recipient identity public key (hex)',
							},
							address: {
								type: 'string',
								description: 'Recipient P2PKH address',
							},
							map: {
								type: 'object',
								description:
									'Optional MAP metadata to append to the output script',
							},
						},
						required: ['id'],
					},
				},
			},
			required: ['transfers'],
		},
	},
	async execute(ctx, input) {
		try {
			const params = await buildTransferOrdinals(ctx, input)
			if ('error' in params) {
				return params
			}

			console.log(
				'[sendOrdinals] params:',
				JSON.stringify(
					{
						description: params.description,
						inputBEEF: params.inputBEEF
							? `[${params.inputBEEF.length} bytes]`
							: 'undefined',
						inputs: params.inputs,
						outputs: params.outputs?.map((o) => ({
							...o,
							lockingScript: `${o.lockingScript?.slice(0, 20)}...`,
						})),
					},
					null,
					2,
				),
			)

			// Debug: Check if BEEF contains the source transactions
			try {
				const beef = Beef.fromBinary(params.inputBEEF as number[])
				console.log('[sendOrdinals] BEEF tx count:', beef.txs.length)
				for (const inp of params.inputs ?? []) {
					const [txid] = inp.outpoint.split('.')
					const sourceTx = beef.findTxid(txid)
					console.log(
						`[sendOrdinals] Source tx for ${inp.outpoint}: ${sourceTx ? 'FOUND' : 'MISSING'}`,
					)
				}
			} catch (e) {
				console.log('[sendOrdinals] BEEF parse error:', e)
			}

			const { sources, ...createArgs } = params
			const args = await prepareP1SatArgs(
				ctx,
				{ ...createArgs, options: { randomizeOutputs: false } },
				P1SAT_INTENTS.ORDINAL_TRANSFER,
			)
			const result = await executeTrackedAction(
				ctx.wallet,
				args,
				input.fundingProvider,
				params.inputBEEF as number[],
				async (tx) => {
					const spends: Record<number, { unlockingScript: string }> = {}
					for (let i = 0; i < sources.length; i++) {
						const ordinal = sources[i]
						if (!ordinal.customInstructions) {
							throw new Error(
								`missing-custom-instructions-for-${ordinal.outpoint}`,
							)
						}
						const unlocking = await signOrdinalInput(
							ctx,
							tx,
							i,
							ordinal.customInstructions,
						)
						if (typeof unlocking !== 'string') throw new Error(unlocking.error)
						spends[i] = { unlockingScript: unlocking }
					}
					return spends
				},
			)

			if (ctx.debug && ctx.log) {
				const logOutputs: ActionLogEntry['outputs'] = sources.map((s, i) => ({
					index: i,
					protocolID: P1SAT_PROTOCOL,
					keyID: s.outpoint,
					basket: ORDINALS_BASKET,
					satoshis: 1,
				}))
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sendOrdinals',
					input: {
						transfers: input.transfers.map((t) => ({
							id: t.id,
							counterparty: t.counterparty,
							address: t.address,
						})),
					},
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: logOutputs,
				})
			}

			return result
		} catch (error) {
			console.error('[sendOrdinals]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'sendOrdinals',
					input: {
						transfers: input.transfers.map((t) => ({
							id: t.id,
						})),
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

/**
 * List an ordinal for sale on the global orderbook.
 */
export const sellOrdinal: Action<SellOrdinalRequest, OrdinalOperationResponse> =
	{
		meta: {
			name: 'sellOrdinal',
			description: 'List an ordinal for sale on the global orderbook',
			category: 'ordinals',
			inputSchema: {
				type: 'object',
				properties: {
					id: {
						type: 'string',
						description: 'Tracking id in the ordinals basket',
					},
					price: { type: 'integer', description: 'Price in satoshis' },
					payAddress: {
						type: 'string',
						description:
							'Address to receive payment (default: P1SAT keyID 1sat 0)',
					},
					map: {
						type: 'object',
						description:
							'Optional MAP metadata to append to the listing output script',
					},
				},
				required: ['id', 'price'],
			},
		},
		async execute(ctx, input) {
			try {
				const params = await buildListOrdinal(ctx, input)
				if ('error' in params) {
					return params
				}

				const { source, ...createArgs } = params
				if (!source.customInstructions) {
					return { error: 'missing-custom-instructions' }
				}

				const args = await prepareP1SatArgs(
					ctx,
					{ ...createArgs, options: { randomizeOutputs: false } },
					P1SAT_INTENTS.ORDINAL_LIST,
				)
				const result = await executeTrackedAction(
					ctx.wallet,
					args,
					input.fundingProvider,
					params.inputBEEF as number[],
					async (tx) => {
						const unlocking = await signOrdinalInput(
							ctx,
							tx,
							0,
							source.customInstructions as string,
						)
						if (typeof unlocking !== 'string') throw new Error(unlocking.error)
						return { 0: { unlockingScript: unlocking } }
					},
				)

				if (ctx.debug && ctx.log) {
					ctx.log({
						timestamp: new Date().toISOString(),
						action: 'sellOrdinal',
						input: { outpoint: source.outpoint, price: input.price },
						txid: result.txid,
						rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
						outputs: [
							{
								index: 0,
								protocolID: P1SAT_PROTOCOL,
								keyID: source.outpoint,
								basket: ORDINALS_BASKET,
								satoshis: 1,
							},
						],
					})
				}

				return result
			} catch (error) {
				console.error('[sellOrdinal]', error)
				if (ctx.debug && ctx.log) {
					ctx.log({
						timestamp: new Date().toISOString(),
						action: 'sellOrdinal',
						input: { price: input.price },
						error: error instanceof Error ? error.message : 'unknown-error',
					})
				}
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
	}

/** Input for cancelOrdinalListing action */
export interface CancelOrdinalListingInput extends ActionOptions {
	/** Tracking id in the ordinals basket (wallet-owned) */
	id: string
}

/**
 * Cancel an ordinal listing.
 */
export const cancelOrdinalListing: Action<
	CancelOrdinalListingInput,
	OrdinalOperationResponse
> = {
	meta: {
		name: 'cancelOrdinalListing',
		description:
			'Cancel an ordinal listing and return the ordinal to the wallet',
		category: 'ordinals',
		inputSchema: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: 'Tracking id of the listing in the ordinals basket',
				},
			},
			required: ['id'],
		},
	},
	async execute(ctx, input) {
		try {
			if (!input.id) return { error: 'missing-id' }
			const loaded = await loadOrdinalSpend(ctx, input.id)
			if ('error' in loaded) return loaded
			const { output: listing, beef: inputBEEF } = loaded
			const outpoint = listing.outpoint

			if (!listing.customInstructions) {
				return { error: 'missing-custom-instructions' }
			}
			// listing.customInstructions describes the SIGNING-side derivation
			// for the OrdLock cancel path. Use those values to sign the unlock,
			// but DO NOT carry them into the new output's customInstructions —
			// the cancelled output is a fresh derivation and must record its
			// own derivation properties.
			const {
				protocolID: signProtocolID,
				keyID: signKeyID,
				counterparty: signCounterparty,
			} = JSON.parse(listing.customInstructions)

			// Fresh derivation for the new cancelled-output: tied to the
			// listing's outpoint (this output's parent), under the current
			// P1SAT protocol. customInstructions below describes exactly this
			// derivation so the next spend reproduces the same key.
			const newKeyID = outpoint
			const cancelAddress = await deriveCancelAddressInternal(ctx, newKeyID)

			const tags = ordinalSeedTags(listing)
			const basket = ORDINALS_BASKET
			const sourceName = nameFromOutput(listing, tags)

			const cancelUnlock = OrdLock.cancelWithWallet(
				ctx.wallet,
				signProtocolID,
				signKeyID,
				signCounterparty,
			)

			const inputId = readAssetIdTag(listing.tags)
			const args = await prepareP1SatArgs(
				ctx,
				{
					description: 'Cancel ordinal listing',
					inputBEEF,
					...(inputId && {
						labels: [buildInputAssetLabel(basket, inputId)],
					}),
					inputs: [
						{
							outpoint,
							inputDescription: 'Listed ordinal',
							unlockingScriptLength: 108,
						},
					],
					outputs: [
						{
							lockingScript: new P2PKH().lock(cancelAddress).toHex(),
							satoshis: 1,
							outputDescription: 'Cancelled listing',
							basket,
							tags,
							customInstructions: JSON.stringify({
								protocolID: P1SAT_PROTOCOL,
								keyID: newKeyID,
								...(sourceName && { name: sourceName }),
							}),
						},
					],
					options: { randomizeOutputs: false },
				},
				P1SAT_INTENTS.ORDINAL_CANCEL_LISTING,
			)
			const result = await executeTrackedAction(
				ctx.wallet,
				args,
				input.fundingProvider,
				inputBEEF,
				async (tx) => {
					const unlockingScript = await cancelUnlock.sign(tx, 0)
					return { 0: { unlockingScript: unlockingScript.toHex() } }
				},
			)

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'cancelOrdinalListing',
					input: { outpoint, signKeyID },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: P1SAT_PROTOCOL,
							keyID: newKeyID,
							satoshis: 1,
						},
					],
				})
			}

			return result
		} catch (error) {
			console.error('[cancelOrdinalListing]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'cancelOrdinalListing',
					input: { id: input.id },
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
 * Purchase an ordinal from the global orderbook.
 */
export const buyOrdinal: Action<BuyOrdinalRequest, OrdinalOperationResponse> = {
	meta: {
		name: 'buyOrdinal',
		description: 'Purchase an ordinal from the global orderbook',
		category: 'ordinals',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				outpoint: {
					type: 'string',
					description: 'Outpoint of the listing to purchase',
				},
				inputBEEF: {
					type: 'array',
					description: 'BEEF for listing tx; else services fetch',
					items: { type: 'integer' },
				},
				marketplaceAddress: {
					type: 'string',
					description: 'Marketplace address for fees',
				},
				marketplaceRate: {
					type: 'number',
					description: 'Marketplace fee rate (0-1)',
				},
				contentType: {
					type: 'string',
					description: 'Content type (auto-detected if not provided)',
				},
				origin: {
					type: 'string',
					description: 'Origin outpoint (auto-detected if not provided)',
				},
			},
			required: ['outpoint'],
		},
	},
	async execute(ctx, input) {
		try {
			const { outpoint, marketplaceAddress, marketplaceRate } = input
			const intent = input.p1satIntent ?? P1SAT_INTENTS.ORDINAL_PURCHASE

			const { txid, vout } = parseOutpoint(outpoint)

			// No origin hint: the caller only has the seller's listing outpoint,
			// which is not an origin. `resolveOrdinalTags` resolves the real one
			// from ORDFS and owns every tag decision.
			const resolved = await resolveOrdinalTags(ctx, outpoint, {
				contentType: input.contentType,
				origin: input.origin,
				name: input.name,
			})
			const tags = input.tags?.length
				? [...new Set([...input.tags, ...resolved.tags])]
				: resolved.tags
			const basket = input.basket ?? resolved.basket

			let beef: Beef
			if (input.inputBEEF) {
				beef = Beef.fromBinary(input.inputBEEF)
			} else {
				if (!ctx.services) {
					return { error: 'services-required-for-purchase' }
				}
				beef = await ctx.services.getBeefForTxid(txid)
			}
			const listingBeefTx = beef.findTxid(txid)
			if (!listingBeefTx?.tx) {
				return { error: 'listing-transaction-not-found' }
			}
			const listingOutput = listingBeefTx.tx.outputs[vout]
			if (!listingOutput) {
				return { error: 'listing-output-not-found' }
			}

			const ordLockData = OrdLock.decode(listingOutput.lockingScript)
			if (!ordLockData) {
				return { error: 'not-an-ordlock-listing' }
			}

			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: P1SAT_PROTOCOL,
				keyID: outpoint,
				counterparty: 'self',
				forSelf: true,
			})
			const ourOrdAddress = PublicKey.fromString(publicKey).toAddress()

			const outputs: Array<{
				lockingScript: string
				satoshis: number
				outputDescription: string
				basket?: string
				tags?: string[]
				customInstructions?: string
			}> = []

			const name = tags.find((t) => t.startsWith('name:'))?.slice(5)

			outputs.push({
				lockingScript: new P2PKH().lock(ourOrdAddress).toHex(),
				satoshis: 1,
				outputDescription: 'Purchased ordinal',
				basket,
				tags,
				customInstructions: JSON.stringify({
					protocolID: P1SAT_PROTOCOL,
					keyID: outpoint,
					...(name && { name }),
				}),
			})

			const payoutReader = new Utils.Reader(ordLockData.payout)
			const payoutSatoshis = payoutReader.readUInt64LEBn().toNumber()
			const payoutScriptLen = payoutReader.readVarIntNum()
			const payoutScriptBin = payoutReader.read(payoutScriptLen)
			const payoutLockingScript = LockingScript.fromBinary(payoutScriptBin)

			outputs.push({
				lockingScript: payoutLockingScript.toHex(),
				satoshis: payoutSatoshis,
				outputDescription: 'Payment to seller',
				tags: [],
			})

			if (marketplaceAddress && marketplaceRate && marketplaceRate > 0) {
				const marketFee = Math.ceil(payoutSatoshis * marketplaceRate)
				if (marketFee > 0) {
					outputs.push({
						lockingScript: new P2PKH().lock(marketplaceAddress).toHex(),
						satoshis: marketFee,
						outputDescription: 'Marketplace fee',
						tags: [],
					})
				}
			}

			const beefBinary = beef.toBinary()

			const args = await prepareP1SatArgs(
				ctx,
				{
					description: `Purchase ordinal for ${payoutSatoshis} sats`,
					inputBEEF: beefBinary,
					inputs: [
						{
							outpoint,
							inputDescription: 'Listed ordinal',
							unlockingScriptLength: 1368,
						},
					],
					outputs,
					options: { randomizeOutputs: false },
				},
				intent,
			)
			const result = await executeTrackedAction(
				ctx.wallet,
				args,
				input.fundingProvider,
				beefBinary as number[],
				async (tx) => {
					const unlockingScript = await buildPurchaseUnlockingScript(
						tx,
						0,
						listingOutput.satoshis ?? 1,
						listingOutput.lockingScript,
					)
					return { 0: { unlockingScript: unlockingScript.toHex() } }
				},
			)

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'buyOrdinal',
					input: { outpoint },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: P1SAT_PROTOCOL,
							keyID: outpoint,
							basket: basket,
							satoshis: 1,
						},
					],
				})
			}

			return result
		} catch (error) {
			console.error('[buyOrdinal]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'buyOrdinal',
					input: { outpoint: input.outpoint },
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
 * Burn one or more ordinals.
 */
export const burnOrdinals: Action<
	BurnOrdinalsRequest,
	OrdinalOperationResponse
> = {
	meta: {
		name: 'burnOrdinals',
		description: 'Burn one or more ordinals by sending to OP_RETURN',
		category: 'ordinals',
		inputSchema: {
			type: 'object',
			properties: {
				ids: {
					type: 'array',
					description: 'Tracking ids in the ordinals basket',
					items: { type: 'string' },
				},
			},
			required: ['ids'],
		},
	},
	async execute(ctx, input) {
		try {
			const params = await buildBurnOrdinals(ctx, input)
			if ('error' in params) {
				return params
			}

			const { sources, ...createArgs } = params
			const args = await prepareP1SatArgs(
				ctx,
				{ ...createArgs, options: { randomizeOutputs: false } },
				P1SAT_INTENTS.ORDINAL_BURN,
			)
			const result = await executeTrackedAction(
				ctx.wallet,
				args,
				input.fundingProvider,
				params.inputBEEF as number[],
				async (tx) => {
					const spends: Record<number, { unlockingScript: string }> = {}
					for (let i = 0; i < sources.length; i++) {
						const ordinal = sources[i]
						if (!ordinal.customInstructions) {
							throw new Error(
								`missing-custom-instructions-for-${ordinal.outpoint}`,
							)
						}
						const unlocking = await signOrdinalInput(
							ctx,
							tx,
							i,
							ordinal.customInstructions,
						)
						if (typeof unlocking !== 'string') throw new Error(unlocking.error)
						spends[i] = { unlockingScript: unlocking }
					}
					return spends
				},
			)

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'burnOrdinals',
					input: { ids: input.ids },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
				})
			}

			return result
		} catch (error) {
			console.error('[burnOrdinals]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'burnOrdinals',
					input: { ids: input.ids },
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

/** All ordinals actions for registry */
export const ordinalsActions = [
	listOrdinals,
	sendOrdinals,
	sellOrdinal,
	cancelOrdinalListing,
	buyOrdinal,
	burnOrdinals,
]
