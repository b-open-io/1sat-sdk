/**
 * Ordinals Module
 *
 * Actions for managing ordinals/inscriptions.
 * Returns WalletOutput[] directly from the SDK - no custom mapping needed.
 */

import { MAP as MAPTemplate } from '@1sat/templates'
import { OrdLock } from '@1sat/templates'
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
import {
	ONESAT_PROTOCOL,
	OPNS_BASKET,
	ORDINALS_BASKET,
	ORD_LOCK_PREFIX,
	ORD_LOCK_SUFFIX,
} from '../constants'
import type {
	Action,
	ActionLogEntry,
	ActionOptions,
	OneSatContext,
} from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { resolveBeef } from '../utils/resolveBeef'
import { signP2PKHInput } from '../utils/signP2PKH'

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
	// Extract known values from source tags or explicit fields
	let contentType = source?.contentType
	let origin = source?.origin
	let name = source?.name

	if (source?.tags) {
		for (const tag of source.tags) {
			if (!contentType && tag.startsWith('type:')) contentType = tag.slice(5)
			if (!origin && tag === 'origin') origin = outpoint
			else if (!origin && tag.startsWith('origin:')) origin = tag.slice(7)
			if (name === undefined && tag.startsWith('name:')) name = tag.slice(5)
		}
	}

	// Fetch missing type/origin from ORDFS metadata (seq -2 = origin resolution)
	if ((!contentType || !origin) && ctx.services) {
		try {
			const metadata = await ctx.services.ordfs.getMetadata(outpoint, -2)
			contentType = contentType ?? metadata.contentType
			origin = origin ?? metadata.origin ?? outpoint

			// Non-OPNS: try MAP metadata for name
			if (
				name === undefined &&
				contentType !== 'application/op-ns' &&
				metadata.map
			) {
				const mapName = metadata.map.name
				const subTypeData = metadata.map.subTypeData as
					| Record<string, unknown>
					| undefined
				name =
					(typeof mapName === 'string' ? mapName : undefined) ??
					(typeof subTypeData?.name === 'string' ? subTypeData.name : undefined)
			}
		} catch {
			// Fall through with whatever we have
		}
	}

	origin = origin ?? outpoint

	// OPNS: name is inscription content
	if (
		name === undefined &&
		contentType === 'application/op-ns' &&
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
	if (contentType) tags.push(`type:${contentType}`)
	if (origin) tags.push(`origin:${origin}`)
	if (name) tags.push(`name:${name.slice(0, 64)}`)

	const basket =
		contentType === 'application/op-ns' ? OPNS_BASKET : ORDINALS_BASKET

	return { tags, basket }
}

// ============================================================================
// Types
// ============================================================================

type PubKeyHex = string

export interface TransferItem {
	/** The ordinal output to transfer (from listOutputs) */
	ordinal: WalletOutput
	/** Recipient's identity public key (preferred) */
	counterparty?: PubKeyHex
	/** Raw P2PKH address */
	address?: string
	/** Optional MAP metadata to append to the output script */
	map?: Record<string, string>
	/** Additional tags to append to the output (e.g. 'status:published') */
	extraTags?: string[]
}

export interface TransferOrdinalsRequest extends ActionOptions {
	/** Ordinals to transfer with their destinations */
	transfers: TransferItem[]
	/** BEEF data — resolved automatically via ID tag if omitted */
	inputBEEF?: number[]
}

export interface BurnOrdinalsRequest extends ActionOptions {
	/** Ordinal outputs to burn */
	ordinals: WalletOutput[]
	/** BEEF data — resolved automatically via ID tag if omitted */
	inputBEEF?: number[]
	/** Application name for MAP metadata (default: "1sat") */
	app?: string
}

export interface ListOrdinalRequest extends ActionOptions {
	/** The ordinal output to list (from listOutputs) */
	ordinal: WalletOutput
	/** BEEF data — resolved automatically via ID tag if omitted */
	inputBEEF?: number[]
	/** Price in satoshis */
	price: number
	/** Address that receives payment on purchase (BRC-29 receive address) */
	payAddress: string
}

export interface PurchaseOrdinalRequest extends ActionOptions {
	/** Outpoint of listing to purchase */
	outpoint: string
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
}

export interface OrdinalOperationResponse {
	txid?: string
	tx?: number[]
	error?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

async function deriveCancelAddressInternal(
	ctx: OneSatContext,
	outpoint: string,
): Promise<string> {
	const result = await ctx.wallet.getPublicKey({
		protocolID: ONESAT_PROTOCOL,
		keyID: outpoint,
		forSelf: true,
	})
	return PublicKey.fromString(result.publicKey).toAddress()
}

function buildOrdLockScript(
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

/**
 * Build CreateActionArgs for transferring one or more ordinals.
 * Does NOT execute - returns params for createAction.
 */
export async function buildTransferOrdinals(
	ctx: OneSatContext,
	request: TransferOrdinalsRequest,
): Promise<CreateActionArgs | { error: string }> {
	const { transfers } = request

	if (!transfers.length) {
		return { error: 'no-transfers' }
	}

	const inputs: CreateActionArgs['inputs'] = []
	const outputs: CreateActionArgs['outputs'] = []

	for (const { ordinal, counterparty, address, map, extraTags } of transfers) {
		if (!counterparty && !address) {
			return { error: 'must-provide-counterparty-or-address' }
		}

		const outpoint = ordinal.outpoint
		const sourceType = ordinal.tags
			?.find((t) => t.startsWith('type:'))
			?.slice(5)
		if (sourceType === 'application/bsv-20') {
			return {
				error: `Cannot transfer BSV-20 token ${outpoint} through ordinal transfer — use BSV-21 transfer instead`,
			}
		}

		let recipientAddress: string
		if (counterparty) {
			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: ONESAT_PROTOCOL,
				keyID: outpoint,
				counterparty,
				forSelf: false,
			})
			recipientAddress = PublicKey.fromString(publicKey).toAddress()
		} else if (address) {
			recipientAddress = address
		} else {
			return { error: 'must-provide-counterparty-or-address' }
		}

		const { tags, basket } = await resolveOrdinalTags(ctx, outpoint, {
			tags: ordinal.tags,
		})
		if (extraTags) tags.push(...extraTags)

		inputs?.push({
			outpoint,
			inputDescription: 'Ordinal to transfer',
			unlockingScriptLength: 108,
		})

		// Build locking script — append MAP metadata when provided
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

		if (counterparty) {
			outputs?.push({
				lockingScript,
				satoshis: 1,
				outputDescription: 'Ordinal transfer',
				basket,
				tags,
				customInstructions: JSON.stringify({
					protocolID: ONESAT_PROTOCOL,
					keyID: outpoint,
				}),
			})
		} else {
			outputs?.push({
				lockingScript,
				satoshis: 1,
				outputDescription: 'Ordinal transfer to external address',
				tags: [],
			})
		}
	}

	const inputBEEF =
		request.inputBEEF ??
		(await resolveBeef(ctx.wallet, ORDINALS_BASKET, transfers[0].ordinal))

	return {
		description:
			transfers.length === 1
				? 'Transfer ordinal'
				: `Transfer ${transfers.length} ordinals`,
		inputBEEF,
		inputs,
		outputs,
	}
}

/**
 * Build CreateActionArgs for listing an ordinal for sale.
 * Does NOT execute - returns params for createAction.
 */
export async function buildListOrdinal(
	ctx: OneSatContext,
	request: ListOrdinalRequest,
): Promise<CreateActionArgs | { error: string }> {
	const { ordinal, price, payAddress } = request

	if (!payAddress) return { error: 'missing-pay-address' }
	if (price <= 0) return { error: 'invalid-price' }

	const outpoint = ordinal.outpoint

	const cancelAddress = await deriveCancelAddressInternal(ctx, outpoint)
	const lockingScript = buildOrdLockScript(cancelAddress, payAddress, price)

	const { tags, basket } = await resolveOrdinalTags(ctx, outpoint, {
		tags: ordinal.tags,
	})
	tags.push('ordlock', `price:${price}`)

	const inputBEEF =
		request.inputBEEF ??
		(await resolveBeef(ctx.wallet, ORDINALS_BASKET, ordinal))

	return {
		description: `List ordinal for ${price} sats`,
		inputBEEF,
		inputs: [
			{
				outpoint,
				inputDescription: 'Ordinal to list',
				unlockingScriptLength: 108,
			},
		],
		outputs: [
			{
				lockingScript: lockingScript.toHex(),
				satoshis: 1,
				outputDescription: `List ordinal for ${price} sats`,
				basket,
				tags,
				customInstructions: JSON.stringify({
					protocolID: ONESAT_PROTOCOL,
					keyID: outpoint,
				}),
			},
		],
	}
}

/**
 * Build CreateActionArgs for burning one or more ordinals.
 * Does NOT execute - returns params for createAction.
 */
export async function buildBurnOrdinals(
	ctx: OneSatContext,
	request: BurnOrdinalsRequest,
): Promise<CreateActionArgs | { error: string }> {
	const { ordinals } = request

	if (!ordinals.length) {
		return { error: 'no-ordinals' }
	}

	const inputs: CreateActionArgs['inputs'] = ordinals.map((ordinal) => ({
		outpoint: ordinal.outpoint,
		inputDescription: 'Ordinal to burn',
		unlockingScriptLength: 108,
	}))

	const inputBEEF =
		request.inputBEEF ??
		(await resolveBeef(ctx.wallet, ORDINALS_BASKET, ordinals[0]))

	const mapScript = MAPTemplate.set({
		app: request.app ?? '1sat',
		type: 'ord',
		op: 'burn',
	})
	const burnScript = new Script().writeOpCode(OP.OP_FALSE).writeScript(mapScript)

	return {
		description:
			ordinals.length === 1
				? 'Burn ordinal'
				: `Burn ${ordinals.length} ordinals`,
		inputBEEF,
		inputs,
		outputs: [
			{
				lockingScript: burnScript.toHex(),
				satoshis: 0,
				outputDescription: 'Burn ordinals',
			},
		],
	}
}

// ============================================================================
// Actions
// ============================================================================

/** Input for getOrdinals action */
export interface GetOrdinalsInput {
	/** Max number of ordinals to return */
	limit?: number
	/** Offset for pagination */
	offset?: number
}

/** Result from getOrdinals action */
export interface GetOrdinalsResult {
	outputs: WalletOutput[]
	BEEF?: BEEF
}

/**
 * Get ordinals from the wallet with BEEF for spending.
 */
export const getOrdinals: Action<GetOrdinalsInput, GetOrdinalsResult> = {
	meta: {
		name: 'getOrdinals',
		description:
			'Get ordinals/inscriptions from the wallet with BEEF for spending',
		category: 'ordinals',
		inputSchema: {
			type: 'object',
			properties: {
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
		const result = await ctx.wallet.listOutputs({
			basket: ORDINALS_BASKET,
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

/** Input for deriveCancelAddress action */
export interface DeriveCancelAddressInput {
	/** Outpoint of the ordinal listing */
	outpoint: string
}

/**
 * Derive a cancel address for an ordinal listing.
 */
export const deriveCancelAddress: Action<DeriveCancelAddressInput, string> = {
	meta: {
		name: 'deriveCancelAddress',
		description: 'Derive the cancel address for an ordinal listing',
		category: 'ordinals',
		inputSchema: {
			type: 'object',
			properties: {
				outpoint: {
					type: 'string',
					description: 'Outpoint of the ordinal listing',
				},
			},
			required: ['outpoint'],
		},
	},
	async execute(ctx, input) {
		return deriveCancelAddressInternal(ctx, input.outpoint)
	},
}

/**
 * Transfer an ordinal to a new owner.
 */
export const transferOrdinals: Action<
	TransferOrdinalsRequest,
	OrdinalOperationResponse
> = {
	meta: {
		name: 'transferOrdinals',
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
							ordinal: {
								type: 'object',
								description: 'WalletOutput from listOutputs',
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
						required: ['ordinal'],
					},
				},
				inputBEEF: {
					type: 'array',
					description:
						"BEEF from listOutputs with include: 'entire transactions'",
				},
			},
			required: ['transfers', 'inputBEEF'],
		},
	},
	async execute(ctx, input) {
		try {
			const params = await buildTransferOrdinals(ctx, input)
			if ('error' in params) {
				return params
			}

			console.log(
				'[transferOrdinals] params:',
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
				console.log('[transferOrdinals] BEEF tx count:', beef.txs.length)
				for (const inp of params.inputs ?? []) {
					const [txid] = inp.outpoint.split('.')
					const sourceTx = beef.findTxid(txid)
					console.log(
						`[transferOrdinals] Source tx for ${inp.outpoint}: ${sourceTx ? 'FOUND' : 'MISSING'}`,
					)
				}
			} catch (e) {
				console.log('[transferOrdinals] BEEF parse error:', e)
			}

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					...params,
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				params.inputBEEF as number[],
				async (tx) => {
					const spends: Record<number, { unlockingScript: string }> = {}
					for (let i = 0; i < input.transfers.length; i++) {
						const { ordinal } = input.transfers[i]
						if (!ordinal.customInstructions) {
							throw new Error(
								`missing-custom-instructions-for-${ordinal.outpoint}`,
							)
						}
						const { protocolID, keyID } = JSON.parse(ordinal.customInstructions)
						const unlocking = await signP2PKHInput(
							ctx,
							tx,
							i,
							protocolID,
							keyID,
						)
						if (typeof unlocking !== 'string') throw new Error(unlocking.error)
						spends[i] = { unlockingScript: unlocking }
					}
					return spends
				},
			)

			if (ctx.debug && ctx.log) {
				const logOutputs: ActionLogEntry['outputs'] = input.transfers.map(
					(t, i) => ({
						index: i,
						protocolID: ONESAT_PROTOCOL,
						keyID: t.ordinal.outpoint,
						basket: ORDINALS_BASKET,
						satoshis: 1,
					}),
				)
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'transferOrdinals',
					input: {
						transfers: input.transfers.map((t) => ({
							outpoint: t.ordinal.outpoint,
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
			console.error('[transferOrdinals]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'transferOrdinals',
					input: {
						transfers: input.transfers.map((t) => ({
							outpoint: t.ordinal.outpoint,
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
export const listOrdinal: Action<ListOrdinalRequest, OrdinalOperationResponse> =
	{
		meta: {
			name: 'listOrdinal',
			description: 'List an ordinal for sale on the global orderbook',
			category: 'ordinals',
			inputSchema: {
				type: 'object',
				properties: {
					ordinal: {
						type: 'object',
						description: 'WalletOutput from listOutputs',
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
				required: ['ordinal', 'inputBEEF', 'price', 'payAddress'],
			},
		},
		async execute(ctx, input) {
			try {
				const params = await buildListOrdinal(ctx, input)
				if ('error' in params) {
					return params
				}

				if (!input.ordinal.customInstructions) {
					return { error: 'missing-custom-instructions' }
				}
				const { protocolID, keyID } = JSON.parse(
					input.ordinal.customInstructions,
				)

				const result = await executeTrackedAction(
					ctx.wallet,
					{
						...params,
						options: { randomizeOutputs: false },
					},
					input.fundingProvider,
					params.inputBEEF as number[],
					async (tx) => {
						const unlocking = await signP2PKHInput(
							ctx,
							tx,
							0,
							protocolID,
							keyID,
						)
						if (typeof unlocking !== 'string') throw new Error(unlocking.error)
						return { 0: { unlockingScript: unlocking } }
					},
				)

				if (ctx.debug && ctx.log) {
					ctx.log({
						timestamp: new Date().toISOString(),
						action: 'listOrdinal',
						input: { outpoint: input.ordinal.outpoint, price: input.price },
						txid: result.txid,
						rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
						outputs: [
							{
								index: 0,
								protocolID: ONESAT_PROTOCOL,
								keyID: input.ordinal.outpoint,
								basket: ORDINALS_BASKET,
								satoshis: 1,
							},
						],
					})
				}

				return result
			} catch (error) {
				console.error('[listOrdinal]', error)
				if (ctx.debug && ctx.log) {
					ctx.log({
						timestamp: new Date().toISOString(),
						action: 'listOrdinal',
						input: { outpoint: input.ordinal.outpoint, price: input.price },
						error: error instanceof Error ? error.message : 'unknown-error',
					})
				}
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
	}

/** Input for cancelListing action */
export interface CancelListingInput extends ActionOptions {
	/** The listing output to cancel (from listOutputs) */
	listing: WalletOutput
	/** BEEF data — resolved automatically via ID tag if omitted */
	inputBEEF?: number[]
}

/**
 * Cancel an ordinal listing.
 */
export const cancelListing: Action<
	CancelListingInput,
	OrdinalOperationResponse
> = {
	meta: {
		name: 'cancelListing',
		description:
			'Cancel an ordinal listing and return the ordinal to the wallet',
		category: 'ordinals',
		inputSchema: {
			type: 'object',
			properties: {
				listing: {
					type: 'object',
					description:
						'WalletOutput of the listing (must include lockingScript)',
				},
				inputBEEF: {
					type: 'array',
					description: 'BEEF — resolved automatically via ID tag if omitted',
				},
			},
			required: ['listing'],
		},
	},
	async execute(ctx, input) {
		try {
			const { listing } = input
			const inputBEEF =
				input.inputBEEF ??
				(await resolveBeef(ctx.wallet, ORDINALS_BASKET, listing))
			const outpoint = listing.outpoint

			if (!listing.customInstructions) {
				return { error: 'missing-custom-instructions' }
			}
			const { protocolID, keyID } = JSON.parse(listing.customInstructions)

			const cancelAddress = await deriveCancelAddressInternal(ctx, keyID)

			const { tags, basket } = await resolveOrdinalTags(ctx, outpoint, {
				tags: listing.tags,
			})

			const cancelUnlock = OrdLock.cancelWithWallet(
				ctx.wallet,
				protocolID,
				keyID,
			)

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: 'Cancel ordinal listing',
					inputBEEF,
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
								protocolID,
								keyID,
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

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'cancelListing',
					input: { outpoint, keyID },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID,
							keyID,
							customInstructions: listing.customInstructions,
							satoshis: 1,
						},
					],
				})
			}

			return result
		} catch (error) {
			console.error('[cancelListing]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'cancelListing',
					input: { outpoint: input.listing.outpoint },
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
export const purchaseOrdinal: Action<
	PurchaseOrdinalRequest,
	OrdinalOperationResponse
> = {
	meta: {
		name: 'purchaseOrdinal',
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

			if (!ctx.services) {
				return { error: 'services-required-for-purchase' }
			}

			const { txid, vout } = parseOutpoint(outpoint)

			const { tags, basket } = await resolveOrdinalTags(ctx, outpoint, {
				contentType: input.contentType,
				origin: input.origin,
				name: input.name,
			})

			const beef = await ctx.services.getBeefForTxid(txid)
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
				protocolID: ONESAT_PROTOCOL,
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

			outputs.push({
				lockingScript: new P2PKH().lock(ourOrdAddress).toHex(),
				satoshis: 1,
				outputDescription: 'Purchased ordinal',
				basket,
				tags,
				customInstructions: JSON.stringify({
					protocolID: ONESAT_PROTOCOL,
					keyID: outpoint,
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

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: `Purchase ordinal for ${payoutSatoshis} sats`,
					inputBEEF: beefBinary,
					inputs: [
						{
							outpoint,
							inputDescription: 'Listed ordinal',
							unlockingScriptLength: 500,
						},
					],
					outputs,
					options: { randomizeOutputs: false },
				},
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
					action: 'purchaseOrdinal',
					input: { outpoint },
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: ONESAT_PROTOCOL,
							keyID: outpoint,
							basket: basket,
							satoshis: 1,
						},
					],
				})
			}

			return result
		} catch (error) {
			console.error('[purchaseOrdinal]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'purchaseOrdinal',
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
 * Burn one or more ordinals (send to OP_FALSE OP_RETURN).
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
				ordinals: {
					type: 'array',
					description: 'WalletOutputs to burn',
					items: {
						type: 'object',
						description: 'WalletOutput from listOutputs',
					},
				},
				inputBEEF: {
					type: 'array',
					description:
						'BEEF — resolved automatically via ID tag if omitted',
				},
			},
			required: ['ordinals'],
		},
	},
	async execute(ctx, input) {
		try {
			const params = await buildBurnOrdinals(ctx, input)
			if ('error' in params) {
				return params
			}

			console.log(
				'[burnOrdinals] params:',
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

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					...params,
					options: { randomizeOutputs: false },
				},
				input.fundingProvider,
				params.inputBEEF as number[],
				async (tx) => {
					const spends: Record<number, { unlockingScript: string }> = {}
					for (let i = 0; i < input.ordinals.length; i++) {
						const ordinal = input.ordinals[i]
						if (!ordinal.customInstructions) {
							throw new Error(
								`missing-custom-instructions-for-${ordinal.outpoint}`,
							)
						}
						const { protocolID, keyID } = JSON.parse(ordinal.customInstructions)
						const unlocking = await signP2PKHInput(
							ctx,
							tx,
							i,
							protocolID,
							keyID,
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
					input: {
						ordinals: input.ordinals.map((o) => ({
							outpoint: o.outpoint,
						})),
					},
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
					input: {
						ordinals: input.ordinals.map((o) => ({
							outpoint: o.outpoint,
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

// ============================================================================
// Module exports
// ============================================================================

/** All ordinals actions for registry */
export const ordinalsActions = [
	getOrdinals,
	deriveCancelAddress,
	transferOrdinals,
	listOrdinal,
	cancelListing,
	purchaseOrdinal,
	burnOrdinals,
]
