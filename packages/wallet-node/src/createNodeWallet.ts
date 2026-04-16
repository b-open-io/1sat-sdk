import type { OneSatServices } from '@1sat/client'
import {
	DEFAULT_FEE_MODEL,
	type IPermissionStore,
	InMemoryPermissionStore,
	PermissionLedgerAdapter,
	type PermissionPromptHandler,
	createWalletCore,
} from '@1sat/wallet'
import type { PrivateKey, WalletInterface } from '@bsv/sdk'
import {
	Monitor,
	type PermissionsManagerConfig,
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletPermissionsManager,
	WalletStorageManager,
} from '@bsv/wallet-toolbox'
import { StorageBunSqlite } from './storage-bun-sqlite'

const DEFAULT_STORAGE_NAME = 'wallet'
const DEFAULT_FILENAME = './wallet.db'

/**
 * BRC-100 permission configuration for `createNodeWallet`.
 *
 * In headless Node/server contexts the originator is typically hard-coded
 * (admin), in which case WPM skips all checks and `prompt` is never
 * invoked. Supply a throwing or auto-deny prompt handler if external
 * originators could reach the wallet.
 */
export interface NodeWalletPermissionsOptions {
	adminOriginator: string
	prompt: PermissionPromptHandler
	/** Defaults to `InMemoryPermissionStore`. Supply a persistent implementation for production. */
	permissionStore?: IPermissionStore
	permissionsConfig?: Partial<PermissionsManagerConfig>
}

/** See `@1sat/wallet-browser` for the field-by-field documentation. */
export const DEFAULT_PERMISSIONS_CONFIG: PermissionsManagerConfig = {
	seekProtocolPermissionsForSigning: true,
	seekProtocolPermissionsForEncrypting: true,
	seekProtocolPermissionsForHMAC: true,
	seekPermissionsForKeyLinkageRevelation: true,
	seekPermissionsForPublicKeyRevelation: false,
	seekPermissionsForIdentityKeyRevelation: true,
	seekPermissionsForIdentityResolution: true,
	seekBasketInsertionPermissions: true,
	seekBasketRemovalPermissions: true,
	seekBasketListingPermissions: false,
	seekPermissionWhenApplyingActionLabels: false,
	seekPermissionWhenListingActionsByLabel: false,
	seekCertificateDisclosurePermissions: true,
	seekCertificateAcquisitionPermissions: true,
	seekCertificateRelinquishmentPermissions: true,
	seekCertificateListingPermissions: false,
	encryptWalletMetadata: true,
	seekSpendingPermissions: true,
	seekGroupedPermission: true,
	differentiatePrivilegedOperations: true,
}

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
	 * When set, wraps the wallet with `WalletPermissionsManager` + a
	 * `PermissionLedgerAdapter`. Omit to get the unwrapped `Wallet` (callers
	 * can still wrap WPM themselves for the legacy on-chain grant flow).
	 */
	permissions?: NodeWalletPermissionsOptions
}

export interface NodeWalletResult {
	wallet: WalletInterface
	baseWallet?: Wallet
	adapter?: PermissionLedgerAdapter
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

	const baseWallet = core.wallet
	let wallet: WalletInterface = baseWallet
	let adapter: PermissionLedgerAdapter | undefined

	if (config.permissions) {
		const permissionsConfig: PermissionsManagerConfig = {
			...DEFAULT_PERMISSIONS_CONFIG,
			...(config.permissions.permissionsConfig ?? {}),
		}
		const manager = new WalletPermissionsManager(
			baseWallet,
			config.permissions.adminOriginator,
			permissionsConfig,
		)
		const store =
			config.permissions.permissionStore ?? new InMemoryPermissionStore()
		adapter = new PermissionLedgerAdapter({
			wallet: manager,
			store,
			prompt: config.permissions.prompt,
		})
		wallet = manager
	}

	const destroy = async (): Promise<void> => {
		try {
			if (adapter) adapter.dispose()
			if (monitor) {
				monitor.stopTasks()
				if (monitor._tasksRunningPromise) {
					await monitor._tasksRunningPromise
				}
				await monitor.destroy()
			}
		} catch {}
		try {
			await core.destroy()
		} catch {}
	}

	return {
		wallet,
		baseWallet: config.permissions ? baseWallet : undefined,
		adapter,
		services: core.services,
		monitor,
		destroy,
		storage: core.storage,
		remoteStorage: core.remoteClients[0],
		migrateRemote: core.migrateRemote,
	}
}
