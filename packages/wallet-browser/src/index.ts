export * from '@1sat/wallet'

export { createWebWallet } from './createWebWallet'
export type { WebWalletConfig, WebWalletResult } from './createWebWallet'

export { IndexedDbPermissionStore } from './permissions/indexed-db-store'
export { createIndexedDbTaskStateStore } from './indexedDbTaskStateStore'

export type { MonitorEvent } from './types'

export {
	Monitor,
	Services,
	StorageClient,
	StorageIdb,
	StorageProvider,
	Wallet,
	WalletPermissionsManager,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox-client'
