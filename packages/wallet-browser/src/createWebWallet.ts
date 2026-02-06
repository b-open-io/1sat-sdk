/**
 * Factory for creating web wallets.
 *
 * This consolidates the common wallet setup used by both yours-wallet
 * (browser extension) and 1sat-website (React app).
 */

import { OneSatServices } from '@1sat/client'
import { KeyDeriver, PrivateKey, type WalletInterface } from '@bsv/sdk'
import type { sdk as mobileSdk } from '@bsv/wallet-toolbox-mobile'
import {
	Monitor,
	Services,
	StorageClient,
	StorageIdb,
	StorageProvider,
	Wallet,
	WalletStorageManager,
} from '@bsv/wallet-toolbox-mobile/out/src/index.client.js'
import { type FullSyncResult, type FullSyncStage, fullSync } from './fullSync'
import type { MonitorEvent } from './types'

type Chain = 'main' | 'test'
type MobileWalletServices = mobileSdk.WalletServices

// Default database name for IndexedDB storage
const DEFAULT_DATABASE_NAME = 'wallet'

// Default timeout for remote storage connection
const DEFAULT_REMOTE_STORAGE_TIMEOUT = 5000

// Default fee model (100 sat/kb matches yours-wallet and 1sat-indexer minimum)
const DEFAULT_FEE_MODEL = { model: 'sat/kb' as const, value: 100 }

/**
 * Configuration for creating a web wallet.
 */
export interface WebWalletConfig {
	/** Private key - can be PrivateKey instance, WIF string, or hex string */
	privateKey: PrivateKey | string
	/** Network: 'main' or 'test' */
	chain: Chain
	/** Fee model. Default: { model: 'sat/kb', value: 100 } */
	feeModel?: { model: 'sat/kb'; value: number }
	/** Remote storage URL. If provided, attempts to connect for cloud backup. */
	remoteStorageUrl?: string
	/** Unique identifier for this storage instance. Must be persisted by the consuming application and reused across sessions. Different devices should use different values to isolate sync state. */
	storageIdentityKey: string
	/** Callback when a transaction is broadcasted (called after remote sync if connected) */
	onTransactionBroadcasted?: (txid: string) => void
	/** Callback when a transaction is proven (called after remote sync if connected) */
	onTransactionProven?: (txid: string, blockHeight: number) => void
	/** Typed monitor event callback for structured lifecycle events */
	onMonitorEvent?: (event: MonitorEvent) => void
}

/**
 * Result of wallet creation.
 */
export interface WebWalletResult {
	/** Wallet instance */
	wallet: Wallet
	/** 1Sat services for API access */
	services: OneSatServices
	/** Monitor for transaction lifecycle (not started - call monitor.startTasks() when ready) */
	monitor: Monitor
	/** Cleanup function - stops monitor, destroys wallet */
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
 * Create a web wallet with storage, services, and monitor.
 *
 * @example
 * ```typescript
 * const { wallet, services, monitor, destroy } = await createWebWallet({
 *   privateKey: identityWif,
 *   chain: 'main',
 *   storageIdentityKey: 'device-unique-id',
 * });
 *
 * // Wire up monitor callbacks
 * monitor.onTransactionProven = async (status) => console.log('Proven:', status.txid);
 *
 * // Start monitor when ready
 * monitor.startTasks();
 * ```
 */
export async function createWebWallet(
	config: WebWalletConfig,
): Promise<WebWalletResult> {
	const { chain, onMonitorEvent } = config
	const feeModel = config.feeModel ?? DEFAULT_FEE_MODEL
	const emit = (event: MonitorEvent) => {
		try {
			onMonitorEvent?.(event)
		} catch {
			// Never let event handler errors crash wallet operations
		}
	}

	// 1. Parse private key and create KeyDeriver
	const privateKey = parsePrivateKey(config.privateKey)
	const identityPubKey = privateKey.toPublicKey().toString()
	const keyDeriver = new KeyDeriver(privateKey)

	// 2. Create fallback services and OneSatServices
	const fallbackServices = new Services(chain)
	const oneSatServices = new OneSatServices(chain, undefined, fallbackServices)

	// 3. Create local storage
	const storageOptions = StorageProvider.createStorageBaseOptions(chain)
	storageOptions.feeModel = feeModel
	const localStorage = new StorageIdb(storageOptions)
	await localStorage.migrate(DEFAULT_DATABASE_NAME, config.storageIdentityKey)

	// 4. Create storage manager with local-only storage initially (empty backups)
	const storage = new WalletStorageManager(identityPubKey, localStorage, [])
	await storage.makeAvailable()

	// 5. Create wallet (needed before StorageClient for signing)
	const wallet = new Wallet({
		chain,
		keyDeriver,
		storage,
		services: oneSatServices as MobileWalletServices,
	})

	// 6. Attempt remote storage connection AFTER wallet exists
	// Push-only backup: no sync on startup, just connect for incremental backups
	// Use fullSync() explicitly to restore from backup when needed
	let remoteClient: StorageClient | undefined
	if (config.remoteStorageUrl) {
		console.log(
			`[createWebWallet] Attempting remote storage connection to ${config.remoteStorageUrl}`,
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

			// Add remote to storage manager - it will partition as conflicting if another device is active
			await storage.addWalletStorageProvider(remoteClient)

			// Check if remote ended up in backup stores (active) or got partitioned (conflicting)
			const remoteStorageKey = remoteClient.getSettings().storageIdentityKey
			const isActive = storage.getBackupStores().includes(remoteStorageKey)

			if (isActive) {
				console.log('[createWebWallet] Remote backup connected (we are active)')
			} else {
				// Another device is active - need fullSync then setActive
				// fullSync builds ID mappings before setActive attempts to merge
				console.log(
					'[createWebWallet] Another device is active, performing full sync...',
				)

				await fullSync({
					storage,
					remoteStorage: remoteClient,
					identityKey: identityPubKey,
					onProgress: (stage, msg) => {
						console.log(`[createWebWallet] fullSync ${stage}: ${msg}`)
						emit({ type: 'sync:progress', stage, message: msg })
					},
				})

				// Claim active status (merge now works because mappings exist from fullSync)
				await storage.setActive(config.storageIdentityKey, (msg) => {
					console.log('[createWebWallet] setActive:', msg)
					return msg
				})

				console.log(
					'[createWebWallet] Remote backup connected (now active after handoff)',
				)
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			console.log('[createWebWallet] Remote backup connection failed:', msg)
			emit({ type: 'error', source: 'remote-storage', message: msg })
			remoteClient = undefined
		}
	}

	// Helper to sync to remote backup using public updateBackups API
	const syncToBackup = async (context: string): Promise<void> => {
		if (storage.getBackupStores().length > 0) {
			await storage.updateBackups(undefined, (msg: string) => {
				console.log(`[createWebWallet] ${context}:`, msg)
				emit({ type: 'sync:backup', message: `${context}: ${msg}` })
				return msg
			})
		}
	}

	// 8. Intercept createAction/signAction to sync after immediate broadcasts
	// With acceptDelayedBroadcast: false, broadcasts happen synchronously and
	// bypass the monitor's onTransactionBroadcasted callback. We detect broadcasts
	// by checking for txid in the result and sync to backup immediately.
	if (remoteClient) {
		const originalCreateAction = wallet.createAction.bind(wallet)
		wallet.createAction = async (args) => {
			const result = await originalCreateAction(args)
			if (result.txid) {
				console.log(
					'[createWebWallet] Broadcast detected in createAction:',
					result.txid,
				)
				syncToBackup('Backup after createAction').catch((err) => {
					console.warn(
						'[createWebWallet] Failed to sync after createAction:',
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
					'[createWebWallet] Broadcast detected in signAction:',
					result.txid,
				)
				syncToBackup('Backup after signAction').catch((err) => {
					console.warn(
						'[createWebWallet] Failed to sync after signAction:',
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
		'[createWebWallet] Monitor created with tasks:',
		monitor._tasks.map((t: { name: string }) => t.name),
	)

	// 11. Wire up monitor callbacks - sync to remote first, then call user callbacks
	// Note: For delayed broadcasts, the monitor triggers these. For immediate broadcasts,
	// the interception in step 8 handles the sync, but these still fire for the user callback.
	monitor.onTransactionBroadcasted = async (result) => {
		console.log('[createWebWallet] Monitor detected broadcast:', result.txid)
		emit({ type: 'broadcast', txid: result.txid, status: 'success' })

		// Sync to remote backup first (if connected)
		// Note: For immediate broadcasts, step 8 already synced, but this is harmless
		if (remoteClient) {
			try {
				await syncToBackup('Backup after monitor broadcast')
				console.log(
					'[createWebWallet] Synced to backup after monitor broadcast',
				)
			} catch (err) {
				console.warn(
					'[createWebWallet] Failed to sync after monitor broadcast:',
					err,
				)
			}
		}

		// Then call user callback (if provided)
		if (result.txid && config.onTransactionBroadcasted) {
			try {
				config.onTransactionBroadcasted(result.txid)
			} catch (err) {
				console.warn(
					'[createWebWallet] User callback error after broadcast:',
					err,
				)
			}
		}
	}

	monitor.onTransactionProven = async (status) => {
		console.log(
			'[createWebWallet] Transaction proven:',
			status.txid,
			'block',
			status.blockHeight,
		)
		emit({
			type: 'proven',
			txid: status.txid,
			blockHeight: status.blockHeight,
			blockHash: status.blockHash ?? '',
		})

		// Sync to remote backup first (if connected)
		if (remoteClient) {
			try {
				await syncToBackup('Backup after confirmation')
				console.log('[createWebWallet] Synced to backup after confirmation')
			} catch (err) {
				console.warn(
					'[createWebWallet] Failed to sync after confirmation:',
					err,
				)
			}
		}

		// Then call user callback (if provided)
		if (config.onTransactionProven) {
			try {
				config.onTransactionProven(status.txid, status.blockHeight)
			} catch (err) {
				console.warn('[createWebWallet] User callback error after proven:', err)
			}
		}
	}

	// 12. Create cleanup function
	const destroy = async (): Promise<void> => {
		monitor.stopTasks()
		await monitor.destroy()
		await wallet.destroy()
	}

	// 13. Create fullSync function if remote storage is connected
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
