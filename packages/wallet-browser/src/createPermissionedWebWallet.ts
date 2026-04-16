import type { OneSatServices } from '@1sat/client'
import {
	type Monitor,
	type PermissionsManagerConfig,
	WalletPermissionsManager,
	type WalletStorageManager,
} from '@bsv/wallet-toolbox-mobile'
import {
	type WebWalletConfig,
	type WebWalletResult,
	createWebWallet,
} from './createWebWallet'
import { PermissionLedgerAdapter } from './permissions/adapter'
import { InMemoryPermissionStore } from './permissions/in-memory-store'
import type {
	IPermissionStore,
	PermissionPromptHandler,
} from './permissions/types'

/**
 * Default `PermissionsManagerConfig` — mirrors the "secure by default" shape
 * that BRC-100 recommends, while leaving grouped permissions ON so first-visit
 * batched prompts still work.
 *
 * Callers can spread + override individual flags as needed.
 */
export const DEFAULT_PERMISSIONS_CONFIG: PermissionsManagerConfig = {
	// Protocol permissions — require for external apps
	seekProtocolPermissionsForSigning: true,
	seekProtocolPermissionsForEncrypting: true,
	seekProtocolPermissionsForHMAC: true,
	seekPermissionsForKeyLinkageRevelation: true,
	seekPermissionsForPublicKeyRevelation: false,
	seekPermissionsForIdentityKeyRevelation: true,
	seekPermissionsForIdentityResolution: true,

	// Basket permissions
	seekBasketInsertionPermissions: true,
	seekBasketRemovalPermissions: true,
	seekBasketListingPermissions: false,

	// Label permissions
	seekPermissionWhenApplyingActionLabels: false,
	seekPermissionWhenListingActionsByLabel: false,

	// Certificate permissions
	seekCertificateDisclosurePermissions: true,
	seekCertificateAcquisitionPermissions: true,
	seekCertificateRelinquishmentPermissions: true,
	seekCertificateListingPermissions: false,

	// Privacy
	encryptWalletMetadata: true,

	// Spending
	seekSpendingPermissions: true,

	// BRC-73 grouped permissions — KEEP ENABLED for batched first-visit UX.
	seekGroupedPermission: true,

	// Privileged vs non-privileged distinction
	differentiatePrivilegedOperations: true,
}

export interface PermissionedWebWalletConfig extends WebWalletConfig {
	/**
	 * Originator value the wallet itself uses when making internal calls
	 * (e.g. `chrome-extension://<id>` for a browser extension). WPM skips all
	 * permission checks for this originator.
	 */
	adminOriginator: string
	/**
	 * Persistent store for permission grants. Defaults to an in-memory store
	 * that is lost when the runtime restarts — provide a chrome.storage-backed
	 * or IndexedDB-backed implementation for production.
	 */
	permissionStore?: IPermissionStore
	/**
	 * UI callbacks invoked by the adapter when a grant is needed.
	 *
	 * `onCounterpartyPermissionRequested` is optional. If omitted, level-2
	 * counterparty pacts are auto-denied (the dApp's operation fails
	 * gracefully) — pass a handler if your wallet supports counterparty pacts.
	 */
	prompt: PermissionPromptHandler
	/**
	 * Optional overrides for the underlying WPM config. Spreads on top of
	 * {@link DEFAULT_PERMISSIONS_CONFIG}.
	 */
	permissionsConfig?: Partial<PermissionsManagerConfig>
}

export interface PermissionedWebWalletResult {
	wallet: WalletPermissionsManager
	adapter: PermissionLedgerAdapter
	services: OneSatServices
	monitor?: Monitor
	destroy: () => Promise<void>
	storage: WalletStorageManager
	remoteStorage?: WebWalletResult['remoteStorage']
	migrateRemote: (url: string) => Promise<void>
}

/**
 * Create a browser wallet whose permission state is stored in an injected
 * {@link IPermissionStore} instead of on-chain.
 *
 * Wraps the base wallet produced by {@link createWebWallet} with a
 * `WalletPermissionsManager` and a {@link PermissionLedgerAdapter} that
 * consults the store before prompting. Approved grants are written to the
 * store and replayed on subsequent calls — WPM never writes permission
 * tokens to the chain (except for level-2 counterparty pacts, which remain
 * on-chain by design).
 *
 * The returned `wallet` implements `WalletInterface`, so it slots into any
 * BRC-100 consumer.
 */
export async function createPermissionedWebWallet(
	config: PermissionedWebWalletConfig,
): Promise<PermissionedWebWalletResult> {
	const base = await createWebWallet(config)
	const permissionsConfig: PermissionsManagerConfig = {
		...DEFAULT_PERMISSIONS_CONFIG,
		...(config.permissionsConfig ?? {}),
	}
	const wallet = new WalletPermissionsManager(
		base.wallet,
		config.adminOriginator,
		permissionsConfig,
	)
	const store = config.permissionStore ?? new InMemoryPermissionStore()
	const adapter = new PermissionLedgerAdapter({
		wallet,
		store,
		prompt: config.prompt,
	})

	const destroy = async (): Promise<void> => {
		adapter.dispose()
		await base.destroy()
	}

	return {
		wallet,
		adapter,
		services: base.services,
		monitor: base.monitor,
		destroy,
		storage: base.storage,
		remoteStorage: base.remoteStorage,
		migrateRemote: base.migrateRemote,
	}
}
