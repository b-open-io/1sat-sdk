/**
 * Ordinals Module
 *
 * Actions for managing ordinals/inscriptions.
 * Returns WalletOutput[] directly from the SDK - no custom mapping needed.
 */

import { MAP as MAPTemplate } from '@bopen-io/templates'
import { OrdLock } from '@bopen-io/templates'
import {
	type BEEF,
	Beef,
	BigNumber,
	type CreateActionArgs,
	Hash,
	LockingScript,
	OP,
	P2PKH,
	PublicKey,
	Script,
	Transaction,
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
import type { Action, OneSatContext } from '../types'
import { signP2PKHInput } from '../utils/signP2PKH'
import { parseOutpoint } from '@1sat/utils'

// ============================================================================
// Helpers
// ============================================================================

function extractName(customInstructions?: string): string | undefined {
	if (!customInstructions) return undefined
	try {
		const parsed = JSON.parse(customInstructions)
		return parsed.name
	} catch {
		return undefined
	}
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

export interface TransferOrdinalsRequest {
	/** Ordinals to transfer with their destinations */
	transfers: TransferItem[]
	/** BEEF data from listOutputs (include: 'entire transactions') */
	inputBEEF: number[]
}

export interface ListOrdinalRequest {
	/** The ordinal output to list (from listOutputs) */
	ordinal: WalletOutput
	/** BEEF data from listOutputs (include: 'entire transactions') */
	inputBEEF: number[]
	/** Price in satoshis */
	price: number
	/** Address that receives payment on purchase (BRC-29 receive address) */
	payAddress: string
}

export interface PurchaseOrdinalRequest {
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
	rawtx?: string
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
	const { transfers, inputBEEF } = request

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
		const sourceType = ordinal.tags?.find(t => t.startsWith('type:'))?.slice(5)
		if (sourceType === 'application/bsv-20') {
			return { error: `Cannot transfer BSV-20 token ${outpoint} through ordinal transfer — use BSV-21 transfer instead` }
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

		// Preserve important tags from source output
		const tags: string[] = []
		for (const tag of ordinal.tags ?? []) {
			if (
				tag.startsWith('type:') ||
				tag.startsWith('origin:') ||
				tag.startsWith('name:')
			) {
				tags.push(tag)
			}
		}
		if (extraTags) {
			tags.push(...extraTags)
		}

		const sourceName = extractName(ordinal.customInstructions)

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

		// Only track output in wallet when transferring to a counterparty (wallet can derive keys to spend it)
		// External address transfers are NOT tracked since the wallet cannot spend them
		if (counterparty) {
			outputs?.push({
				lockingScript,
				satoshis: 1,
				outputDescription: 'Ordinal transfer',
				basket: sourceType === 'application/op-ns' ? OPNS_BASKET : ORDINALS_BASKET,
				tags,
				customInstructions: JSON.stringify({
					protocolID: ONESAT_PROTOCOL,
					keyID: outpoint,
					...(sourceName && { name: sourceName }),
				}),
			})
		} else {
			// External address - output is not tracked in wallet
			outputs?.push({
				lockingScript,
				satoshis: 1,
				outputDescription: 'Ordinal transfer to external address',
				tags: [],
			})
		}
	}

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
	const { ordinal, inputBEEF, price, payAddress } = request

	if (!payAddress) return { error: 'missing-pay-address' }
	if (price <= 0) return { error: 'invalid-price' }

	const outpoint = ordinal.outpoint
	const typeTag = ordinal.tags?.find((t) => t.startsWith('type:'))
	const originTag = ordinal.tags?.find((t) => t.startsWith('origin:'))
	const nameTag = ordinal.tags?.find((t) => t.startsWith('name:'))
	const originOutpoint = originTag ? originTag.slice(7) : outpoint

	const sourceName = extractName(ordinal.customInstructions)

	const cancelAddress = await deriveCancelAddressInternal(ctx, outpoint)
	const lockingScript = buildOrdLockScript(cancelAddress, payAddress, price)

	const tags: string[] = [
		'ordlock',
		`origin:${originOutpoint}`,
		`price:${price}`,
	]
	if (typeTag) tags.push(typeTag)
	if (nameTag) tags.push(nameTag)

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
				basket: ORDINALS_BASKET,
				tags,
				customInstructions: JSON.stringify({
					protocolID: ONESAT_PROTOCOL,
					keyID: outpoint,
					...(sourceName && { name: sourceName }),
				}),
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

			const createResult = await ctx.wallet.createAction({
				...params,
				options: { signAndProcess: false, randomizeOutputs: false },
			})

			if (!createResult.signableTransaction) {
				return { error: 'no-signable-transaction' }
			}

			const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)
			const spends: Record<number, { unlockingScript: string }> = {}

			for (let i = 0; i < input.transfers.length; i++) {
				const { ordinal } = input.transfers[i]
				console.log(
					`[transferOrdinals] Input ${i}: outpoint=${ordinal.outpoint}, customInstructions=${ordinal.customInstructions}`,
				)
				if (!ordinal.customInstructions) {
					return {
						error: `missing-custom-instructions-for-${ordinal.outpoint}`,
					}
				}
				const { protocolID, keyID } = JSON.parse(ordinal.customInstructions)
				console.log(
					`[transferOrdinals] Input ${i}: protocolID=${JSON.stringify(protocolID)}, keyID=${keyID}`,
				)

				const unlocking = await signP2PKHInput(ctx, tx, i, protocolID, keyID)
				if (typeof unlocking !== 'string') return unlocking
				spends[i] = { unlockingScript: unlocking }
			}

			const signResult = await ctx.wallet.signAction({
				reference: createResult.signableTransaction.reference,
				spends,
				options: { acceptDelayedBroadcast: false },
			})

			if ('error' in signResult) {
				return { error: String(signResult.error) }
			}

			return {
				txid: signResult.txid,
				rawtx: signResult.tx ? Utils.toHex(signResult.tx) : undefined,
			}
		} catch (error) {
			console.error('[transferOrdinals]', error)
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

				const createResult = await ctx.wallet.createAction({
					...params,
					options: { signAndProcess: false, randomizeOutputs: false },
				})

				if (!createResult.signableTransaction) {
					return { error: 'no-signable-transaction' }
				}

				if (!input.ordinal.customInstructions) {
					return { error: 'missing-custom-instructions' }
				}
				const { protocolID, keyID } = JSON.parse(
					input.ordinal.customInstructions,
				)

				const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)
				const unlocking = await signP2PKHInput(ctx, tx, 0, protocolID, keyID)
				if (typeof unlocking !== 'string') return unlocking

				const signResult = await ctx.wallet.signAction({
					reference: createResult.signableTransaction.reference,
					spends: { 0: { unlockingScript: unlocking } },
					options: { acceptDelayedBroadcast: false },
				})

				if ('error' in signResult) {
					return { error: String(signResult.error) }
				}

				return {
					txid: signResult.txid,
					rawtx: signResult.tx ? Utils.toHex(signResult.tx) : undefined,
				}
			} catch (error) {
				console.error('[listOrdinal]', error)
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
	}

/** Input for cancelListing action */
export interface CancelListingInput {
	/** The listing output to cancel (from listOutputs, must include lockingScript) */
	listing: WalletOutput
	/** BEEF data from listOutputs (include: 'entire transactions') */
	inputBEEF: number[]
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
					description:
						"BEEF from listOutputs with include: 'entire transactions'",
				},
			},
			required: ['listing', 'inputBEEF'],
		},
	},
	async execute(ctx, input) {
		try {
			const { listing, inputBEEF } = input
			const outpoint = listing.outpoint

			if (!listing.customInstructions) {
				return { error: 'missing-custom-instructions' }
			}
			const {
				protocolID,
				keyID,
				name: listingName,
			} = JSON.parse(listing.customInstructions)

			const typeTag = listing.tags?.find((t) => t.startsWith('type:'))
			const originTag = listing.tags?.find((t) => t.startsWith('origin:'))
			const nameTag = listing.tags?.find((t) => t.startsWith('name:'))

			const cancelAddress = await deriveCancelAddressInternal(ctx, keyID)

			const tags: string[] = []
			if (typeTag) tags.push(typeTag)
			if (originTag) tags.push(originTag)
			if (nameTag) tags.push(nameTag)

			const createResult = await ctx.wallet.createAction({
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
						basket: ORDINALS_BASKET,
						tags,
						customInstructions: JSON.stringify({
							protocolID,
							keyID,
							...(listingName && { name: listingName }),
						}),
					},
				],
				options: { signAndProcess: false, randomizeOutputs: false },
			})

			if ('error' in createResult && createResult.error) {
				return { error: String(createResult.error) }
			}

			if (!createResult.signableTransaction) {
				return { error: 'no-signable-transaction' }
			}

			const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)
			const txInput = tx.inputs[0]
			const lockingScript =
				txInput.sourceTransaction?.outputs[txInput.sourceOutputIndex]
					?.lockingScript
			if (!lockingScript) {
				return { error: 'missing-locking-script' }
			}

			const sourceTXID =
				txInput.sourceTXID ?? txInput.sourceTransaction?.id('hex')
			if (!sourceTXID) {
				return { error: 'missing-source-txid' }
			}

			const preimage = TransactionSignature.format({
				sourceTXID,
				sourceOutputIndex: txInput.sourceOutputIndex,
				sourceSatoshis: listing.satoshis,
				transactionVersion: tx.version,
				otherInputs: [],
				inputIndex: 0,
				outputs: tx.outputs,
				inputSequence: txInput.sequence ?? 0xffffffff,
				subscript: lockingScript,
				lockTime: tx.lockTime,
				scope:
					TransactionSignature.SIGHASH_ALL |
					TransactionSignature.SIGHASH_ANYONECANPAY |
					TransactionSignature.SIGHASH_FORKID,
			})

			const sighash = Hash.sha256(Hash.sha256(preimage))

			const { signature } = await ctx.wallet.createSignature({
				protocolID,
				keyID,
				counterparty: 'self',
				hashToDirectlySign: Array.from(sighash),
			})

			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID,
				keyID,
				forSelf: true,
			})

			const unlockingScript = new UnlockingScript()
				.writeBin(signature)
				.writeBin(Utils.toArray(publicKey, 'hex'))
				.writeOpCode(OP.OP_1)

			const signResult = await ctx.wallet.signAction({
				reference: createResult.signableTransaction.reference,
				spends: {
					0: { unlockingScript: unlockingScript.toHex() },
				},
				options: { acceptDelayedBroadcast: false },
			})

			if ('error' in signResult) {
				return { error: String(signResult.error) }
			}

			return {
				txid: signResult.txid,
				rawtx: signResult.tx ? Utils.toHex(signResult.tx) : undefined,
			}
		} catch (error) {
			console.error('[cancelListing]', error)
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

			let { contentType, origin, name } = input
			if (!contentType || !origin || name === undefined) {
				const metadata = await ctx.services.ordfs.getMetadata(outpoint)
				contentType = contentType ?? metadata.contentType
				origin = origin ?? metadata.origin ?? outpoint
				// Extract name from map.name or map.subTypeData.name
				if (name === undefined && metadata.map) {
					const mapName = metadata.map.name
					const subTypeData = metadata.map.subTypeData as
						| Record<string, unknown>
						| undefined
					name =
						(typeof mapName === 'string' ? mapName : undefined) ??
						(typeof subTypeData?.name === 'string'
							? subTypeData.name
							: undefined)
				}
			}

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

			const p2pkh = new P2PKH()
			const purchaseTags = [`type:${contentType}`, `origin:${origin}`]
			if (name) purchaseTags.push(`name:${name}`)

			outputs.push({
				lockingScript: p2pkh.lock(ourOrdAddress).toHex(),
				satoshis: 1,
				outputDescription: 'Purchased ordinal',
				basket: ORDINALS_BASKET,
				tags: purchaseTags,
				customInstructions: JSON.stringify({
					protocolID: ONESAT_PROTOCOL,
					keyID: outpoint,
					...(name && { name: name.slice(0, 64) }),
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
						lockingScript: p2pkh.lock(marketplaceAddress).toHex(),
						satoshis: marketFee,
						outputDescription: 'Marketplace fee',
						tags: [],
					})
				}
			}

			const createResult = await ctx.wallet.createAction({
				description: `Purchase ordinal for ${payoutSatoshis} sats`,
				inputBEEF: beef.toBinary(),
				inputs: [
					{
						outpoint,
						inputDescription: 'Listed ordinal',
						unlockingScriptLength: 500,
					},
				],
				outputs,
				options: { signAndProcess: false, randomizeOutputs: false },
			})

			if ('error' in createResult && createResult.error) {
				return { error: String(createResult.error) }
			}

			if (!createResult.signableTransaction) {
				return { error: 'no-signable-transaction' }
			}

			const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)

			const unlockingScript = await buildPurchaseUnlockingScript(
				tx,
				0,
				listingOutput.satoshis ?? 1,
				listingOutput.lockingScript,
			)

			const signResult = await ctx.wallet.signAction({
				reference: createResult.signableTransaction.reference,
				spends: {
					0: { unlockingScript: unlockingScript.toHex() },
				},
				options: { acceptDelayedBroadcast: false },
			})

			if ('error' in signResult) {
				return { error: String(signResult.error) }
			}

			return {
				txid: signResult.txid,
				rawtx: signResult.tx ? Utils.toHex(signResult.tx) : undefined,
			}
		} catch (error) {
			console.error('[purchaseOrdinal]', error)
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
]
