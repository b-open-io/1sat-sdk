export * from '@1sat/wallet'

export { createWebWallet } from './createWebWallet'
export type { WebWalletConfig, WebWalletResult } from './createWebWallet'

export type { MonitorEvent } from './types'

export {
	Monitor,
	Services,
	StorageClient,
	StorageIdb,
	StorageProvider,
	Wallet,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox/out/src/index.client.js'
