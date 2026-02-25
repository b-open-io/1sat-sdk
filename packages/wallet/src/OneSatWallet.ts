import { OneSatServices } from '@1sat/client'
import type { Indexer, ParseContext, SyncOutput, Txo } from '@1sat/types'
import {
	Beef,
	KeyDeriver,
	type PrivateKey,
	Random,
	Transaction,
	Utils,
} from '@bsv/sdk'
import {
	Wallet,
	type WalletStorageManager,
	type sdk as mobileSdk,
} from '@bsv/wallet-toolbox'
import {
	Bsv21Indexer,
	CosignIndexer,
	FundIndexer,
	InscriptionIndexer,
	LockIndexer,
	MapIndexer,
	OpNSIndexer,
	OrdLockIndexer,
	OriginIndexer,
	SigmaIndexer,
} from './indexers'
import { Outpoint } from './indexers/Outpoint'
import { ReadOnlySigner } from './signers/ReadOnlySigner'

type Chain = mobileSdk.Chain
type TransactionStatus = mobileSdk.TransactionStatus
type StorageProvidedBy = mobileSdk.StorageProvidedBy
type EventCallback<T> = (event: T) => void

/**
 * Result of ingestTransaction including parse context for debugging
 */
export interface IngestResult {
	parseContext: ParseContext
	internalizedCount: number
}

/**
 * Events emitted by OneSatWallet during sync operations
 */
export interface OneSatWalletEvents {
	'sync:start': { address: string; fromScore: number }
	'sync:output': { address: string; output: SyncOutput }
	'sync:skipped': { address: string; outpoint: string; reason: string }
	'sync:parsed': {
		address: string
		txid: string
		parseContext: ParseContext
		internalizedCount: number
	}
	'sync:error': { address: string; error: Error }
	'sync:complete': { address: string }
	'syncAll:start': { addresses: string[]; fromScore: number }
	'syncAll:output': { output: SyncOutput }
	'syncAll:skipped': { outpoint: string; reason: string }
	'syncAll:parsed': {
		txid: string
		parseContext: ParseContext
		internalizedCount: number
	}
	'syncAll:error': { error: Error }
	'syncAll:complete': { addresses: string[] }
}

export interface OneSatWalletArgs {
	/**
	 * Either a public key hex string (read-only mode) or a PrivateKey (full signing).
	 */
	rootKey: string | PrivateKey
	/**
	 * The storage manager for the wallet.
	 */
	storage: WalletStorageManager
	/**
	 * Network: 'main' or 'test'
	 */
	chain: Chain
	/**
	 * Addresses owned by this wallet, used for filtering indexed outputs.
	 */
	owners?: Set<string>
	/**
	 * Indexers to use for parsing transactions.
	 * If not provided, default indexers will be used.
	 */
	indexers?: Indexer[]
	/**
	 * Custom 1Sat API URL (default: based on chain - mainnet or testnet)
	 */
	onesatUrl?: string
	/**
	 * Automatically start syncing all owner addresses on construction.
	 */
	autoSync?: boolean
}

/**
 * OneSatWallet extends the BRC-100 Wallet with 1Sat-specific indexing and services.
 *
 * Can be instantiated with either:
 * - A public key (read-only mode for queries)
 * - A private key (full signing capability)
 */
export class OneSatWallet extends Wallet {
	private readonly isReadOnly: boolean
	private readonly indexers: Indexer[]
	readonly services: OneSatServices
	private owners: Set<string>
	private listeners: Partial<
		Record<
			keyof OneSatWalletEvents,
			Set<EventCallback<OneSatWalletEvents[keyof OneSatWalletEvents]>>
		>
	> = {}
	private activeSyncs = new Map<string, () => void>()
	private activeMultiSync: (() => void) | null = null

	constructor(args: OneSatWalletArgs) {
		const rootKey = args.rootKey
		const isReadOnly = typeof rootKey === 'string'
		let keyDeriver: KeyDeriver | ReadOnlySigner
		if (typeof rootKey === 'string') {
			keyDeriver = new ReadOnlySigner(rootKey)
		} else {
			keyDeriver = new KeyDeriver(rootKey)
		}
		const services = new OneSatServices(args.chain, args.onesatUrl)
		const network = args.chain === 'main' ? 'mainnet' : 'testnet'
		const owners = args.owners ?? new Set<string>()

		super({
			chain: args.chain,
			keyDeriver,
			storage: args.storage,
			services,
		})

		this.isReadOnly = isReadOnly
		this.services = services
		this.owners = owners
		this.indexers =
			args.indexers ??
			([
				new FundIndexer(owners, network),
				new LockIndexer(owners, network),
				new InscriptionIndexer(owners, network),
				new SigmaIndexer(owners, network),
				new MapIndexer(owners, network),
				new OriginIndexer(owners, network, services),
				new Bsv21Indexer(owners, network, services),
				new OrdLockIndexer(owners, network),
				new OpNSIndexer(owners, network),
				new CosignIndexer(owners, network),
			] as Indexer[])

		if (args.autoSync) {
			this.syncAll()
		}
	}

	/**
	 * Returns true if this wallet was created with only a public key.
	 * Read-only wallets can query but not sign transactions.
	 */
	get readOnly(): boolean {
		return this.isReadOnly
	}

	/**
	 * Subscribe to wallet events
	 */
	on<K extends keyof OneSatWalletEvents>(
		event: K,
		callback: EventCallback<OneSatWalletEvents[K]>,
	): void {
		if (!this.listeners[event]) {
			this.listeners[event] = new Set<
				EventCallback<OneSatWalletEvents[K]>
			>() as Set<EventCallback<OneSatWalletEvents[keyof OneSatWalletEvents]>>
		}
		;(this.listeners[event] as Set<EventCallback<OneSatWalletEvents[K]>>).add(
			callback,
		)
	}

	/**
	 * Unsubscribe from wallet events
	 */
	off<K extends keyof OneSatWalletEvents>(
		event: K,
		callback: EventCallback<OneSatWalletEvents[K]>,
	): void {
		;(
			this.listeners[event] as
				| Set<EventCallback<OneSatWalletEvents[K]>>
				| undefined
		)?.delete(callback)
	}

	/**
	 * Emit a wallet event
	 */
	private emit<K extends keyof OneSatWalletEvents>(
		event: K,
		data: OneSatWalletEvents[K],
	): void {
		const callbacks = this.listeners[event] as
			| Set<EventCallback<OneSatWalletEvents[K]>>
			| undefined
		if (callbacks) {
			for (const cb of callbacks) {
				cb(data)
			}
		}
	}

	/**
	 * Add an address to the set of owned addresses.
	 * Outputs to these addresses will be indexed.
	 */
	addOwner(address: string): void {
		this.owners.add(address)
	}

	/**
	 * Parse a transaction through indexers without internalizing.
	 *
	 * This is useful for debugging/testing to see what the indexers produce
	 * without actually storing the transaction in the wallet.
	 */
	async parseTransaction(
		txOrTxid: Transaction | string,
		isBroadcasted = true,
	): Promise<ParseContext> {
		const tx =
			typeof txOrTxid === 'string'
				? await this.loadTransaction(txOrTxid)
				: txOrTxid
		await this.hydrateSourceTransactions(tx)
		const ctx = this.buildParseContext(tx)
		await this.parseInputs(ctx)
		for (const txo of ctx.txos) {
			await this.runIndexersOnTxo(txo)
		}
		for (const indexer of this.indexers) {
			const summary = await indexer.summarize(ctx, isBroadcasted)
			if (summary) {
				ctx.summary[indexer.tag] = summary
			}
		}
		return ctx
	}

	/**
	 * Parse a single output without full transaction context.
	 * Runs all indexers' parse() methods but NOT summarize().
	 */
	async parseOutput(
		output: Transaction['outputs'][0],
		outpoint: Outpoint,
	): Promise<Txo> {
		const txo: Txo = { output, outpoint, data: {} }
		await this.runIndexersOnTxo(txo)
		return txo
	}

	/**
	 * Load and parse a single output by outpoint.
	 * Loads the transaction, extracts the output, and runs indexers on it.
	 */
	async loadTxo(outpoint: string): Promise<Txo> {
		const op = new Outpoint(outpoint)
		const tx = await this.loadTransaction(op.txid)
		const output = tx.outputs[op.vout]
		if (!output) {
			throw new Error(`Output ${op.vout} not found in transaction ${op.txid}`)
		}
		return this.parseOutput(output, op)
	}

	/**
	 * Run all indexers on a single Txo and populate its data/owner/basket
	 */
	async runIndexersOnTxo(txo: Txo): Promise<void> {
		for (const indexer of this.indexers) {
			const result = await indexer.parse(txo)
			if (result) {
				txo.data[indexer.tag] = {
					data: result.data,
					tags: result.tags,
				}
				if (result.owner) {
					txo.owner = result.owner
				}
				if (result.basket) {
					txo.basket = result.basket
				}
			}
		}
	}

	/**
	 * Parse all inputs - run indexers on source outputs to populate ctx.spends
	 */
	private async parseInputs(ctx: ParseContext): Promise<void> {
		for (const input of ctx.tx.inputs) {
			if (!input.sourceTransaction) continue
			const sourceOutput =
				input.sourceTransaction.outputs[input.sourceOutputIndex]
			if (!sourceOutput) continue
			const sourceTxid = input.sourceTransaction.id('hex')
			const sourceVout = input.sourceOutputIndex
			const spendTxo: Txo = {
				output: sourceOutput,
				outpoint: new Outpoint(sourceTxid, sourceVout),
				data: {},
			}
			await this.runIndexersOnTxo(spendTxo)
			ctx.spends.push(spendTxo)
		}
	}

	/**
	 * Load a transaction by txid.
	 * Checks storage first, falls back to beef service.
	 */
	async loadTransaction(txid: string): Promise<Transaction> {
		const userId = await this.storage.getUserId()
		const existingTx = await this.storage.runAsStorageProvider(async (sp) => {
			const txs = await sp.findTransactions({ partial: { userId, txid } })
			return txs.length > 0 ? txs[0] : null
		})
		if (existingTx?.rawTx) {
			return Transaction.fromBinary(existingTx.rawTx)
		}
		const beefBytes = await this.services.beef.getBeef(txid)
		return Transaction.fromBEEF(Array.from(beefBytes))
	}

	/**
	 * Load and attach source transactions for all inputs (1 level deep).
	 * Modifies the transaction in place.
	 */
	async hydrateSourceTransactions(tx: Transaction): Promise<void> {
		const loaded = new Map<string, Transaction>()
		for (const input of tx.inputs) {
			if (!input.sourceTransaction && input.sourceTXID) {
				if (!loaded.has(input.sourceTXID)) {
					loaded.set(
						input.sourceTXID,
						await this.loadTransaction(input.sourceTXID),
					)
				}
				input.sourceTransaction = loaded.get(input.sourceTXID)
			}
		}
	}

	/**
	 * Build minimal parse context from transaction
	 */
	buildParseContext(tx: Transaction): ParseContext {
		const txid = tx.id('hex')
		return {
			tx,
			txid,
			txos: tx.outputs.map((output, vout) => ({
				output,
				outpoint: new Outpoint(txid, vout),
				data: {},
			})),
			spends: [],
			summary: {},
			indexers: this.indexers,
		}
	}

	/**
	 * Ingest a transaction by running it through indexers and writing directly to storage.
	 */
	async ingestTransaction(
		tx: Transaction,
		description: string,
		labels?: string[],
		isBroadcasted = true,
	): Promise<IngestResult> {
		const ctx = await this.parseTransaction(tx, isBroadcasted)
		const txid = tx.id('hex')
		const ownedTxos = ctx.txos.filter(
			(txo) => txo.owner && this.owners.has(txo.owner),
		)
		const userId = await this.storage.getUserId()
		const internalizedCount = await this.storage.runAsStorageProvider(
			async (sp) => {
				return sp.transaction(async (trx) => {
					const existingTxs = await sp.findTransactions({
						partial: { userId, txid },
						trx,
					})

					let transactionId: number
					let isNewTransaction = false

					if (existingTxs.length > 0) {
						transactionId = existingTxs[0].transactionId
					} else {
						let isOutgoing = false
						let satoshisSpent = 0
						for (const input of tx.inputs) {
							if (input.sourceTXID) {
								const spentOutputs = await sp.findOutputs({
									partial: {
										userId,
										txid: input.sourceTXID,
										vout: input.sourceOutputIndex,
									},
									trx,
								})
								if (spentOutputs.length > 0) {
									isOutgoing = true
									satoshisSpent += spentOutputs[0].satoshis
								}
							}
						}

						const satoshisReceived = ownedTxos.reduce(
							(sum, txo) => sum + (txo.output.satoshis || 0),
							0,
						)
						const satoshis = satoshisReceived - satoshisSpent
						const now = new Date()
						const reference = Utils.toBase64(Random(12))
						const status: TransactionStatus = isBroadcasted
							? 'completed'
							: 'unproven'
						const newTx = {
							created_at: now,
							updated_at: now,
							transactionId: 0,
							userId,
							status,
							reference,
							isOutgoing,
							satoshis,
							description,
							version: tx.version,
							lockTime: tx.lockTime,
							txid,
							rawTx: Array.from(tx.toBinary()),
						}
						transactionId = await sp.insertTransaction(newTx, trx)
						isNewTransaction = true

						const txQueue = [...tx.inputs]
						for (const input of txQueue) {
							if (!input.sourceTransaction) continue
							const sourceTxid = input.sourceTransaction.id('hex')
							const existing = await sp.findTransactions({
								partial: { userId, txid: sourceTxid },
								trx,
							})
							if (existing.length > 0) continue
							const sourceNow = new Date()
							const sourceRef = Utils.toBase64(Random(12))
							await sp.insertTransaction(
								{
									created_at: sourceNow,
									updated_at: sourceNow,
									transactionId: 0,
									userId,
									status: 'completed' as TransactionStatus,
									reference: sourceRef,
									isOutgoing: false,
									satoshis: 0,
									description: 'source transaction',
									version: input.sourceTransaction.version,
									lockTime: input.sourceTransaction.lockTime,
									txid: sourceTxid,
									rawTx: Array.from(input.sourceTransaction.toBinary()),
								},
								trx,
							)
							txQueue.push(...input.sourceTransaction.inputs)
						}

						for (const label of labels || []) {
							const txLabel = await sp.findOrInsertTxLabel(userId, label, trx)
							if (txLabel.txLabelId) {
								await sp.findOrInsertTxLabelMap(
									transactionId,
									txLabel.txLabelId,
									trx,
								)
							}
						}
					}

					if (isNewTransaction) {
						for (const input of tx.inputs) {
							if (input.sourceTXID) {
								const spentOutputs = await sp.findOutputs({
									partial: {
										userId,
										txid: input.sourceTXID,
										vout: input.sourceOutputIndex,
									},
									trx,
								})
								if (spentOutputs.length > 0) {
									const output = spentOutputs[0]
									if (output.outputId) {
										await sp.updateOutput(
											output.outputId,
											{
												spendable: false,
												spentBy: transactionId,
											},
											trx,
										)
									}
								}
							}
						}
					}

					let outputsCreated = 0
					for (const txo of ownedTxos) {
						const existingOutputs = await sp.findOutputs({
							partial: { userId, txid, vout: txo.outpoint.vout },
							trx,
						})
						if (existingOutputs.length > 0) {
							continue
						}

						const tags: string[] = []
						if (txo.owner) {
							tags.push(`own:${txo.owner}`)
						}
						for (const indexData of Object.values(txo.data)) {
							if (indexData.tags) {
								tags.push(...indexData.tags)
							}
						}

						const basketName = txo.basket || 'default'
						const basket = await sp.findOrInsertOutputBasket(
							userId,
							basketName,
							trx,
						)
						const now = new Date()
						const providedBy: StorageProvidedBy = 'you'
						const newOutput = {
							created_at: now,
							updated_at: now,
							outputId: 0,
							userId,
							transactionId,
							basketId: basket.basketId,
							spendable: true,
							change: basketName === 'default',
							outputDescription: '',
							vout: txo.outpoint.vout,
							satoshis: txo.output.satoshis || 0,
							providedBy,
							purpose: basketName === 'default' ? 'change' : '',
							type: 'custom',
							txid,
							lockingScript: Array.from(txo.output.lockingScript.toBinary()),
							spentBy: undefined,
						}
						const outputId = await sp.insertOutput(newOutput, trx)
						for (const tag of tags) {
							const outputTag = await sp.findOrInsertOutputTag(userId, tag, trx)
							if (outputTag.outputTagId) {
								await sp.findOrInsertOutputTagMap(
									outputId,
									outputTag.outputTagId,
									trx,
								)
							}
						}
						outputsCreated++
					}

					return outputsCreated
				})
			},
		)

		return { parseContext: ctx, internalizedCount }
	}

	/**
	 * Broadcast a transaction and ingest it into the wallet if successful.
	 */
	async broadcast(
		tx: Transaction,
		description: string,
		labels?: string[],
	): Promise<IngestResult> {
		const txid = tx.id('hex')
		const beef = new Beef()
		beef.mergeTransaction(tx)
		const results = await this.services.postBeef(beef, [txid])
		const result = results[0]
		if (result.status !== 'success') {
			const errorMsg = result.error?.message || 'Broadcast failed'
			throw new Error(`Broadcast failed for ${txid}: ${errorMsg}`)
		}
		return this.ingestTransaction(tx, description, labels, true)
	}

	/**
	 * Sync a single address from the 1Sat indexer using Server-Sent Events.
	 * Runs in the background - use stopSync() or close() to stop.
	 */
	syncAddress(address: string, fromScore = 0): void {
		this.stopSync(address)
		this.emit('sync:start', { address, fromScore })
		const seenTxids = new Set<string>()

		const processOutput = async (output: SyncOutput) => {
			this.emit('sync:output', { address, output })
			const txid = output.outpoint.substring(0, 64)
			if (seenTxids.has(txid)) {
				this.emit('sync:skipped', {
					address,
					outpoint: output.outpoint,
					reason: 'already processed in this session',
				})
				if (output.spendTxid && !seenTxids.has(output.spendTxid)) {
					await this.processSpendTx(address, output, seenTxids)
				}
				return
			}

			const vout = Number.parseInt(output.outpoint.substring(65), 10)
			const hasOutput = await this.storage.runAsStorageProvider(async (sp) => {
				const outputs = await sp.findOutputs({ partial: { txid, vout } })
				return outputs.length > 0
			})

			if (!hasOutput) {
				if (output.spendTxid) {
					seenTxids.add(txid)
					this.emit('sync:skipped', {
						address,
						outpoint: output.outpoint,
						reason: 'already spent, skipping historical output',
					})
					return
				}

				const tx = await this.loadTransaction(txid)
				const result = await this.ingestTransaction(tx, '1sat-sync')
				seenTxids.add(txid)
				this.emit('sync:parsed', {
					address,
					txid,
					parseContext: result.parseContext,
					internalizedCount: result.internalizedCount,
				})
			} else {
				seenTxids.add(txid)
				if (output.spendTxid) {
					await this.processSpendTx(address, output, seenTxids)
				} else {
					this.emit('sync:skipped', {
						address,
						outpoint: output.outpoint,
						reason: 'already have output in storage',
					})
				}
			}
		}

		const unsubscribe = this.services.owner.sync(
			[address],
			(output) => {
				processOutput(output)
			},
			fromScore,
			() => {
				this.activeSyncs.delete(address)
				this.emit('sync:complete', { address })
			},
			(error) => {
				this.activeSyncs.delete(address)
				this.emit('sync:error', { address, error })
			},
		)

		this.activeSyncs.set(address, unsubscribe)
	}

	/**
	 * Process a spend transaction during sync.
	 * Only marks our output as spent - doesn't ingest the spend tx.
	 */
	private async processSpendTx(
		address: string,
		output: SyncOutput,
		seenTxids: Set<string>,
	): Promise<void> {
		if (!output.spendTxid || seenTxids.has(output.spendTxid)) {
			return
		}

		const spentTxid = output.outpoint.substring(0, 64)
		const spentVout = Number.parseInt(output.outpoint.substring(65), 10)
		const userId = await this.storage.getUserId()
		const outputRecord = await this.storage.runAsStorageProvider(async (sp) => {
			const outputs = await sp.findOutputs({
				partial: { userId, txid: spentTxid, vout: spentVout },
			})
			return outputs.length > 0 ? outputs[0] : null
		})

		if (!outputRecord || !outputRecord.spendable) {
			seenTxids.add(output.spendTxid)
			this.emit('sync:skipped', {
				address,
				outpoint: output.outpoint,
				reason: outputRecord ? 'already marked spent' : 'output not in wallet',
			})
			return
		}

		let spendTx: Transaction
		const existingTx = await this.storage.runAsStorageProvider(async (sp) => {
			const txs = await sp.findTransactions({
				partial: { userId, txid: output.spendTxid },
			})
			return txs.length > 0 ? txs[0] : null
		})

		if (existingTx?.rawTx) {
			spendTx = Transaction.fromBinary(existingTx.rawTx)
		} else {
			const beefBytes = await this.services.beef.getBeef(output.spendTxid)
			spendTx = Transaction.fromBEEF(Array.from(beefBytes))
			const chainTracker = await this.services.getChainTracker()
			const isValid = await spendTx.verify(chainTracker)
			if (!isValid) {
				this.emit('sync:error', {
					address,
					error: new Error(
						`Spend tx ${output.spendTxid} failed SPV verification`,
					),
				})
				return
			}
		}

		const inputFound = spendTx.inputs.some(
			(input) =>
				input.sourceTXID === spentTxid && input.sourceOutputIndex === spentVout,
		)
		if (!inputFound) {
			this.emit('sync:error', {
				address,
				error: new Error(
					`Outpoint ${output.outpoint} not found in spend tx ${output.spendTxid} inputs`,
				),
			})
			return
		}

		seenTxids.add(output.spendTxid)
		const outputId = outputRecord.outputId
		if (outputId) {
			await this.storage.runAsStorageProvider(async (sp) => {
				await sp.updateOutput(outputId, { spendable: false })
			})
		}
		this.emit('sync:skipped', {
			address,
			outpoint: output.outpoint,
			reason: 'marked as spent',
		})
	}

	/**
	 * Stop syncing a specific address.
	 */
	stopSync(address: string): void {
		const unsubscribe = this.activeSyncs.get(address)
		if (unsubscribe) {
			unsubscribe()
			this.activeSyncs.delete(address)
		}
	}

	/**
	 * Close the wallet and cleanup all active sync connections.
	 */
	close(): void {
		this.stopSyncAll()
		for (const unsubscribe of this.activeSyncs.values()) {
			unsubscribe()
		}
		this.activeSyncs.clear()
		this.services.close()
	}

	/**
	 * Start syncing all owner addresses using a single multi-owner SSE connection.
	 * This is more efficient than syncing each address individually.
	 */
	syncAll(fromScore = 0): void {
		this.stopSyncAll()
		const addresses = Array.from(this.owners)
		if (addresses.length === 0) return
		if (addresses.length === 1) {
			this.syncAddress(addresses[0], fromScore)
			return
		}

		this.emit('syncAll:start', { addresses, fromScore })
		const seenTxids = new Set<string>()

		const processOutput = async (output: SyncOutput) => {
			this.emit('syncAll:output', { output })
			const txid = output.outpoint.substring(0, 64)
			if (seenTxids.has(txid)) {
				this.emit('syncAll:skipped', {
					outpoint: output.outpoint,
					reason: 'already processed in this session',
				})
				if (output.spendTxid && !seenTxids.has(output.spendTxid)) {
					await this.processSpendTxMulti(output, seenTxids)
				}
				return
			}

			const vout = Number.parseInt(output.outpoint.substring(65), 10)
			const hasOutput = await this.storage.runAsStorageProvider(async (sp) => {
				const outputs = await sp.findOutputs({ partial: { txid, vout } })
				return outputs.length > 0
			})

			if (!hasOutput) {
				if (output.spendTxid) {
					seenTxids.add(txid)
					this.emit('syncAll:skipped', {
						outpoint: output.outpoint,
						reason: 'already spent, skipping historical output',
					})
					return
				}

				const tx = await this.loadTransaction(txid)
				const result = await this.ingestTransaction(tx, '1sat-sync')
				seenTxids.add(txid)
				this.emit('syncAll:parsed', {
					txid,
					parseContext: result.parseContext,
					internalizedCount: result.internalizedCount,
				})
			} else {
				seenTxids.add(txid)
				if (output.spendTxid) {
					await this.processSpendTxMulti(output, seenTxids)
				} else {
					this.emit('syncAll:skipped', {
						outpoint: output.outpoint,
						reason: 'already have output in storage',
					})
				}
			}
		}

		const unsubscribe = this.services.owner.sync(
			addresses,
			(output) => {
				processOutput(output)
			},
			fromScore,
			() => {
				this.activeMultiSync = null
				this.emit('syncAll:complete', { addresses })
			},
			(error) => {
				this.activeMultiSync = null
				this.emit('syncAll:error', { error })
			},
		)

		this.activeMultiSync = unsubscribe
	}

	/**
	 * Process a spend transaction during multi-owner sync.
	 */
	private async processSpendTxMulti(
		output: SyncOutput,
		seenTxids: Set<string>,
	): Promise<void> {
		if (!output.spendTxid || seenTxids.has(output.spendTxid)) {
			return
		}

		const spentTxid = output.outpoint.substring(0, 64)
		const spentVout = Number.parseInt(output.outpoint.substring(65), 10)
		const userId = await this.storage.getUserId()
		const outputRecord = await this.storage.runAsStorageProvider(async (sp) => {
			const outputs = await sp.findOutputs({
				partial: { userId, txid: spentTxid, vout: spentVout },
			})
			return outputs.length > 0 ? outputs[0] : null
		})

		if (!outputRecord || !outputRecord.spendable) {
			seenTxids.add(output.spendTxid)
			this.emit('syncAll:skipped', {
				outpoint: output.outpoint,
				reason: outputRecord ? 'already marked spent' : 'output not in wallet',
			})
			return
		}

		let spendTx: Transaction
		const existingTx = await this.storage.runAsStorageProvider(async (sp) => {
			const txs = await sp.findTransactions({
				partial: { userId, txid: output.spendTxid },
			})
			return txs.length > 0 ? txs[0] : null
		})

		if (existingTx?.rawTx) {
			spendTx = Transaction.fromBinary(existingTx.rawTx)
		} else {
			const beefBytes = await this.services.beef.getBeef(output.spendTxid)
			spendTx = Transaction.fromBEEF(Array.from(beefBytes))
			const chainTracker = await this.services.getChainTracker()
			const isValid = await spendTx.verify(chainTracker)
			if (!isValid) {
				this.emit('syncAll:error', {
					error: new Error(
						`Spend tx ${output.spendTxid} failed SPV verification`,
					),
				})
				return
			}
		}

		const inputFound = spendTx.inputs.some(
			(input) =>
				input.sourceTXID === spentTxid && input.sourceOutputIndex === spentVout,
		)
		if (!inputFound) {
			this.emit('syncAll:error', {
				error: new Error(
					`Outpoint ${output.outpoint} not found in spend tx ${output.spendTxid} inputs`,
				),
			})
			return
		}

		seenTxids.add(output.spendTxid)
		const outputId = outputRecord.outputId
		if (outputId) {
			await this.storage.runAsStorageProvider(async (sp) => {
				await sp.updateOutput(outputId, { spendable: false })
			})
		}
		this.emit('syncAll:skipped', {
			outpoint: output.outpoint,
			reason: 'marked as spent',
		})
	}

	/**
	 * Stop the multi-owner sync.
	 */
	stopSyncAll(): void {
		if (this.activeMultiSync) {
			this.activeMultiSync()
			this.activeMultiSync = null
		}
	}

	/**
	 * Start syncing each owner address individually.
	 * For most cases, use syncAll() instead which uses a single connection.
	 */
	syncEach(): void {
		for (const addr of this.owners) {
			this.syncAddress(addr)
		}
	}
}
