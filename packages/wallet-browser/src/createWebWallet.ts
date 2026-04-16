import type { OneSatServices } from '@1sat/client'
import {
	DEFAULT_FEE_MODEL,
	type IPermissionStore,
	PermissionLedgerAdapter,
	type PermissionPromptHandler,
	createWalletCore,
} from '@1sat/wallet'
import type { PrivateKey, WalletInterface } from '@bsv/sdk'
import {
	Monitor,
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletStorageManager,
} from '@bsv/wallet-toolbox-mobile'
// Imported from the browser-safe `index.client.js` entry (same as StorageIdb).
// The default `@bsv/wallet-toolbox` entry re-exports from `index.all.js` which
// includes StorageServer + Express + knex — fine for Node, but it drags server
// code into any page-context consumer of `@1sat/wallet-browser`.
import {
	type PermissionsManagerConfig,
	StorageIdb,
	WalletPermissionsManager,
} from '@bsv/wallet-toolbox/out/src/index.client.js'
import { IndexedDbPermissionStore } from './permissions/indexed-db-store'
import type { MonitorEvent } from './types'

const DEFAULT_DATABASE_NAME = 'wallet'

/**
 * BRC-100 permission configuration for `createWebWallet`.
 *
 * When set, the returned wallet is wrapped with `WalletPermissionsManager`
 * and bound to a `PermissionLedgerAdapter`. Grants are stored in the
 * injected store (or an IndexedDB-backed default) instead of minting
 * on-chain PushDrop tokens.
 */
export interface WebWalletPermissionsOptions {
	/**
	 * Originator used by the wallet itself for internal calls (e.g.
	 * `chrome-extension://<id>`). WPM skips all permission checks for this
	 * originator.
	 */
	adminOriginator: string
	/** UI callbacks invoked when a grant is needed. */
	prompt: PermissionPromptHandler
	/**
	 * Persistent store for permission grants. Defaults to
	 * `IndexedDbPermissionStore`.
	 */
	permissionStore?: IPermissionStore
	/**
	 * Overrides spread on top of the manager's defaults. Only set fields
	 * you want to change.
	 */
	permissionsConfig?: Partial<PermissionsManagerConfig>
}

/**
 * Defaults used for `WalletPermissionsManager` when
 * `permissions.permissionsConfig` does not override a field.
 */
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
	 * When set, wraps the wallet with `WalletPermissionsManager` + a
	 * `PermissionLedgerAdapter` so grants persist to `permissionStore`
	 * (default: IndexedDB) instead of minting on-chain tokens.
	 */
	permissions?: WebWalletPermissionsOptions
}

export interface WebWalletResult {
	/**
	 * The active wallet. When `config.permissions` is set this is the
	 * permissioned `WalletInterface` (a `WalletPermissionsManager`). When
	 * unset, it is the unwrapped `Wallet`.
	 */
	wallet: WalletInterface
	/**
	 * The unwrapped base wallet. Present when `config.permissions` is set so
	 * callers can route internal operations around WPM. Omitted otherwise
	 * (the `wallet` field already holds the unwrapped instance).
	 */
	baseWallet?: Wallet
	/** Adapter bridging WPM to the permission store. Present iff `config.permissions` was set. */
	adapter?: PermissionLedgerAdapter
	services: OneSatServices
	monitor?: Monitor
	destroy: () => Promise<void>
	storage: WalletStorageManager
	remoteStorage?: StorageClient
	migrateRemote: (url: string) => Promise<void>
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
			config.permissions.permissionStore ??
			new IndexedDbPermissionStore({ scope: config.storageIdentityKey })
		adapter = new PermissionLedgerAdapter({
			wallet: manager,
			store,
			prompt: config.permissions.prompt,
		})
		wallet = manager
	}

	const destroy = async (): Promise<void> => {
		if (adapter) adapter.dispose()
		if (monitor) {
			monitor.stopTasks()
			await monitor.destroy()
		}
		await core.destroy()
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
