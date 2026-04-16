export * from '@1sat/wallet'

export { createWebWallet } from './createWebWallet'
export type { WebWalletConfig, WebWalletResult } from './createWebWallet'

export {
	DEFAULT_PERMISSIONS_CONFIG,
	createPermissionedWebWallet,
} from './createPermissionedWebWallet'
export type {
	PermissionedWebWalletConfig,
	PermissionedWebWalletResult,
} from './createPermissionedWebWallet'

export * from './permissions'

export type { MonitorEvent } from './types'

export {
	Monitor,
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletPermissionsManager,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox-mobile'
export { StorageIdb } from '@bsv/wallet-toolbox/out/src/index.client.js'
