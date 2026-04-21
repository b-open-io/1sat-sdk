import type { OneSatServices } from '@1sat/client'
import { DEFAULT_FEE_MODEL, createWalletCore } from '@1sat/wallet'
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
import { StorageBunSqlite } from './storage-bun-sqlite'

const DEFAULT_STORAGE_NAME = 'wallet'
const DEFAULT_FILENAME = './wallet.db'

export interface NodeWalletConfig {
	privateKey: PrivateKey | string
	chain: 'main' | 'test'
	feeModel?: { model: 'sat/kb'; value: number }
	activeRemote?: string
	backups?: string[]
	storageIdentityKey: string
	connectionTimeout?: number
	filename?: string
	onTransactionBroadcasted?: (txid: string) => void
	onTransactionProven?: (txid: string, blockHeight: number) => void
	/**
	 * Skip the initial `monitor.runOnce()` that fires when local storage is
	 * active. Set to true when a separate monitor process (e.g. `1sat serve`)
	 * is already running against the same storage.
	 */
	skipInitialMonitor?: boolean
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

	const localStorage = new StorageBunSqlite({
		...storageOptions,
		filename: config.filename ?? DEFAULT_FILENAME,
	})

	await localStorage.migrate(DEFAULT_STORAGE_NAME, config.storageIdentityKey)

	const core = await createWalletCore(config, localStorage, {
		Services,
		StorageClient,
		StorageProvider,
		Wallet,
		WalletStorageManager,
		Monitor,
	})

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
