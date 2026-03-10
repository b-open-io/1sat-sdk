/**
 * Address Sync Action
 *
 * Derives BRC-29 deposit addresses, fetches new outputs from the
 * 1sat-stack indexer (triggering lazy indexing), classifies them
 * with the indexer pipeline, and internalizes them into the wallet.
 */

import { type AddressDerivation, BRC29_PROTOCOL_ID } from '@1sat/types'
import type { Indexer, ParseContext, SyncProgress, Txo } from '@1sat/types'
import type { SyncOutput } from '@1sat/types'
import {
	Beef,
	type InternalizeActionArgs,
	type InternalizeOutput,
	PublicKey,
	Transaction,
	Utils,
} from '@bsv/sdk'
import type { OneSatServices } from '@1sat/client'
import {
	Bsv21Indexer,
	FundIndexer,
	InscriptionIndexer,
	MapIndexer,
	OpNSIndexer,
	OriginIndexer,
	Outpoint,
	SigmaIndexer,
} from '@1sat/wallet'
import type { Action } from '../types'
import type { ProcessedTxStore } from './ProcessedTxStore'
import { ProcessedTxStoreIdb } from './ProcessedTxStoreIdb'
import { ProcessedTxStoreSqlite } from './ProcessedTxStoreSqlite'

const REORG_SAFE_DEPTH = 6

// ============================================================================
// Address derivation helpers (shared with deriveDepositAddresses action)
// ============================================================================

function toBase64Prefix(prefix: string): string {
	return Utils.toBase64(Array.from(new TextEncoder().encode(prefix)))
}

function toBase64Suffix(index: number): string {
	return Utils.toBase64([
		(index >>> 24) & 0xff,
		(index >>> 16) & 0xff,
		(index >>> 8) & 0xff,
		index & 0xff,
	])
}

// ============================================================================
// Types
// ============================================================================

export interface SyncAddressesInput {
	/** BRC-29 derivation prefix (e.g., "yours", "mcp", "1sat") */
	prefix: string
	/** First address index to derive (default: 0) */
	startIndex?: number
	/** Number of addresses to derive (default: 1) */
	count?: number
	/** Optional progress callback for UI consumers showing indexing status */
	onProgress?: (progress: SyncProgress) => void
}

export interface SyncAddressesResult {
	/** Number of transactions successfully internalized */
	processed: number
	/** Number of transactions that failed to internalize */
	failed: number
	/** Last reorg-safe score — pass as fromScore on next call */
	lastScore: number
	/** Addresses that were synced */
	addresses: string[]
}

// ============================================================================
// Store factory
// ============================================================================

async function openStore(
	identityKey: string,
	dataDir?: string,
): Promise<ProcessedTxStore> {
	if (typeof indexedDB !== 'undefined') {
		return new ProcessedTxStoreIdb(identityKey)
	}

	const dir = dataDir || process.cwd()
	const dbPath = `${dir}/sync-${identityKey.slice(0, 16)}.db`

	// Dynamic import for SQLite — only available in Node/Bun
	const { Database } = await import('bun:sqlite')
	return ProcessedTxStoreSqlite.open(dbPath, Database)
}

// ============================================================================
// Action
// ============================================================================

export const syncAddresses: Action<SyncAddressesInput, SyncAddressesResult> = {
	meta: {
		name: 'syncAddresses',
		description:
			'Sync external payments to BRC-29 deposit addresses into the wallet',
		category: 'sync',
		inputSchema: {
			type: 'object',
			properties: {
				prefix: {
					type: 'string',
					description:
						'BRC-29 derivation prefix (e.g., "yours", "mcp", "1sat")',
				},
				startIndex: {
					type: 'integer',
					description: 'First address index to derive (default: 0)',
				},
				count: {
					type: 'integer',
					description: 'Number of addresses to derive (default: 1)',
				},
			},
			required: ['prefix'],
		},
		requiresServices: true,
	},

	async execute(ctx, input) {
		const { prefix, startIndex = 0, count = 1, onProgress } = input
		const services = ctx.services
		if (!services) {
			throw new Error('syncAddresses requires services in context')
		}

		// 1. Derive addresses
		const { publicKey: identityKey } = await ctx.wallet.getPublicKey({
			identityKey: true,
		})

		const derivationPrefix = toBase64Prefix(prefix)
		const derivations: AddressDerivation[] = []

		for (let i = startIndex; i < startIndex + count; i++) {
			const derivationSuffix = toBase64Suffix(i)
			const keyID = `${derivationPrefix} ${derivationSuffix}`

			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: BRC29_PROTOCOL_ID,
				keyID,
				forSelf: true,
			})

			derivations.push({
				address: PublicKey.fromString(publicKey).toAddress(),
				index: i,
				derivationPrefix,
				derivationSuffix,
				senderIdentityKey: identityKey,
				publicKey,
			})
		}

		const addresses = derivations.map((d) => d.address)
		const addressMap = new Map(derivations.map((d) => [d.address, d]))

		// 2. Open processed-tx store
		const store = await openStore(identityKey, ctx.dataDir)

		try {
			// 3. Get current block height and last score
			const { height: currentHeight } = await ctx.wallet.getHeight({})
			const lastScore = await store.getLastScore()

			// 4. Build indexers
			const owners = new Set(addresses)
			const network = ctx.chain === 'main' ? 'mainnet' : 'testnet'
			const indexers: Indexer[] = [
				new FundIndexer(owners, network),
				new InscriptionIndexer(owners, network),
				new Bsv21Indexer(owners, network, services),
				new OriginIndexer(owners, network, services),
				new OpNSIndexer(owners, network),
				new SigmaIndexer(owners, network),
				new MapIndexer(owners, network),
			]

			// 5. Fetch sync stream and group outputs by txid
			const outputsByTxid = new Map<string, SyncOutput[]>()
			let maxSafeScore = lastScore

			for await (const output of services.owner.sync(
				addresses,
				lastScore || undefined,
				onProgress as ((progress: SyncProgress) => void) | undefined,
			)) {
				const txid = output.outpoint.substring(0, 64)

				if (!outputsByTxid.has(txid)) {
					outputsByTxid.set(txid, [])
				}
				outputsByTxid.get(txid)!.push(output)

				// Track max reorg-safe score
				const outputHeight = Math.floor(output.score)
				if (currentHeight - outputHeight >= REORG_SAFE_DEPTH) {
					if (output.score > maxSafeScore) {
						maxSafeScore = output.score
					}
				}
			}

			// 6. Process each txid
			let processed = 0
			let failed = 0

			for (const [txid, outputs] of outputsByTxid) {
				// Skip already-processed transactions
				if (await store.has(txid)) continue

				try {
					await processTxid(
						txid,
						outputs,
						ctx,
						services,
						indexers,
						addressMap,
					)
					await store.add(txid)
					processed++
				} catch (error) {
					console.error(
						`[syncAddresses] Failed to process txid ${txid}:`,
						error instanceof Error ? error.message : String(error),
					)
					failed++
				}
			}

			// 7. Update last score
			if (maxSafeScore > lastScore) {
				await store.setLastScore(maxSafeScore)
			}

			return { processed, failed, lastScore: maxSafeScore, addresses }
		} finally {
			await store.close()
		}
	},
}

// ============================================================================
// Transaction processing (adapted from AddressSyncProcessor)
// ============================================================================

async function processTxid(
	txid: string,
	outputs: SyncOutput[],
	ctx: { wallet: import('@bsv/sdk').WalletInterface },
	services: OneSatServices,
	indexers: Indexer[],
	addressMap: Map<string, AddressDerivation>,
): Promise<void> {
	// Check if all outputs are spend-only (no new outputs to internalize)
	if (outputs.every((o) => !!o.spendTxid && !isNewOutput(o))) {
		return
	}

	// Load BEEF
	const beef = await services.beef.getBeef(txid)
	if (!beef) {
		throw new Error(`Failed to load BEEF for ${txid}`)
	}

	const beefObj = Beef.fromBinary(Array.from(beef))
	const btx = beefObj.findTxid(txid)
	if (!btx?.tx) {
		throw new Error(`Transaction ${txid} not found in BEEF`)
	}

	// Ensure source transactions are loaded for inputs
	for (const input of btx.tx.inputs) {
		if (!input.sourceTransaction && input.sourceTXID) {
			const rawTx = await services.beef.getRawTx(input.sourceTXID)
			input.sourceTransaction = Transaction.fromBinary(Array.from(rawTx))
		}
	}

	// Parse transaction with indexers
	const parseCtx = await parseTransaction(btx.tx, indexers)

	// Build InternalizeOutput entries for owned outputs
	const internalizeOutputs: InternalizeOutput[] = []
	const ownedTxos: Txo[] = []

	for (const txo of parseCtx.txos) {
		if (!txo.owner) continue

		const derivation = addressMap.get(txo.owner)
		if (!derivation) continue

		const internalizeOutput = buildInternalizeOutput(txo, derivation)
		if (internalizeOutput) {
			internalizeOutputs.push(internalizeOutput)
			ownedTxos.push(txo)
		}
	}

	if (internalizeOutputs.length === 0) return

	const args: InternalizeActionArgs = {
		tx: Array.from(beef),
		outputs: internalizeOutputs,
		description: buildDescription(ownedTxos),
	}

	await ctx.wallet.internalizeAction(args)
}

function isNewOutput(output: SyncOutput): boolean {
	// An output with only a spendTxid and no indication of being a new output
	// is a spend notification, not a new output to internalize
	return !output.spendTxid
}

async function parseTransaction(
	tx: Transaction,
	indexers: Indexer[],
): Promise<ParseContext> {
	const txid = tx.id('hex')

	const ctx: ParseContext = {
		tx,
		txid,
		txos: [],
		spends: [],
		summary: {},
		indexers,
	}

	// Parse inputs into spends
	for (let vin = 0; vin < tx.inputs.length; vin++) {
		const input = tx.inputs[vin]
		if (!input.sourceTransaction) {
			throw new Error(`Missing sourceTransaction for input ${vin}`)
		}
		const sourceTxid = input.sourceTransaction.id('hex')
		const txo: Txo = {
			output: input.sourceTransaction.outputs[input.sourceOutputIndex],
			outpoint: new Outpoint(sourceTxid, input.sourceOutputIndex),
			data: {},
		}

		for (const indexer of indexers) {
			const result = await indexer.parse(txo)
			if (result) {
				txo.data[indexer.tag] = {
					data: result.data,
					tags: result.tags,
					content: result.content,
				}
				if (result.owner && !txo.owner) txo.owner = result.owner
				if (result.basket && !txo.basket) txo.basket = result.basket
			}
		}

		ctx.spends.push(txo)
	}

	// Parse each output
	for (let vout = 0; vout < tx.outputs.length; vout++) {
		const output = tx.outputs[vout]
		const txo: Txo = {
			output,
			outpoint: new Outpoint(txid, vout),
			data: {},
		}

		for (const indexer of indexers) {
			const result = await indexer.parse(txo)
			if (result) {
				txo.data[indexer.tag] = {
					data: result.data,
					tags: result.tags,
					content: result.content,
				}
				if (result.owner && !txo.owner) txo.owner = result.owner
				if (result.basket && !txo.basket) txo.basket = result.basket
				if (result.protocol && !txo.protocol) txo.protocol = result.protocol
			}
		}

		ctx.txos.push(txo)
	}

	// Summarize phase
	for (const indexer of indexers) {
		const summary = await indexer.summarize(ctx, true)
		if (summary) {
			ctx.summary[indexer.tag] = summary
		}
	}

	return ctx
}

function buildInternalizeOutput(
	txo: Txo,
	derivation: AddressDerivation,
): InternalizeOutput | null {
	const vout = txo.outpoint.vout
	const protocol = txo.protocol || 'wallet payment'

	if (protocol === 'basket insertion') {
		const basket = txo.basket || 'custom'
		const tags = collectTags(txo)
		const nameTag = tags.find((t) => t.startsWith('name:'))

		return {
			outputIndex: vout,
			protocol: 'basket insertion',
			insertionRemittance: {
				basket,
				tags,
				customInstructions: JSON.stringify({
					derivationPrefix: derivation.derivationPrefix,
					derivationSuffix: derivation.derivationSuffix,
					senderIdentityKey: derivation.senderIdentityKey,
					...(nameTag && { name: nameTag.slice(5).slice(0, 64) }),
				}),
			},
		}
	}

	// P2PKH ordinals/tokens: basket insertion so they don't get consumed as change
	if (txo.basket && txo.basket !== 'fund') {
		const tags = collectTags(txo)
		const nameTag = tags.find((t) => t.startsWith('name:'))

		return {
			outputIndex: vout,
			protocol: 'basket insertion',
			insertionRemittance: {
				basket: txo.basket,
				tags,
				customInstructions: JSON.stringify({
					protocolID: BRC29_PROTOCOL_ID,
					keyID: `${derivation.derivationPrefix} ${derivation.derivationSuffix}`,
					...(nameTag && { name: nameTag.slice(5).slice(0, 64) }),
				}),
			},
		}
	}

	// P2PKH funding output
	return {
		outputIndex: vout,
		protocol: 'wallet payment',
		paymentRemittance: {
			derivationPrefix: derivation.derivationPrefix,
			derivationSuffix: derivation.derivationSuffix,
			senderIdentityKey: derivation.senderIdentityKey,
		},
	}
}

function collectTags(txo: Txo): string[] {
	const tags: string[] = []
	for (const indexData of Object.values(txo.data)) {
		tags.push(...indexData.tags)
	}
	return tags
}

function buildDescription(ownedTxos: Txo[]): string {
	const parts: string[] = []
	let sats = 0

	for (const txo of ownedTxos) {
		if (txo.data.bsv21) {
			const token = txo.data.bsv21.data as {
				amt: bigint
				dec: number
				sym?: string
			}
			const sym = token.sym || 'tokens'
			const amt = Number(token.amt) / 10 ** token.dec
			parts.push(`${amt} ${sym}`)
		} else if (txo.basket === '1sat') {
			parts.push('ordinal')
		} else if (txo.basket === 'opns') {
			parts.push('OPNS name')
		} else if (txo.basket === 'fund') {
			sats += Number(txo.output.satoshis || 0)
		}
	}

	if (sats > 0) {
		parts.push(`${sats} sats`)
	}

	if (parts.length === 0) return 'Received via address sync'

	const desc = `Received ${parts.join(' + ')}`
	if (desc.length <= 50) return desc
	return `${desc.slice(0, 47)}...`
}

/** All sync actions for registry */
export const syncActions = [syncAddresses]

export { type ProcessedTxStore } from './ProcessedTxStore'
export { ProcessedTxStoreIdb } from './ProcessedTxStoreIdb'
export { ProcessedTxStoreSqlite } from './ProcessedTxStoreSqlite'
