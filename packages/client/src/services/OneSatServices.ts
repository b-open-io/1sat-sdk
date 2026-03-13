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
import type { TableOutput, sdk as toolboxSdk } from '@bsv/wallet-toolbox'
import { WalletError } from '@bsv/wallet-toolbox/out/src/sdk/WalletError.js'
import {
	AdminClient,
	ArcadeClient,
	BeefClient,
	Bsv21Client,
	ChaintracksClient,
	MarketClient,
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
 * - /1sat/arcade/* - Transaction broadcasting
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
	readonly chaintracks: ChaintracksClient
	readonly beef: BeefClient
	readonly arcade: ArcadeClient
	readonly txo: TxoClient
	readonly owner: OwnerClient
	readonly ordfs: OrdfsClient
	readonly bsv21: Bsv21Client
	readonly market: MarketClient
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
		this.chaintracks = new ChaintracksClient(this.baseUrl, opts)
		this.beef = new BeefClient(this.baseUrl, opts)
		this.arcade = new ArcadeClient(this.baseUrl, opts)
		this.txo = new TxoClient(this.baseUrl, opts)
		this.owner = new OwnerClient(this.baseUrl, opts)
		this.ordfs = new OrdfsClient(this.baseUrl, opts)
		this.bsv21 = new Bsv21Client(this.baseUrl, opts)
		this.market = new MarketClient(this.baseUrl, opts)
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
				// Submit as AtomicBEEF which includes all source transactions
				console.log('[OneSatServices] Submitting tx to arcade:', txid)
				const atomicBeef = beef.toBinaryAtomic(txid)
				console.log(
					'[OneSatServices] AtomicBEEF length:',
					atomicBeef.length,
					'bytes',
				)
				// Parse back to verify structure
				const verifyBeef = Beef.fromBinary(atomicBeef)
				console.log(
					`[OneSatServices] AtomicBEEF parsed back:\n${verifyBeef.toLogString()}`,
				)
				// TODO: Remove hardcoded callback headers after server testing
				const status = await this.arcade.submitTransaction(atomicBeef, {
					callbackUrl: `${this.baseUrl}/1sat/arc/callback`,
					callbackToken: 'test-callback-token',
				})
				console.log('[OneSatServices] Arcade response:', status)

				if (
					status.txStatus === 'MINED' ||
					status.txStatus === 'SEEN_ON_NETWORK' ||
					status.txStatus === 'ACCEPTED_BY_NETWORK'
				) {
					results.push({
						name: '1sat-api',
						status: 'success',
						txidResults: [{ txid: status.txid || txid, status: 'success' }],
					})
				} else if (
					status.txStatus === 'REJECTED' ||
					status.txStatus === 'DOUBLE_SPEND_ATTEMPTED'
				) {
					results.push({
						name: '1sat-api',
						status: 'error',
						error: new WalletError(
							status.txStatus,
							status.extraInfo || 'Transaction rejected',
						),
						txidResults: [{ txid, status: 'error', data: status }],
					})
				} else {
					// Still processing - report as success since tx was accepted
					results.push({
						name: '1sat-api',
						status: 'success',
						txidResults: [{ txid: status.txid || txid, status: 'success' }],
					})
				}
			} catch (error) {
				console.error('[OneSatServices] postBeef error:', error)
				results.push({
					name: '1sat-api',
					status: 'error',
					error: new WalletError(
						'NETWORK_ERROR',
						error instanceof Error ? error.message : 'Unknown error',
					),
					txidResults: [{ txid, status: 'error' }],
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
		currency: 'USD' | 'GBP' | 'EUR',
		base?: 'USD' | 'GBP' | 'EUR',
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
				// Try Arcade first (only knows about txs broadcast through it)
				const status = await this.arcade.getStatus(txid)

				if (status.txStatus === 'MINED' || status.txStatus === 'IMMUTABLE') {
					// Get current height for depth calculation if we haven't already
					if (currentHeight === undefined) {
						currentHeight = await this.getHeight()
					}
					const depth = status.blockHeight
						? currentHeight - status.blockHeight + 1
						: 1
					results.push({ txid, status: 'mined', depth })
				} else if (
					status.txStatus === 'SEEN_ON_NETWORK' ||
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
				// Arcade 404 or error - fall back to Beef storage
				// NOTE: If Arcade's scope is too limited (only knows txs it broadcast),
				// consider using Beef storage as the primary source instead.
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
