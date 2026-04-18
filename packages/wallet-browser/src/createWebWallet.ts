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
} from '@bsv/wallet-toolbox-mobile'
import { StorageIdb } from '@bsv/wallet-toolbox/out/src/index.client.js'
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

	// Always construct the Monitor — it's cheap (just task registration) and
	// the active store can be flipped at runtime via setActiveStorage, so we
	// need a Monitor available regardless of the initial config.
	const monitor = new Monitor({
		chain: config.chain,
		services: core.services as any,
		storage: core.storage,
		chaintracks: core.services.chaintracks,
		msecsWaitPerMerkleProofServiceReq: 500,
		taskRunWaitMsecs: 5000,
		abandonedMsecs: 300000,
		unprovenAttemptsLimitTest: 10,
		unprovenAttemptsLimitMain: 144,
	})
	monitor.addDefaultTasks()

	if (config.onTransactionBroadcasted) {
		monitor.onTransactionBroadcasted = async (result) => {
			if (result.txid) config.onTransactionBroadcasted!(result.txid)
		}
	}
	if (config.onTransactionProven) {
		monitor.onTransactionProven = async (status) => {
			config.onTransactionProven!(status.txid, status.blockHeight)
		}
	}

	// Fire monitor.runOnce() on wake when local is active. The server runs
	// its own monitor when remote is active, so firing ours would duplicate
	// (and race with) its work. Tasks self-throttle internally via their
	// per-task intervals, so repeated runOnce calls during rapid activity
	// are cheap timestamp comparisons.
	if (!config.activeRemote) {
		monitor.runOnce().catch((err: unknown) => {
			console.error('[wallet-core] initial monitor run failed:', err)
		})
	}

	const destroy = async (): Promise<void> => {
		monitor.stopTasks()
		await monitor.destroy()
		await core.destroy()
	}

	return {
		wallet: core.wallet,
		services: core.services,
		monitor,
		destroy,
		storage: core.storage,
		remoteStorage: core.remoteClients[0],
		setActiveStorage: core.setActiveStorage,
		addRemote: core.addRemote,
	}
}
