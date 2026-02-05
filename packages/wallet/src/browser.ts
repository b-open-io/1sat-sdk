/**
 * Browser entrypoint for @1sat/wallet.
 */

export * from './index'
export {
	Monitor,
	Services,
	StorageClient,
	StorageIdb,
	StorageProvider,
	Wallet,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox-mobile/out/src/index.client.js'
export { createWebWallet } from './factory/createWebWallet'
export type {
	WebWalletConfig,
	WebWalletResult,
} from './factory/createWebWallet'
