import type { OneSatServices } from '@1sat/client'
import {
	DEFAULT_FEE_MODEL,
	type TaskStateStore,
	createWalletCore,
} from '@1sat/wallet'
import type { PrivateKey } from '@bsv/sdk'
import {
	Monitor,
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletStorageManager,
	type sdk,
} from '@bsv/wallet-toolbox'
import { createFsTaskStateStore } from './fsTaskStateStore'
import { StorageBunSqlite } from './storage-bun-sqlite'

const DEFAULT_STORAGE_NAME = 'wallet'
const DEFAULT_SQLITE_FILENAME = './wallet.db'

export interface BunSqliteStorageConfig {
	provider: 'bun-sqlite'
	filename?: string
}

export interface PgStorageConfig {
	provider: 'pg'
	/** Postgres connection URL — e.g. `postgres://user:pass@host/db`. */
	dbUrl: string
	/** Optional pool size override. */
	pool?: { min?: number; max?: number }
}

export type NodeWalletStorageConfig = BunSqliteStorageConfig | PgStorageConfig

export interface NodeWalletConfig {
	privateKey: PrivateKey | string
	chain: 'main' | 'test'
	feeModel?: { model: 'sat/kb'; value: number }
	activeRemote?: string
	backups?: string[]
	storageIdentityKey: string
	connectionTimeout?: number
	/**
	 * Local storage backend. Defaults to bun-sqlite with `./wallet.db`.
	 */
	storage?: NodeWalletStorageConfig
	onTransactionBroadcasted?: (txid: string) => void
	onTransactionProven?: (txid: string, blockHeight: number) => void
	/**
	 * Skip the initial `monitor.runOnce()` that fires when local storage is
	 * active. Set to true when a separate monitor process (e.g. `1sat serve`)
	 * is already running against the same storage.
	 */
	skipInitialMonitor?: boolean
	/**
	 * Persistent store for Monitor task `lastRunMsecsSinceEpoch`. Defaults
	 * to a JSON sidecar next to the bun-sqlite file when storage is
	 * bun-sqlite and no store is supplied. For Postgres storage, no default
	 * is constructed; pass one explicitly if cross-process throttle
	 * persistence is wanted.
	 */
	taskStateStore?: TaskStateStore
}

export interface NodeWalletResult {
	wallet: Wallet
	services: OneSatServices
	monitor: Monitor
	destroy: () => Promise<void>
	storage: WalletStorageManager
	remoteStorage?: StorageClient
	setActiveStorage: (target: 'local' | string) => Promise<void>
	addRemote: (url: string) => Promise<void>
	/**
	 * Live getter for the currently active raw storage provider. Use this
	 * (not `storage`) when wiring the wallet-server RPC — the manager is
	 * single-tenant, the provider is multi-tenant.
	 */
	getActiveStorage: () => sdk.WalletStorageProvider
}

export async function createNodeWallet(
	config: NodeWalletConfig,
): Promise<NodeWalletResult> {
	const feeModel = config.feeModel ?? DEFAULT_FEE_MODEL

	const storageOptions = StorageProvider.createStorageBaseOptions(config.chain)
	storageOptions.feeModel = feeModel

	const storageConfig: NodeWalletStorageConfig = config.storage ?? {
		provider: 'bun-sqlite',
	}
	const localStorage = await buildLocalStorage(storageConfig, storageOptions)

	await localStorage.migrate(DEFAULT_STORAGE_NAME, config.storageIdentityKey)

	const taskStateStore =
		config.taskStateStore ??
		(storageConfig.provider === 'bun-sqlite'
			? createFsTaskStateStore(
					`${storageConfig.filename ?? DEFAULT_SQLITE_FILENAME}.tasks.json`,
				)
			: undefined)

	const core = await createWalletCore(
		{ ...config, taskStateStore },
		localStorage,
		{
			Services,
			StorageClient,
			StorageProvider,
			Wallet,
			WalletStorageManager,
			Monitor,
		},
	)

	// Fire monitor.runOnce() on wake when local is active. The server runs
	// its own monitor when remote is active, so firing ours would duplicate
	// (and race with) its work. Tasks self-throttle internally via their
	// per-task intervals, so repeated runOnce calls during rapid activity
	// are cheap timestamp comparisons.
	let initialRunOnce: Promise<unknown> | undefined
	if (!config.activeRemote && !config.skipInitialMonitor) {
		initialRunOnce = core.monitor.runOnce().catch((err: unknown) => {
			console.error('[wallet-core] initial monitor run failed:', err)
		})
	}

	const destroy = async (): Promise<void> => {
		if (initialRunOnce) {
			try {
				await initialRunOnce
			} catch {}
		}
		await core.destroy()
	}

	return {
		wallet: core.wallet,
		services: core.services,
		monitor: core.monitor,
		destroy,
		storage: core.storage,
		remoteStorage: core.remoteClients[0],
		setActiveStorage: core.setActiveStorage,
		addRemote: core.addRemote,
		getActiveStorage: core.getActiveStorage,
	}
}

async function buildLocalStorage(
	config: NodeWalletStorageConfig,
	baseOptions: ReturnType<typeof StorageProvider.createStorageBaseOptions>,
): Promise<StorageProvider> {
	if (config.provider === 'bun-sqlite') {
		return new StorageBunSqlite({
			...baseOptions,
			filename: config.filename ?? DEFAULT_SQLITE_FILENAME,
		})
	}
	if (config.provider === 'pg') {
		// Dynamic import — pg is an optional peer dep so bun-sqlite-only
		// consumers don't pay for it.
		const { StoragePg } = await import('./storage-pg')
		return new StoragePg({
			...baseOptions,
			dbUrl: config.dbUrl,
			poolConfig: config.pool,
		})
	}
	// Exhaustiveness check
	const _exhaustive: never = config
	throw new Error(
		`unsupported storage provider: ${JSON.stringify(_exhaustive)}`,
	)
}
