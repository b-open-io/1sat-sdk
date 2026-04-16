import type { OneSatServices } from '@1sat/client'
import {
	type IPermissionStore,
	InMemoryPermissionStore,
	PermissionLedgerAdapter,
	type PermissionPromptHandler,
	createWalletCore,
} from '@1sat/wallet'
import type { PrivateKey, WalletInterface } from '@bsv/sdk'
import {
	type PermissionsManagerConfig,
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletPermissionsManager,
	WalletStorageManager,
} from '@bsv/wallet-toolbox/out/src/index.client.js'

/**
 * BRC-100 permission configuration for `createRemoteWallet`.
 *
 * Remote wallets typically serve a trusted admin originator only; `prompt`
 * is required but may be a throwing/auto-deny stub if no external
 * originator reaches the wallet.
 */
export interface RemoteWalletPermissionsOptions {
	adminOriginator: string
	prompt: PermissionPromptHandler
	/** Defaults to `InMemoryPermissionStore`. */
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

export interface RemoteWalletConfig {
	privateKey: PrivateKey | string
	chain: 'main' | 'test'
	feeModel?: { model: 'sat/kb'; value: number }
	activeRemote: string
	backups?: string[]
	connectionTimeout?: number
	/**
	 * When set, wraps the wallet with `WalletPermissionsManager` + a
	 * `PermissionLedgerAdapter`. Omit to get the unwrapped `Wallet` (callers
	 * can still wrap WPM themselves for the legacy on-chain grant flow).
	 */
	permissions?: RemoteWalletPermissionsOptions
}

export interface RemoteWalletResult {
	wallet: WalletInterface
	baseWallet?: Wallet
	adapter?: PermissionLedgerAdapter
	services: OneSatServices
	destroy: () => Promise<void>
	storage: WalletStorageManager
	feeModel: { model: 'sat/kb'; value: number }
	migrateRemote: (url: string) => Promise<void>
}

export async function createRemoteWallet(
	config: RemoteWalletConfig,
): Promise<RemoteWalletResult> {
	const core = await createWalletCore(config, undefined, {
		Services,
		StorageClient,
		StorageProvider,
		Wallet,
		WalletStorageManager,
	})

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
		if (adapter) adapter.dispose()
		await core.destroy()
	}

	return {
		wallet,
		baseWallet: config.permissions ? baseWallet : undefined,
		adapter,
		services: core.services,
		destroy,
		storage: core.storage,
		feeModel: core.feeModel,
		migrateRemote: core.migrateRemote,
	}
}
