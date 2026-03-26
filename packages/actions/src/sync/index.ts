/**
 * Address Sync Action
 *
 * Derives BRC-29 deposit addresses, fetches new outputs from the
 * 1sat-stack indexer (triggering lazy indexing), classifies them
 * with the indexer pipeline, and internalizes them into the wallet.
 */

import { type AddressDerivation, BRC29_PROTOCOL_ID } from '@1sat/types'
import type { SyncOutput, SyncProgress } from '@1sat/types'
import { PublicKey, Utils } from '@bsv/sdk'
import type { Action, OneSatContext } from '../types'
import {
	type OutputDerivation,
	internalizeBeef,
} from '../utils/internalizeBeef'
import type { ProcessedTxStore } from './ProcessedTxStore'
import { ProcessedTxStoreIdb } from './ProcessedTxStoreIdb'
import { ProcessedTxStoreSqlite } from './ProcessedTxStoreSqlite'
import { syncMessages } from './syncMessages'

const REORG_SAFE_DEPTH = 6

// ============================================================================
// Address derivation helpers (shared with deriveDepositAddresses action)
// ============================================================================

function toBase64Prefix(prefix: string): string {
	return Utils.toBase64(Array.from(new TextEncoder().encode(prefix)))
}

// TEMPORARY: single-byte encoding to match initSyncContext derivation
// TODO: switch both to 4-byte big-endian encoding
function toBase64Suffix(index: number): string {
	return Utils.toBase64([index])
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

			// 4. Fetch sync stream and group outputs by txid
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

			// 5. Process each txid
			let processed = 0
			let failed = 0

			for (const [txid, outputs] of outputsByTxid) {
				// Skip already-processed transactions
				if (await store.has(txid)) continue

				try {
					await processTxid(txid, outputs, ctx, services, addressMap)
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

			// 6. Update last score
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
// Transaction processing
// ============================================================================

async function processTxid(
	txid: string,
	outputs: SyncOutput[],
	ctx: OneSatContext,
	services: import('@1sat/client').OneSatServices,
	addressMap: Map<string, AddressDerivation>,
): Promise<void> {
	if (outputs.every((o) => !!o.spendTxid)) {
		return
	}

	const beef = await services.beef.getBeef(txid)
	if (!beef) {
		throw new Error(`Failed to load BEEF for ${txid}`)
	}

	// Build address → derivation map for the indexer-based owner matching
	const addrDerivations = new Map<string, OutputDerivation>()
	for (const [address, d] of addressMap) {
		addrDerivations.set(address, {
			outputIndex: 0, // not used in address mode
			derivationPrefix: d.derivationPrefix,
			derivationSuffix: d.derivationSuffix,
			senderIdentityKey: d.senderIdentityKey,
		})
	}

	await internalizeBeef({
		beef,
		addressDerivations: addrDerivations,
		wallet: ctx.wallet,
		services,
		chain: ctx.chain,
	})
}

export { syncMessages }
export type { SyncMessagesInput, SyncMessagesResult } from './syncMessages'

/** All sync actions for registry */
export const syncActions = [syncAddresses, syncMessages]

export type { ProcessedTxStore } from './ProcessedTxStore'
export { ProcessedTxStoreIdb } from './ProcessedTxStoreIdb'
export { ProcessedTxStoreSqlite } from './ProcessedTxStoreSqlite'
