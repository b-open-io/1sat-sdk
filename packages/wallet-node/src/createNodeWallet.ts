/**
 * Factory for creating node/server wallets.
 *
 * Analogous to createWebWallet but uses StorageKnex (SQLite or MySQL)
 * instead of StorageIdb (IndexedDB) for CLI, agent, and server use cases.
 */

import { OneSatServices } from '@1sat/client'
import { KeyDeriver, PrivateKey, type WalletInterface } from '@bsv/sdk'
import type { sdk as toolboxSdk } from '@bsv/wallet-toolbox'
import {
	Monitor,
	Services,
	StorageClient,
	StorageKnex,
	StorageProvider,
	Wallet,
	WalletStorageManager,
} from '@bsv/wallet-toolbox'
import { type Knex, knex as makeKnex } from 'knex'
import { type FullSyncResult, type FullSyncStage, fullSync } from './fullSync'

type Chain = 'main' | 'test'
type NodeWalletServices = toolboxSdk.WalletServices

const DEFAULT_STORAGE_NAME = 'wallet'
const DEFAULT_REMOTE_STORAGE_TIMEOUT = 5000
const DEFAULT_FEE_MODEL = { model: 'sat/kb' as const, value: 100 }
const DEFAULT_STORAGE: Knex.Config = {
	client: 'better-sqlite3',
	connection: { filename: './wallet.db' },
	useNullAsDefault: true,
}

/**
 * Configuration for creating a node wallet.
 */
export interface NodeWalletConfig {
	/** Private key - can be PrivateKey instance, WIF string, or hex string */
	privateKey: PrivateKey | string
	/** Network: 'main' or 'test' */
	chain: Chain
	/** Fee model. Default: { model: 'sat/kb', value: 100 } */
	feeModel?: { model: 'sat/kb'; value: number }
	/** Remote storage URL. If provided, attempts to connect for cloud backup. */
	remoteStorageUrl?: string
	/** Unique identifier for this storage instance. Must be persisted by the consuming application and reused across sessions. */
	storageIdentityKey: string
	/** Knex configuration for database connection. Default: SQLite at ./wallet.db */
	storage?: Knex.Config
	/** Callback when a transaction is broadcasted (called after remote sync if connected) */
	onTransactionBroadcasted?: (txid: string) => void
	/** Callback when a transaction is proven (called after remote sync if connected) */
	onTransactionProven?: (txid: string, blockHeight: number) => void
}

/**
 * Result of wallet creation.
 */
export interface NodeWalletResult {
	/** Wallet instance */
	wallet: Wallet
	/** 1Sat services for API access */
	services: OneSatServices
	/** Monitor for transaction lifecycle (not started - call monitor.startTasks() when ready) */
	monitor: Monitor
	/** Cleanup function - stops monitor, destroys wallet, closes database */
	destroy: () => Promise<void>
	/** Full sync with remote backup (only available if remoteStorageUrl was provided and connected) */
	fullSync?: (
		onProgress?: (stage: FullSyncStage, message: string) => void,
	) => Promise<FullSyncResult>
	/** Storage manager (for debugging/diagnostics) */
	storage: WalletStorageManager
	/** Remote storage client (for debugging/diagnostics, undefined if not connected) */
	remoteStorage?: StorageClient
}

/**
 * Parse a private key from various input formats.
 * Supports PrivateKey instance, WIF string, or hex string.
 */
function parsePrivateKey(input: PrivateKey | string): PrivateKey {
	if (input instanceof PrivateKey) {
		return input
	}

	// Try WIF first (starts with 5, K, L for mainnet or c for testnet)
	if (/^[5KLc][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(input)) {
		return PrivateKey.fromWif(input)
	}

	// Try hex (64 characters)
	if (/^[0-9a-fA-F]{64}$/.test(input)) {
		return new PrivateKey(input)
	}

	// Last resort - try WIF anyway
	try {
		return PrivateKey.fromWif(input)
	} catch {
		throw new Error(
			'Invalid private key format. Expected PrivateKey instance, WIF string, or 64-char hex string.',
		)
	}
}

/**
 * Create a node wallet with storage, services, and monitor.
 *
 * @example
 * ```typescript
 * // SQLite (default)
 * const { wallet, monitor, destroy } = await createNodeWallet({
 *   privateKey: 'L1...',
 *   chain: 'main',
 *   storageIdentityKey: 'my-cli-agent',
 * });
 *
 * // MySQL
 * const { wallet, monitor, destroy } = await createNodeWallet({
 *   privateKey: 'L1...',
 *   chain: 'main',
 *   storageIdentityKey: 'my-server',
 *   storage: {
 *     client: 'mysql2',
 *     connection: { host: '127.0.0.1', user: 'root', password: '...', database: 'wallet' },
 *     useNullAsDefault: true,
 *   },
 * });
 *
 * monitor.startTasks();
 *
 * // When done
 * await destroy();
 * ```
 */
export async function createNodeWallet(
	config: NodeWalletConfig,
): Promise<NodeWalletResult> {
	const { chain } = config
	const feeModel = config.feeModel ?? DEFAULT_FEE_MODEL

	// 1. Parse private key and create KeyDeriver
	const privateKey = parsePrivateKey(config.privateKey)
	const identityPubKey = privateKey.toPublicKey().toString()
	const keyDeriver = new KeyDeriver(privateKey)

	// 2. Create fallback services and OneSatServices
	const fallbackServices = new Services(chain)
	const oneSatServices = new OneSatServices(
		chain,
		undefined,
		fallbackServices as unknown as ConstructorParameters<
			typeof OneSatServices
		>[2],
	)

	// 3. Create Knex instance and local storage
	const knex = makeKnex(config.storage ?? DEFAULT_STORAGE)
	const storageOptions = StorageProvider.createStorageBaseOptions(chain)
	storageOptions.feeModel = feeModel
	const localStorage = new StorageKnex({ ...storageOptions, knex })
	await localStorage.migrate(DEFAULT_STORAGE_NAME, config.storageIdentityKey)

	// 4. Create storage manager with local-only storage initially
	const storage = new WalletStorageManager(identityPubKey, localStorage, [])
	await storage.makeAvailable()

	// 5. Create wallet
	const wallet = new Wallet({
		chain,
		keyDeriver,
		storage,
		services: oneSatServices as unknown as NodeWalletServices,
	})

	// 6. Attempt remote storage connection
	let remoteClient: StorageClient | undefined
	if (config.remoteStorageUrl) {
		console.log(
			`[createNodeWallet] Attempting remote storage connection to ${config.remoteStorageUrl}`,
		)
		try {
			remoteClient = new StorageClient(
				wallet as unknown as WalletInterface,
				config.remoteStorageUrl,
			)
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error('Remote storage connection timeout')),
					DEFAULT_REMOTE_STORAGE_TIMEOUT,
				),
			)
			await Promise.race([remoteClient.makeAvailable(), timeoutPromise])

			await storage.addWalletStorageProvider(remoteClient)

			const remoteStorageKey = remoteClient.getSettings().storageIdentityKey
			const isActive = storage.getBackupStores().includes(remoteStorageKey)

			if (isActive) {
				console.log(
					'[createNodeWallet] Remote backup connected (we are active)',
				)
			} else {
				console.log(
					'[createNodeWallet] Another device is active, performing full sync...',
				)

				await fullSync({
					storage,
					remoteStorage: remoteClient,
					identityKey: identityPubKey,
					onProgress: (stage, msg) =>
						console.log(`[createNodeWallet] fullSync ${stage}: ${msg}`),
				})

				await storage.setActive(config.storageIdentityKey, (msg) => {
					console.log('[createNodeWallet] setActive:', msg)
					return msg
				})

				console.log(
					'[createNodeWallet] Remote backup connected (now active after handoff)',
				)
			}
		} catch (err) {
			console.log(
				'[createNodeWallet] Remote backup connection failed:',
				err instanceof Error ? err.message : err,
			)
			remoteClient = undefined
		}
	}

	// 7. Helper to sync to remote backup
	const syncToBackup = async (context: string): Promise<void> => {
		if (storage.getBackupStores().length > 0) {
			await storage.updateBackups(undefined, (msg: string) => {
				console.log(`[createNodeWallet] ${context}:`, msg)
				return msg
			})
		}
	}

	// 8. Intercept createAction/signAction to sync after immediate broadcasts
	if (remoteClient) {
		const originalCreateAction = wallet.createAction.bind(wallet)
		wallet.createAction = async (args) => {
			const result = await originalCreateAction(args)
			if (result.txid) {
				console.log(
					'[createNodeWallet] Broadcast detected in createAction:',
					result.txid,
				)
				syncToBackup('Backup after createAction').catch((err) => {
					console.warn(
						'[createNodeWallet] Failed to sync after createAction:',
						err,
					)
				})
			}
			return result
		}

		const originalSignAction = wallet.signAction.bind(wallet)
		wallet.signAction = async (args) => {
			const result = await originalSignAction(args)
			if (result.txid) {
				console.log(
					'[createNodeWallet] Broadcast detected in signAction:',
					result.txid,
				)
				syncToBackup('Backup after signAction').catch((err) => {
					console.warn(
						'[createNodeWallet] Failed to sync after signAction:',
						err,
					)
				})
			}
			return result
		}
	}

	// 9. Create monitor (not started - consumer calls startTasks() when ready)
	const monitor = new Monitor({
		chain,
		services: oneSatServices as unknown as typeof fallbackServices,
		storage,
		chaintracks: oneSatServices.chaintracks,
		msecsWaitPerMerkleProofServiceReq: 500,
		taskRunWaitMsecs: 5000,
		abandonedMsecs: 300000,
		unprovenAttemptsLimitTest: 10,
		unprovenAttemptsLimitMain: 144,
	})
	monitor.addDefaultTasks()
	console.log(
		'[createNodeWallet] Monitor created with tasks:',
		monitor._tasks.map((t: { name: string }) => t.name),
	)

	// 10. Wire up monitor callbacks
	monitor.onTransactionBroadcasted = async (result) => {
		console.log('[createNodeWallet] Monitor detected broadcast:', result.txid)

		if (remoteClient) {
			try {
				await syncToBackup('Backup after monitor broadcast')
				console.log(
					'[createNodeWallet] Synced to backup after monitor broadcast',
				)
			} catch (err) {
				console.warn(
					'[createNodeWallet] Failed to sync after monitor broadcast:',
					err,
				)
			}
		}

		if (result.txid && config.onTransactionBroadcasted) {
			try {
				config.onTransactionBroadcasted(result.txid)
			} catch (err) {
				console.warn(
					'[createNodeWallet] User callback error after broadcast:',
					err,
				)
			}
		}
	}

	monitor.onTransactionProven = async (status) => {
		console.log(
			'[createNodeWallet] Transaction proven:',
			status.txid,
			'block',
			status.blockHeight,
		)

		if (remoteClient) {
			try {
				await syncToBackup('Backup after confirmation')
				console.log('[createNodeWallet] Synced to backup after confirmation')
			} catch (err) {
				console.warn(
					'[createNodeWallet] Failed to sync after confirmation:',
					err,
				)
			}
		}

		if (config.onTransactionProven) {
			try {
				config.onTransactionProven(status.txid, status.blockHeight)
			} catch (err) {
				console.warn(
					'[createNodeWallet] User callback error after proven:',
					err,
				)
			}
		}
	}

	// 11. Create cleanup function
	const destroy = async (): Promise<void> => {
		monitor.stopTasks()
		await monitor.destroy()
		await wallet.destroy()
		await knex.destroy()
	}

	// 12. Create fullSync function if remote storage is connected
	const fullSyncFn = remoteClient
		? async (
				onProgress?: (stage: FullSyncStage, message: string) => void,
			): Promise<FullSyncResult> => {
				return fullSync({
					storage,
					remoteStorage: remoteClient,
					identityKey: identityPubKey,
					onProgress,
				})
			}
		: undefined

	return {
		wallet,
		services: oneSatServices,
		monitor,
		destroy,
		fullSync: fullSyncFn,
		storage,
		remoteStorage: remoteClient,
	}
}
