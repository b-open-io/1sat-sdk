import {
	createWalletCore,
	DEFAULT_FEE_MODEL,
} from '@1sat/wallet'
import type { OneSatServices } from '@1sat/client'
import type { PrivateKey } from '@bsv/sdk'
import {
	Monitor,
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletStorageManager,
} from '@bsv/wallet-toolbox'
import type { Knex } from 'knex'
import { StorageBunSqlite } from './storage-bun-sqlite'

const DEFAULT_STORAGE_NAME = 'wallet'
const DEFAULT_FILENAME = './wallet.db'
const DEFAULT_KNEX_STORAGE: Knex.Config = {
	client: 'better-sqlite3',
	connection: { filename: DEFAULT_FILENAME },
	useNullAsDefault: true,
}

const isBun = typeof globalThis.Bun !== 'undefined'

export interface NodeWalletConfig {
	privateKey: PrivateKey | string
	chain: 'main' | 'test'
	feeModel?: { model: 'sat/kb'; value: number }
	activeRemote?: string
	backups?: string[]
	storageIdentityKey: string
	connectionTimeout?: number
	storage?: Knex.Config
	filename?: string
	onTransactionBroadcasted?: (txid: string) => void
	onTransactionProven?: (txid: string, blockHeight: number) => void
}

export interface NodeWalletResult {
	wallet: Wallet
	services: OneSatServices
	monitor?: Monitor
	destroy: () => Promise<void>
	storage: WalletStorageManager
	remoteStorage?: StorageClient
	migrateRemote: (url: string) => Promise<void>
}

export async function createNodeWallet(
	config: NodeWalletConfig,
): Promise<NodeWalletResult> {
	const feeModel = config.feeModel ?? DEFAULT_FEE_MODEL

	const storageOptions = StorageProvider.createStorageBaseOptions(config.chain)
	storageOptions.feeModel = feeModel

	let localStorage: StorageProvider
	let knexInstance: Knex | undefined

	if (isBun) {
		localStorage = new StorageBunSqlite({
			...storageOptions,
			filename: config.filename ?? DEFAULT_FILENAME,
		})
	} else {
		const [{ StorageKnex }, { knex: makeKnex }] = await Promise.all([
			import('@bsv/wallet-toolbox'),
			import('knex'),
		])
		const knexConfig = config.storage ?? {
			...DEFAULT_KNEX_STORAGE,
			connection: { filename: config.filename ?? DEFAULT_FILENAME },
		}
		knexInstance = makeKnex(knexConfig)
		localStorage = new StorageKnex({ ...storageOptions, knex: knexInstance })
	}

	await localStorage.migrate(DEFAULT_STORAGE_NAME, config.storageIdentityKey)

	const core = await createWalletCore(config, localStorage, {
		Services,
		StorageClient,
		StorageProvider,
		Wallet,
		WalletStorageManager,
		Monitor,
	})

	let monitor: Monitor | undefined
	if (!config.activeRemote) {
		monitor = new Monitor({
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
	}

	const destroy = async (): Promise<void> => {
		if (monitor) {
			monitor.stopTasks()
			await new Promise((r) => setTimeout(r, 100))
			await monitor.destroy()
		}
		await core.destroy()
		if (knexInstance) await knexInstance.destroy()
	}

	return {
		wallet: core.wallet,
		services: core.services,
		monitor,
		destroy,
		storage: core.storage,
		remoteStorage: core.remoteClients[0],
		migrateRemote: core.migrateRemote,
	}
}
