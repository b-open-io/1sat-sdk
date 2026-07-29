import { ONESAT_MAINNET_URL, ONESAT_TESTNET_URL } from '@1sat/types'
import type { Capability, ClientOptions, SyncOutput } from '@1sat/types'
import {
	Beef,
	Hash,
	MerklePath,
	Transaction,
	Utils,
	type WalletLoggerInterface,
} from '@bsv/sdk'
import type { TableOutput, sdk as toolboxSdk } from '@bsv/wallet-toolbox-client'
import { WalletError } from '@bsv/wallet-toolbox-client/out/src/sdk/WalletError.js'
import {
	AdminClient,
	ArcadeClient,
	BapClient,
	BeefClient,
	Bsv21Client,
	ChaintracksClient,
	MarketClient,
	MneeClient,
	OpnsClient,
	OrdfsClient,
	OverlayClient,
	OwnerClient,
	TxoClient,
} from './index'

type Chain = toolboxSdk.Chain
type BlockHeader = toolboxSdk.BlockHeader
type GetMerklePathResult = toolboxSdk.GetMerklePathResult
type GetRawTxResult = toolboxSdk.GetRawTxResult
type GetScriptHashHistoryResult = toolboxSdk.GetScriptHashHistoryResult
type GetStatusForTxidsResult = toolboxSdk.GetStatusForTxidsResult
type StatusForTxidResult = toolboxSdk.StatusForTxidResult
type GetUtxoStatusOutputFormat = toolboxSdk.GetUtxoStatusOutputFormat
type GetUtxoStatusResult = toolboxSdk.GetUtxoStatusResult
type PostBeefResult = toolboxSdk.PostBeefResult
type ServiceCallHistory = toolboxSdk.ServiceCallHistory
type ServicesCallHistory = toolboxSdk.ServicesCallHistory
type WalletServices = toolboxSdk.WalletServices

export type { SyncOutput }

/**
 * WalletServices implementation for 1Sat ecosystem.
 *
 * Provides access to 1Sat API clients and implements the WalletServices
 * interface required by wallet-toolbox.
 *
 * API Routes:
 * - /1sat/chaintracks/* - Block headers and chain tracking
 * - /1sat/beef/* - Raw transactions and proofs
 * - /1sat/tx, /1sat/tx/:txid - Transaction broadcast and status (via 1sat-stack's
 *   broker, which fronts arcade with the stack's callback token)
 * - /1sat/bap/* - BAP identity attestation
 * - /1sat/bsv21/* - BSV21 token data
 * - /1sat/txo/* - Transaction outputs
 * - /1sat/owner/* - Address queries and sync
 * - /1sat/ordfs/* - Content/inscription serving
 * - /1sat/market/* - Marketplace listings
 * - /1sat/opns/* - OpNS domain names
 * - /overlay/* - Overlay services (topic managers, lookups)
 */
export class OneSatServices implements WalletServices {
	chain: Chain
	readonly baseUrl: string

	// ===== API Clients =====
	readonly admin: AdminClient
	readonly bap: BapClient
	readonly chaintracks: ChaintracksClient
	readonly beef: BeefClient
	readonly arcade: ArcadeClient
	readonly txo: TxoClient
	readonly owner: OwnerClient
	readonly ordfs: OrdfsClient
	readonly bsv21: Bsv21Client
	readonly market: MarketClient
	readonly mnee: MneeClient
	readonly opns: OpnsClient
	readonly overlay: OverlayClient

	// Optional fallback to wallet-toolbox Services for methods we don't implement
	private fallbackServices?: WalletServices

	/**
	 * URL for wallet storage sync endpoint (BRC-100 JSON-RPC).
	 * Used by StorageClient for remote wallet backup/sync.
	 */
	get storageUrl(): string {
		return `${this.baseUrl}/1sat/wallet`
	}

	constructor(
		chain: Chain,
		baseUrl?: string,
		fallbackServices?: WalletServices,
	) {
		this.fallbackServices = fallbackServices
		this.chain = chain
		this.baseUrl =
			baseUrl || (chain === 'main' ? ONESAT_MAINNET_URL : ONESAT_TESTNET_URL)

		const opts: ClientOptions = { timeout: 30000 }
		this.admin = new AdminClient(this.baseUrl, opts)
		this.bap = new BapClient(this.baseUrl, opts)
		this.chaintracks = new ChaintracksClient(this.baseUrl, opts)
		this.beef = new BeefClient(this.baseUrl, opts)
		this.arcade = new ArcadeClient(this.baseUrl, opts)
		this.txo = new TxoClient(this.baseUrl, opts)
		this.owner = new OwnerClient(this.baseUrl, opts)
		this.ordfs = new OrdfsClient(this.baseUrl, opts)
		this.bsv21 = new Bsv21Client(this.baseUrl, opts)
		this.market = new MarketClient(this.baseUrl, opts)
		this.mnee = new MneeClient()
		this.opns = new OpnsClient(this.baseUrl, opts)
		this.overlay = new OverlayClient(this.baseUrl, opts)
	}

	// ===== Utility Methods =====

	/**
	 * Get list of enabled capabilities from the server
	 */
	async getCapabilities(): Promise<Capability[]> {
		const response = await fetch(`${this.baseUrl}/capabilities`)
		if (!response.ok) {
			throw new Error(`Failed to fetch capabilities: ${response.statusText}`)
		}
		return response.json()
	}

	/**
	 * Close all client connections
	 */
	close(): void {
		this.chaintracks.close()
	}

	// ===== WalletServices Interface (Required by wallet-toolbox) =====

	async getRawTx(txid: string, _useNext?: boolean): Promise<GetRawTxResult> {
		// This is a network-only call for the WalletServices interface.
		// Wallet should check storage before calling this.
		try {
			const beefBytes = await this.beef.getBeef(txid)
			const tx = Transaction.fromBEEF(Array.from(beefBytes))
			return { txid, name: '1sat-api', rawTx: Array.from(tx.toBinary()) }
		} catch (error) {
			return {
				txid,
				error: new WalletError(
					'NETWORK_ERROR',
					error instanceof Error ? error.message : 'Unknown error',
				),
			}
		}
	}

	async getChainTracker(): Promise<ChaintracksClient> {
		return this.chaintracks
	}

	async getHeaderForHeight(height: number): Promise<number[]> {
		return this.chaintracks.getHeaderBytes(height)
	}

	async getHeight(): Promise<number> {
		return this.chaintracks.currentHeight()
	}

	async getMerklePath(
		txid: string,
		_useNext?: boolean,
	): Promise<GetMerklePathResult> {
		console.log('[OneSatServices] getMerklePath called for txid:', txid)
		try {
			const proofBytes = await this.beef.getProof(txid)
			const merklePath = MerklePath.fromBinary([...proofBytes])
			console.log(
				'[OneSatServices] getMerklePath got proof, blockHeight:',
				merklePath.blockHeight,
			)

			// Fetch the block header for this merkle path
			const header = await this.chaintracks.findHeaderForHeight(
				merklePath.blockHeight,
			)
			if (!header) {
				console.log(
					'[OneSatServices] getMerklePath header not found for height:',
					merklePath.blockHeight,
				)
				return {
					name: '1sat-api',
					error: new WalletError(
						'HEADER_NOT_FOUND',
						`Block header not found for height ${merklePath.blockHeight}`,
					),
				}
			}

			console.log(
				'[OneSatServices] getMerklePath success, returning merklePath and header',
			)
			return { name: '1sat-api', merklePath, header }
		} catch (error) {
			console.error('[OneSatServices] getMerklePath error:', error)
			return {
				name: '1sat-api',
				error: new WalletError(
					'NETWORK_ERROR',
					error instanceof Error ? error.message : 'Unknown error',
				),
			}
		}
	}

	/**
	 * Submit a serialized transaction (raw tx bytes or atomic BEEF) to 1sat-stack's
	 * /1sat/tx broadcast endpoint. The handler captures BEEF locally, forwards to
	 * arcade with the stack's callback token, waits up to its configured window for
	 * an accepted/terminal status, and returns the full TransactionStatus.
	 */
	async submitToStack(payload: number[] | Uint8Array): Promise<{
		txid: string
		txStatus: string
		timestamp: string
		blockHash?: string
		blockHeight?: number
		merklePath?: string
		extraInfo?: string
		competingTxs?: string[]
	}> {
		const bytes =
			payload instanceof Uint8Array ? payload : new Uint8Array(payload)
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), 35000)
		try {
			const resp = await fetch(`${this.baseUrl}/1sat/tx`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: bytes as unknown as BodyInit,
				signal: controller.signal,
			})
			const text = await resp.text()
			if (!resp.ok && resp.status !== 202 && resp.status !== 400) {
				throw new Error(`/1sat/tx returned ${resp.status}: ${text}`)
			}
			return text
				? JSON.parse(text)
				: { txid: '', txStatus: 'UNKNOWN', timestamp: '' }
		} finally {
			clearTimeout(timeoutId)
		}
	}

	/**
	 * Look up a transaction's status by txid via 1sat-stack's /1sat/tx/:txid
	 * passthrough endpoint. Returns null on 404.
	 */
	async getStackStatus(txid: string): Promise<{
		txid: string
		txStatus: string
		timestamp: string
		blockHash?: string
		blockHeight?: number
		merklePath?: string
		extraInfo?: string
		competingTxs?: string[]
	} | null> {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), 10000)
		try {
			const resp = await fetch(`${this.baseUrl}/1sat/tx/${txid}`, {
				signal: controller.signal,
			})
			if (resp.status === 404) return null
			if (!resp.ok) {
				throw new Error(`/1sat/tx/${txid} returned ${resp.status}`)
			}
			return await resp.json()
		} finally {
			clearTimeout(timeoutId)
		}
	}

	async postBeef(
		beef: Beef,
		txids: string[],
		_logger?: WalletLoggerInterface,
	): Promise<PostBeefResult[]> {
		console.log('[OneSatServices] postBeef called with txids:', txids)
		console.log(`[OneSatServices] BEEF structure:\n${beef.toLogString()}`)
		const results: PostBeefResult[] = []

		for (const txid of txids) {
			try {
				// Submit as AtomicBEEF which includes all source transactions.
				// 1sat-stack's /1sat/tx accepts BEEF and auto-detects the format.
				console.log('[OneSatServices] Submitting tx to 1sat-stack:', txid)
				const atomicBeef = beef.toBinaryAtomic(txid)
				console.log(
					'[OneSatServices] AtomicBEEF length:',
					atomicBeef.length,
					'bytes',
				)
				const status = await this.submitToStack(atomicBeef)
				console.log('[OneSatServices] /1sat/tx response:', status)

				const SUCCESS_STATUSES = new Set([
					'IMMUTABLE',
					'MINED',
					'SEEN_ON_NETWORK',
					'SEEN_MULTIPLE_NODES',
					'ACCEPTED_BY_NETWORK',
				])
				const PROCESSING_STATUSES = new Set([
					'QUEUED',
					'RECEIVED',
					'STORED',
					'ANNOUNCED_TO_NETWORK',
					'REQUESTED_BY_NETWORK',
					'SENT_TO_NETWORK',
				])

				if (
					SUCCESS_STATUSES.has(status.txStatus) ||
					PROCESSING_STATUSES.has(status.txStatus)
				) {
					results.push({
						name: '1sat-api',
						status: 'success',
						txidResults: [{ txid: status.txid || txid, status: 'success' }],
					})
				} else if (status.txStatus === 'REJECTED') {
					// Definitive verdict: the network validated and refused this tx.
					// An unflagged error aggregates to invalidTx, failing the tx.
					results.push({
						name: '1sat-api',
						status: 'error',
						error: new WalletError(
							status.txStatus,
							status.extraInfo || `Broadcast rejected: ${status.txStatus}`,
						),
						txidResults: [{ txid, status: 'error', data: status }],
					})
				} else if (status.txStatus === 'DOUBLE_SPEND_ATTEMPTED') {
					// doubleSpend routes into the monitor's double-spend review,
					// which re-checks the chain and unfails false positives.
					results.push({
						name: '1sat-api',
						status: 'error',
						error: new WalletError(
							status.txStatus,
							status.extraInfo || `Broadcast failed: ${status.txStatus}`,
						),
						txidResults: [
							{
								txid,
								status: 'error',
								doubleSpend: true,
								competingTxs: status.competingTxs,
								data: status,
							},
						],
					})
				} else {
					// No final accepted/rejected verdict (broadcast window timed out,
					// SEEN_IN_ORPHAN_MEMPOOL, empty/unknown status). serviceError keeps
					// the req in 'sending' for retry instead of failing a tx that may
					// still be accepted.
					results.push({
						name: '1sat-api',
						status: 'error',
						error: new WalletError(
							status.txStatus || 'UNKNOWN',
							status.extraInfo || `No broadcast verdict: ${status.txStatus}`,
						),
						txidResults: [
							{ txid, status: 'error', serviceError: true, data: status },
						],
					})
				}
			} catch (error) {
				console.error('[OneSatServices] postBeef error:', error)
				// The service was unreachable or errored — says nothing about the
				// validity of the tx, so retry rather than fail it.
				results.push({
					name: '1sat-api',
					status: 'error',
					error: new WalletError(
						'NETWORK_ERROR',
						error instanceof Error ? error.message : 'Unknown error',
					),
					txidResults: [{ txid, status: 'error', serviceError: true }],
				})
			}
		}

		return results
	}

	async getBeefForTxid(txid: string): Promise<Beef> {
		const beefBytes = await this.beef.getBeef(txid)
		return Beef.fromBinary(Array.from(beefBytes))
	}

	hashOutputScript(script: string): string {
		const scriptBin = Utils.toArray(script, 'hex')
		return Utils.toHex(Hash.hash256(scriptBin).reverse())
	}

	getServicesCallHistory(_reset?: boolean): ServicesCallHistory {
		const emptyHistory: ServiceCallHistory = {
			serviceName: '',
			historyByProvider: {},
		}

		return {
			version: 1,
			getMerklePath: { ...emptyHistory, serviceName: 'getMerklePath' },
			getRawTx: { ...emptyHistory, serviceName: 'getRawTx' },
			postBeef: { ...emptyHistory, serviceName: 'postBeef' },
			getUtxoStatus: { ...emptyHistory, serviceName: 'getUtxoStatus' },
			getStatusForTxids: {
				...emptyHistory,
				serviceName: 'getStatusForTxids',
			},
			getScriptHashHistory: {
				...emptyHistory,
				serviceName: 'getScriptHashHistory',
			},
			updateFiatExchangeRates: {
				...emptyHistory,
				serviceName: 'updateFiatExchangeRates',
			},
		}
	}

	// ===== WalletServices Interface (Delegated to fallback) =====

	async getBsvExchangeRate(): Promise<number> {
		if (!this.fallbackServices) {
			throw new Error('getBsvExchangeRate not implemented')
		}
		return this.fallbackServices.getBsvExchangeRate()
	}

	async getFiatExchangeRate(
		currency: toolboxSdk.FiatCurrencyCode,
		base?: toolboxSdk.FiatCurrencyCode,
	): Promise<number> {
		if (!this.fallbackServices) {
			throw new Error('getFiatExchangeRate not implemented')
		}
		return this.fallbackServices.getFiatExchangeRate(currency, base)
	}

	async getStatusForTxids(
		txids: string[],
		_useNext?: boolean,
	): Promise<GetStatusForTxidsResult> {
		const results: StatusForTxidResult[] = []
		let currentHeight: number | undefined

		for (const txid of txids) {
			try {
				// Try 1sat-stack first (only knows about txs broadcast through it
				// or that arcade has visibility on under the stack's callback token).
				const status = await this.getStackStatus(txid)
				if (!status) {
					results.push(await this.getStatusFromBeef(txid))
					continue
				}

				if (status.txStatus === 'MINED' || status.txStatus === 'IMMUTABLE') {
					if (currentHeight === undefined) {
						currentHeight = await this.getHeight()
					}
					const depth = status.blockHeight
						? currentHeight - status.blockHeight + 1
						: 1
					results.push({ txid, status: 'mined', depth })
				} else if (
					status.txStatus === 'SEEN_ON_NETWORK' ||
					status.txStatus === 'SEEN_MULTIPLE_NODES' ||
					status.txStatus === 'ACCEPTED_BY_NETWORK' ||
					status.txStatus === 'SENT_TO_NETWORK' ||
					status.txStatus === 'RECEIVED'
				) {
					results.push({ txid, status: 'known', depth: 0 })
				} else {
					// REJECTED, DOUBLE_SPEND_ATTEMPTED, UNKNOWN - fall back to Beef
					results.push(await this.getStatusFromBeef(txid))
				}
			} catch {
				// Network or other error — fall back to Beef storage
				results.push(await this.getStatusFromBeef(txid))
			}
		}

		return {
			name: '1sat-api',
			status: 'success',
			results,
		}
	}

	/**
	 * Helper to get tx status from Beef storage (fallback when Arcade doesn't know the tx)
	 */
	private async getStatusFromBeef(txid: string): Promise<StatusForTxidResult> {
		try {
			const beefBytes = await this.beef.getBeef(txid)
			const tx = Transaction.fromBEEF(Array.from(beefBytes))

			if (tx.merklePath) {
				// Has a valid merkle path = mined
				const currentHeight = await this.getHeight()
				const depth = currentHeight - tx.merklePath.blockHeight + 1
				return { txid, status: 'mined', depth }
			}
			// No merkle path = known but not yet mined
			return { txid, status: 'known', depth: 0 }
		} catch {
			// 404 or error from Beef = unknown
			return { txid, status: 'unknown', depth: undefined }
		}
	}

	async isUtxo(output: TableOutput): Promise<boolean> {
		const outpoint = `${output.txid}_${output.vout}`
		const spendTxid = await this.txo.getSpend(outpoint)
		return spendTxid === null
	}

	async getUtxoStatus(
		_output: string,
		_outputFormat?: GetUtxoStatusOutputFormat,
		outpoint?: string,
		_useNext?: boolean,
	): Promise<GetUtxoStatusResult> {
		// We ignore _output (script hash) since we look up directly by outpoint
		if (!outpoint) {
			return {
				name: '1sat-api',
				status: 'error',
				error: new WalletError(
					'INVALID_PARAMETER',
					'outpoint is required for getUtxoStatus',
				),
				details: [],
			}
		}

		try {
			const txo = await this.txo.get(outpoint, {
				sats: true,
				spend: true,
				block: true,
			})

			const isUtxo = !txo.spend
			const [txid, voutStr] = txo.outpoint.split('_')
			const vout = Number.parseInt(voutStr, 10)

			return {
				name: '1sat-api',
				status: 'success',
				isUtxo,
				details: isUtxo
					? [
							{
								txid,
								index: vout,
								satoshis: txo.satoshis,
								height: txo.blockHeight,
							},
						]
					: [],
			}
		} catch {
			// TXO not found - treat as not a UTXO
			return {
				name: '1sat-api',
				status: 'success',
				isUtxo: false,
				details: [],
			}
		}
	}

	async getScriptHashHistory(
		hash: string,
		useNext?: boolean,
		logger?: WalletLoggerInterface,
	): Promise<GetScriptHashHistoryResult> {
		if (!this.fallbackServices) {
			throw new Error('getScriptHashHistory not implemented')
		}
		return this.fallbackServices.getScriptHashHistory(hash, useNext, logger)
	}

	async hashToHeader(hash: string): Promise<BlockHeader> {
		const header = await this.chaintracks.findHeaderForBlockHash(hash)
		if (!header) {
			throw new Error(`Block header not found for hash: ${hash}`)
		}
		return header
	}

	async nLockTimeIsFinal(
		txOrLockTime: string | number[] | Transaction | number,
	): Promise<boolean> {
		const MAXINT = 0xffffffff
		const BLOCK_LIMIT = 500000000

		let nLockTime: number

		if (typeof txOrLockTime === 'number') {
			nLockTime = txOrLockTime
		} else {
			let tx: Transaction
			if (typeof txOrLockTime === 'string') {
				tx = Transaction.fromHex(txOrLockTime)
			} else if (Array.isArray(txOrLockTime)) {
				tx = Transaction.fromBinary(txOrLockTime)
			} else {
				tx = txOrLockTime
			}

			// If all inputs have max sequence, the transaction is final regardless of lockTime
			if (tx.inputs.every((i) => i.sequence === MAXINT)) {
				return true
			}
			nLockTime = tx.lockTime
		}

		// If lockTime >= BLOCK_LIMIT, it's a timestamp (seconds since epoch)
		if (nLockTime >= BLOCK_LIMIT) {
			const currentTime = Math.floor(Date.now() / 1000)
			return nLockTime < currentTime
		}

		// Otherwise, it's a block height
		const height = await this.getHeight()
		return nLockTime < height
	}
}
