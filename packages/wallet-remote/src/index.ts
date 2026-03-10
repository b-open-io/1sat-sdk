export * from '@1sat/wallet'

export { createRemoteWallet } from './createRemoteWallet'
export type {
	LocalBackupConfig,
	RemoteWalletConfig,
	RemoteWalletResult,
} from './createRemoteWallet'

export {
	Services,
	StorageClient,
	Wallet,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox/out/src/index.client.js'
