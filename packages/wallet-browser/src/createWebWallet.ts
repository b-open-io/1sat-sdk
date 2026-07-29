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
} from '@bsv/wallet-toolbox-client'
import { StorageIdb } from '@bsv/wallet-toolbox-client/out/src/index.client.js'
import type { MonitorEvent } from './types'

const DEFAULT_DATABASE_NAME = 'wallet'

export interface WebWalletConfig {
	privateKey: PrivateKey | string
	chain: 'main' | 'test'
	feeModel?: { model: 'sat/kb'; value: number }
	activeRemote?: string
	backups?: string[]
	storageIdentityKey: string
	connectionTimeout?: number
	onTransactionBroadcasted?: (txid: string) => void
	onTransactionProven?: (txid: string, blockHeight: number) => void
	onMonitorEvent?: (event: MonitorEvent) => void
	/**
	 * Persistent store for Monitor task `lastRunMsecsSinceEpoch`. When
	 * provided, the factory hydrates each task's last-run timestamp on
	 * Monitor construction and snapshots back after every `runOnce`. In a
	 * service worker, this is what makes wakes within a task's interval
	 * effectively no-ops. Use `createIndexedDbTaskStateStore()` from
	 * `@1sat/wallet-browser` for the standard implementation.
	 */
	taskStateStore?: TaskStateStore
	/**
	 * Optional override for the OneSatServices base URL (where transaction
	 * broadcasts go). Defaults to ONESAT_MAINNET_URL / ONESAT_TESTNET_URL.
	 * Set this to point a browser build at a non-production 1sat-stack.
	 */
	servicesBaseUrl?: string
}

export interface WebWalletResult {
	wallet: Wallet
	services: OneSatServices
	monitor: Monitor
	destroy: () => Promise<void>
	storage: WalletStorageManager
	remoteStorage?: StorageClient
	setActiveStorage: (target: 'local' | string) => Promise<void>
	addRemote: (url: string) => Promise<void>
}

export async function createWebWallet(
	config: WebWalletConfig,
): Promise<WebWalletResult> {
	const feeModel = config.feeModel ?? DEFAULT_FEE_MODEL

	const storageOptions = StorageProvider.createStorageBaseOptions(config.chain)
	storageOptions.feeModel = feeModel
	const localStorage = new StorageIdb(storageOptions)
	await localStorage.migrate(DEFAULT_DATABASE_NAME, config.storageIdentityKey)

	const core = await createWalletCore(config, localStorage, {
		Services,
		StorageClient,
		StorageProvider,
		Wallet,
		WalletStorageManager,
		Monitor,
	})

	// One runOnce after create. Tasks self-throttle via per-task intervals
	// (BackupSync default 5m). Local-active runs full defaults + BackupSync;
	// remote-active is BackupSync-only (no chain-task duplication with server).
	if (core.monitor) {
		core.monitor.runOnce().catch((err: unknown) => {
			console.error('[wallet-core] initial monitor run failed:', err)
		})
	}

	return {
		wallet: core.wallet,
		services: core.services,
		monitor: core.monitor,
		destroy: core.destroy,
		storage: core.storage,
		remoteStorage: core.remoteClients[0],
		setActiveStorage: core.setActiveStorage,
		addRemote: core.addRemote,
	}
}
