/**
 * AddressSyncManager - Syncs external transactions to the BRC-100 wallet.
 *
 * Split into two components for Chrome extension compatibility:
 * - AddressSyncFetcher: Calls SSE endpoint and enqueues txids (runs in UI context)
 * - AddressSyncProcessor: Processes queue and internalizes outputs (runs in service worker)
 *
 * This separation is necessary because EventSource (SSE) doesn't work reliably
 * in Chrome extension service workers due to their ephemeral nature.
 */

import type { OneSatServices } from '@1sat/client'
import type {
	AddressSyncQueueItem,
	AddressSyncQueueStorage,
	Indexer,
	ParseContext,
	SyncOutput,
	Txo,
} from '@1sat/types'
import type {
	InternalizeActionArgs,
	InternalizeOutput,
	WalletInterface,
} from '@bsv/sdk'
import { Beef } from '@bsv/sdk'
import { Bsv21Indexer } from '../indexers/Bsv21Indexer'
import { FundIndexer } from '../indexers/FundIndexer'
import { InscriptionIndexer } from '../indexers/InscriptionIndexer'
import { MapIndexer } from '../indexers/MapIndexer'
import { OpNSIndexer } from '../indexers/OpNSIndexer'
import { OriginIndexer } from '../indexers/OriginIndexer'
import { Outpoint } from '../indexers/Outpoint'
import { SigmaIndexer } from '../indexers/SigmaIndexer'
import { BRC29_PROTOCOL_ID, type AddressDerivation, type AddressManager } from './AddressManager'

/** Reorg-safe depth - only update lastQueuedScore for outputs this many blocks deep */
const REORG_SAFE_DEPTH = 6

/** Default batch size for queue processing */
const DEFAULT_BATCH_SIZE = 20

// ===== AddressSyncFetcher - SSE stream handler for UI context =====

export interface AddressSyncFetcherOptions {
	/** 1sat services for SSE stream */
	services: OneSatServices
	/** Sync queue storage (IndexedDB) */
	syncQueue: AddressSyncQueueStorage
	/** Address manager for getting addresses to sync */
	addressManager: AddressManager
}

export interface AddressSyncFetcherEvents {
	'fetch:start': { addresses: string[] }
	'fetch:queued': { outpoint: string; score: number }
	'fetch:complete': { queuedCount: number }
	'fetch:error': { message: string }
}

type AddressSyncFetcherEventListener<K extends keyof AddressSyncFetcherEvents> =
	(data: AddressSyncFetcherEvents[K]) => void

/**
 * AddressSyncFetcher - Fetches outputs via SSE and enqueues them.
 *
 * Run this from the UI context (popup) when the wallet opens.
 * It will fetch all new outputs since the last sync and add them to the queue.
 */
export class AddressSyncFetcher {
	private services: OneSatServices
	private syncQueue: AddressSyncQueueStorage
	private addressManager: AddressManager
	private unsubscribeStream: (() => void) | null = null
	private listeners: Map<
		keyof AddressSyncFetcherEvents,
		Set<AddressSyncFetcherEventListener<keyof AddressSyncFetcherEvents>>
	> = new Map()

	constructor(options: AddressSyncFetcherOptions) {
		this.services = options.services
		this.syncQueue = options.syncQueue
		this.addressManager = options.addressManager
	}

	on<K extends keyof AddressSyncFetcherEvents>(
		event: K,
		listener: AddressSyncFetcherEventListener<K>,
	): void {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set())
		}
		this.listeners
			.get(event)
			?.add(
				listener as AddressSyncFetcherEventListener<
					keyof AddressSyncFetcherEvents
				>,
			)
	}

	off<K extends keyof AddressSyncFetcherEvents>(
		event: K,
		listener: AddressSyncFetcherEventListener<K>,
	): void {
		this.listeners
			.get(event)
			?.delete(
				listener as AddressSyncFetcherEventListener<
					keyof AddressSyncFetcherEvents
				>,
			)
	}

	private emit<K extends keyof AddressSyncFetcherEvents>(
		event: K,
		data: AddressSyncFetcherEvents[K],
	): void {
		for (const listener of this.listeners.get(event) ?? []) {
			listener(data)
		}
	}

	/**
	 * Fetch new outputs via SSE and enqueue them.
	 * Returns when the stream completes (all historical data fetched).
	 */
	async fetch(currentHeight: number): Promise<number> {
		if (this.unsubscribeStream) {
			console.warn('Fetch already running')
			return 0
		}

		const addresses = this.addressManager.getAddresses()
		if (addresses.length === 0) {
			console.warn('No addresses to fetch')
			return 0
		}

		this.emit('fetch:start', { addresses })

		// Get last score for resumption
		const state = await this.syncQueue.getState()
		const fromScore = state.lastQueuedScore

		let queuedCount = 0

		return new Promise((resolve, reject) => {
			this.unsubscribeStream = this.services.owner.sync(
				addresses,
				async (output: SyncOutput) => {
					await this.handleSyncOutput(output, currentHeight)
					queuedCount++
					this.emit('fetch:queued', {
						outpoint: output.outpoint,
						score: output.score,
					})
				},
				fromScore,
				() => {
					// Stream complete
					this.unsubscribeStream = null
					this.emit('fetch:complete', { queuedCount })
					resolve(queuedCount)
				},
				(error: Error) => {
					this.unsubscribeStream = null
					this.emit('fetch:error', { message: error.message })
					reject(error)
				},
			)
		})
	}

	/**
	 * Stop the SSE stream if running.
	 */
	stop(): void {
		if (this.unsubscribeStream) {
			this.unsubscribeStream()
			this.unsubscribeStream = null
		}
	}

	private async handleSyncOutput(
		output: SyncOutput,
		currentHeight: number,
	): Promise<void> {
		// Enqueue the output
		await this.syncQueue.enqueue([
			{
				outpoint: output.outpoint,
				score: output.score,
				spendTxid: output.spendTxid,
			},
		])

		// Update lastQueuedScore only for reorg-safe outputs
		const outputHeight = Math.floor(output.score / 1e9)
		if (currentHeight - outputHeight >= REORG_SAFE_DEPTH) {
			await this.syncQueue.setState({ lastQueuedScore: output.score })
		}
	}
}

// ===== AddressSyncProcessor - Queue processor for service worker =====

export interface AddressSyncProcessorOptions {
	/** The BRC-100 wallet to internalize to */
	wallet: WalletInterface
	/** 1sat services for transaction fetching */
	services: OneSatServices
	/** Sync queue storage (IndexedDB) */
	syncQueue: AddressSyncQueueStorage
	/** Address manager for yours receive addresses */
	addressManager: AddressManager
	/** Network: mainnet or testnet */
	network: 'mainnet' | 'testnet'
	/** Batch size for queue processing (default: 20) */
	batchSize?: number
	/** Custom indexers (optional, uses defaults if not provided) */
	indexers?: Indexer[]
}

export interface AddressSyncProcessorEvents {
	'process:start': Record<string, never>
	'process:progress': { pending: number; done: number; failed: number }
	'process:complete': Record<string, never>
	'process:error': { message: string }
	'process:parsed': { internalizedCount: number }
}

type AddressSyncProcessorEventListener<
	K extends keyof AddressSyncProcessorEvents,
> = (data: AddressSyncProcessorEvents[K]) => void

/**
 * AddressSyncProcessor - Processes the sync queue and internalizes outputs.
 *
 * Run this from the service worker. It will process items from the queue
 * until the queue is empty or stop() is called.
 */
export class AddressSyncProcessor {
	private wallet: WalletInterface
	private services: OneSatServices
	private syncQueue: AddressSyncQueueStorage
	private addressManager: AddressManager
	private network: 'mainnet' | 'testnet'
	private batchSize: number
	private indexers: Indexer[]

	private processorRunning = false
	private stopRequested = false
	private listeners: Map<
		keyof AddressSyncProcessorEvents,
		Set<AddressSyncProcessorEventListener<keyof AddressSyncProcessorEvents>>
	> = new Map()

	constructor(options: AddressSyncProcessorOptions) {
		this.wallet = options.wallet
		this.services = options.services
		this.syncQueue = options.syncQueue
		this.addressManager = options.addressManager
		this.network = options.network
		this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE

		// Build owners set from address manager
		const owners = new Set(this.addressManager.getAddresses())

		// Initialize indexers for sync (P2PKH-based outputs only)
		this.indexers = options.indexers ?? [
			new FundIndexer(owners, this.network),
			new InscriptionIndexer(owners, this.network),
			new Bsv21Indexer(owners, this.network, this.services),
			new OriginIndexer(owners, this.network, this.services),
			new OpNSIndexer(owners, this.network),
			new SigmaIndexer(owners, this.network),
			new MapIndexer(owners, this.network),
		]
	}

	on<K extends keyof AddressSyncProcessorEvents>(
		event: K,
		listener: AddressSyncProcessorEventListener<K>,
	): void {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set())
		}
		this.listeners
			.get(event)
			?.add(
				listener as AddressSyncProcessorEventListener<
					keyof AddressSyncProcessorEvents
				>,
			)
	}

	off<K extends keyof AddressSyncProcessorEvents>(
		event: K,
		listener: AddressSyncProcessorEventListener<K>,
	): void {
		this.listeners
			.get(event)
			?.delete(
				listener as AddressSyncProcessorEventListener<
					keyof AddressSyncProcessorEvents
				>,
			)
	}

	private emit<K extends keyof AddressSyncProcessorEvents>(
		event: K,
		data: AddressSyncProcessorEvents[K],
	): void {
		for (const listener of this.listeners.get(event) ?? []) {
			listener(data)
		}
	}

	/**
	 * Start processing the queue.
	 * Processes until queue is empty or stop() is called.
	 */
	async start(): Promise<void> {
		if (this.processorRunning) {
			console.warn('Processor already running')
			return
		}

		// Reset any stuck processing items
		await this.syncQueue.resetProcessing()

		this.stopRequested = false
		this.emit('process:start', {})

		await this.processQueueLoop()
	}

	/**
	 * Stop processing the queue.
	 */
	stop(): void {
		this.stopRequested = true
	}

	/**
	 * Check if processor is currently running.
	 */
	isRunning(): boolean {
		return this.processorRunning
	}

	private async processQueueLoop(): Promise<void> {
		this.processorRunning = true

		try {
			while (!this.stopRequested) {
				// Claim batch of pending items grouped by txid
				const byTxid = await this.syncQueue.claim(this.batchSize)

				if (byTxid.size === 0) {
					// Queue empty - wait and poll again
					await new Promise((resolve) => setTimeout(resolve, 1000))
					continue
				}

				// Process each txid in parallel
				await Promise.all(
					Array.from(byTxid.entries()).map(([txid, items]) =>
						this.processTxid(txid, items),
					),
				)

				// Emit progress
				const stats = await this.syncQueue.getStats()
				this.emit('process:progress', {
					pending: stats.pending,
					done: stats.done,
					failed: stats.failed,
				})
			}

			this.emit('process:complete', {})
		} catch (error) {
			this.emit('process:error', {
				message: error instanceof Error ? error.message : String(error),
			})
		} finally {
			this.processorRunning = false
		}
	}

	private async processTxid(
		txid: string,
		items: AddressSyncQueueItem[],
	): Promise<void> {
		try {
			// Build spend map: vout → spendTxid
			const spendMap = new Map<number, string>()
			for (const item of items) {
				if (item.spendTxid) {
					const vout = Number.parseInt(item.outpoint.split('_')[1], 10)
					spendMap.set(vout, item.spendTxid)
				}
			}

			// If all items are spend-only (no new outputs), just mark outputs as spent
			const hasNewOutputs = items.some((item) => !item.spendTxid)
			if (!hasNewOutputs) {
				// TODO: Mark outputs as spent in wallet storage
				// For now, just complete the items
				await this.syncQueue.completeMany(items.map((i) => i.id))
				return
			}

			// Load transaction as BEEF
			const beef = await this.services.beef.getBeef(txid)
			if (!beef) {
				throw new Error(`Failed to load transaction ${txid}`)
			}

			// Parse transaction with indexers
			const beefObj = Beef.fromBinary(Array.from(beef))
			const btx = beefObj.findTxid(txid)
			if (!btx?.tx) {
				throw new Error(`Transaction ${txid} not found in BEEF`)
			}

			const ctx = await this.parseTransaction(btx.tx)

			// Build InternalizeOutput entries for owned outputs
			const outputs: InternalizeOutput[] = []
			const ownedTxos: Txo[] = []

			for (const txo of ctx.txos) {
				if (!txo.owner) continue

				// Check if this output is at one of our receive addresses
				const derivation = this.addressManager.getDerivation(txo.owner)
				if (!derivation) continue

				// Build internalize output using protocol from indexer
				const internalizeOutput = this.buildInternalizeOutput(txo, derivation)
				if (internalizeOutput) {
					outputs.push(internalizeOutput)
					ownedTxos.push(txo)
				}
			}

			// Internalize if we have owned outputs
			if (outputs.length > 0) {
				const args: InternalizeActionArgs = {
					tx: Array.from(beef),
					outputs,
					description: this.buildDescription(ownedTxos),
				}

				console.log(
					`[AddressSyncProcessor] Internalizing ${outputs.length} outputs for txid ${txid}`,
					outputs.map((o) => ({ vout: o.outputIndex, protocol: o.protocol })),
				)
				await this.wallet.internalizeAction(args)
				console.log(
					`[AddressSyncProcessor] Internalization complete for txid ${txid}`,
				)
				this.emit('process:parsed', { internalizedCount: ownedTxos.length })
			}

			// Complete all items for this txid
			await this.syncQueue.completeMany(items.map((i) => i.id))
		} catch (error) {
			// Fail all items for this txid
			const errorMsg = error instanceof Error ? error.message : String(error)
			console.error(
				`[AddressSyncProcessor] Failed to process txid ${txid}:`,
				errorMsg,
			)
			for (const item of items) {
				await this.syncQueue.fail(item.id, errorMsg)
			}
		}
	}

	private async parseTransaction(
		tx: import('@bsv/sdk').Transaction,
	): Promise<ParseContext> {
		const txid = tx.id('hex')

		// Initialize parse context
		const ctx: ParseContext = {
			tx,
			txid,
			txos: [],
			spends: [],
			summary: {},
			indexers: this.indexers,
		}

		// Parse each output
		for (let vout = 0; vout < tx.outputs.length; vout++) {
			const output = tx.outputs[vout]
			const txo: Txo = {
				output,
				outpoint: new Outpoint(txid, vout),
				data: {},
			}

			// Run through all indexers
			for (const indexer of this.indexers) {
				const result = await indexer.parse(txo)
				if (result) {
					txo.data[indexer.tag] = {
						data: result.data,
						tags: result.tags,
						content: result.content,
					}
					// First indexer to set owner wins
					if (result.owner && !txo.owner) {
						txo.owner = result.owner
					}
					// First indexer to set basket wins
					if (result.basket && !txo.basket) {
						txo.basket = result.basket
					}
					// First indexer to set protocol wins (custom scripts override P2PKH)
					if (result.protocol && !txo.protocol) {
						txo.protocol = result.protocol
					}
				}
			}

			ctx.txos.push(txo)
		}

		// Run summarize phase for all indexers
		for (const indexer of this.indexers) {
			const summary = await indexer.summarize(ctx, true)
			if (summary) {
				ctx.summary[indexer.tag] = summary
			}
		}

		return ctx
	}

	private buildInternalizeOutput(
		txo: Txo,
		derivation: AddressDerivation,
	): InternalizeOutput | null {
		const vout = txo.outpoint.vout

		// Use protocol from indexer, default to "wallet payment" for P2PKH
		const protocol = txo.protocol || 'wallet payment'

		if (protocol === 'basket insertion') {
			// Custom script - use basket insertion
			// These outputs need custom unlock scripts when spent
			const basket = txo.basket || 'custom'
			const tags = this.collectTags(txo)
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
			const tags = this.collectTags(txo)
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

		// P2PKH funding output - use wallet payment for auto-signing
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

	private collectTags(txo: Txo): string[] {
		const tags: string[] = []
		for (const indexData of Object.values(txo.data)) {
			tags.push(...indexData.tags)
		}
		return tags
	}

	private buildDescription(ownedTxos: Txo[]): string {
		const parts: string[] = []
		let sats = 0

		for (const txo of ownedTxos) {
			if (txo.data.bsv21) {
				const token = txo.data.bsv21.data as { amt: bigint; dec: number; sym?: string }
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
		return desc.slice(0, 47) + '...'
	}
}

// ===== AddressSyncManager - Combines both for environments with SSE support =====

export interface AddressSyncManagerOptions {
	/** The BRC-100 wallet to internalize to */
	wallet: WalletInterface
	/** 1sat services for SSE stream and transaction fetching */
	services: OneSatServices
	/** Sync queue storage (IndexedDB or SQLite) */
	syncQueue: AddressSyncQueueStorage
	/** Address manager for yours receive addresses */
	addressManager: AddressManager
	/** Network: mainnet or testnet */
	network: 'mainnet' | 'testnet'
	/** Batch size for queue processing (default: 20) */
	batchSize?: number
	/** Custom indexers (optional, uses defaults if not provided) */
	indexers?: Indexer[]
}

export interface AddressSyncEvents {
	'sync:start': { addresses: string[] }
	'sync:progress': { pending: number; done: number; failed: number }
	'sync:complete': Record<string, never>
	'sync:error': { message: string }
	'sync:parsed': { internalizedCount: number }
}

type AddressSyncEventListener<K extends keyof AddressSyncEvents> = (
	data: AddressSyncEvents[K],
) => void

/**
 * AddressSyncManager - Class that combines SSE fetching and queue processing.
 *
 * For Chrome extensions, use AddressSyncFetcher (UI) and AddressSyncProcessor
 * (service worker) separately since EventSource doesn't work reliably in service workers.
 */
export class AddressSyncManager {
	private fetcher: AddressSyncFetcher
	private processor: AddressSyncProcessor
	private wallet: WalletInterface
	private addressManager: AddressManager
	private listeners: Map<
		keyof AddressSyncEvents,
		Set<AddressSyncEventListener<keyof AddressSyncEvents>>
	> = new Map()
	private fetchPromise: Promise<number> | null = null

	constructor(options: AddressSyncManagerOptions) {
		this.wallet = options.wallet
		this.addressManager = options.addressManager

		// Create fetcher for SSE stream
		this.fetcher = new AddressSyncFetcher({
			services: options.services,
			syncQueue: options.syncQueue,
			addressManager: options.addressManager,
		})

		// Create processor for queue processing
		this.processor = new AddressSyncProcessor({
			wallet: options.wallet,
			services: options.services,
			syncQueue: options.syncQueue,
			addressManager: options.addressManager,
			network: options.network,
			batchSize: options.batchSize,
			indexers: options.indexers,
		})

		// Wire up event forwarding
		this.setupEventForwarding()
	}

	private setupEventForwarding(): void {
		// Forward fetcher events
		this.fetcher.on('fetch:start', (data) => {
			this.emit('sync:start', { addresses: data.addresses })
		})
		this.fetcher.on('fetch:error', (data) => {
			this.emit('sync:error', { message: data.message })
		})

		// Forward processor events
		this.processor.on('process:progress', (data) => {
			this.emit('sync:progress', data)
		})
		this.processor.on('process:complete', () => {
			this.emit('sync:complete', {})
		})
		this.processor.on('process:error', (data) => {
			this.emit('sync:error', { message: data.message })
		})
		this.processor.on('process:parsed', (data) => {
			this.emit('sync:parsed', data)
		})
	}

	// ===== Event Emitter =====

	on<K extends keyof AddressSyncEvents>(
		event: K,
		listener: AddressSyncEventListener<K>,
	): void {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set())
		}
		this.listeners
			.get(event)
			?.add(listener as AddressSyncEventListener<keyof AddressSyncEvents>)
	}

	off<K extends keyof AddressSyncEvents>(
		event: K,
		listener: AddressSyncEventListener<K>,
	): void {
		this.listeners
			.get(event)
			?.delete(listener as AddressSyncEventListener<keyof AddressSyncEvents>)
	}

	private emit<K extends keyof AddressSyncEvents>(
		event: K,
		data: AddressSyncEvents[K],
	): void {
		for (const listener of this.listeners.get(event) ?? []) {
			listener(data)
		}
	}

	// ===== Sync Control =====

	/**
	 * Start syncing - opens SSE stream and starts queue processor.
	 */
	async sync(): Promise<void> {
		if (this.fetchPromise || this.processor.isRunning()) {
			console.warn('Sync already running')
			return
		}

		const addresses = this.addressManager.getAddresses()
		if (addresses.length === 0) {
			console.warn('No addresses to sync')
			return
		}

		// Get current height for reorg protection
		const { height: currentHeight } = await this.wallet.getHeight({})

		// Start fetcher (SSE stream) - this runs until stream completes
		this.fetchPromise = this.fetcher.fetch(currentHeight)

		// Start processor in parallel - this processes items as they come in
		// and waits for more until fetch completes
		this.processor.start()

		// Wait for fetch to complete, then let processor finish
		try {
			await this.fetchPromise
		} finally {
			this.fetchPromise = null
		}
	}

	/**
	 * Stop syncing - closes SSE stream and stops queue processor.
	 */
	stop(): void {
		this.fetcher.stop()
		this.processor.stop()
		this.fetchPromise = null
	}

	/**
	 * Check if sync is currently running.
	 */
	isSyncing(): boolean {
		return this.fetchPromise !== null || this.processor.isRunning()
	}
}
