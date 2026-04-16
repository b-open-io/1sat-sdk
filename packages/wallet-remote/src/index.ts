export * from '@1sat/wallet'

export {
	DEFAULT_PERMISSIONS_CONFIG,
	createRemoteWallet,
} from './createRemoteWallet'
export type {
	RemoteWalletConfig,
	RemoteWalletPermissionsOptions,
	RemoteWalletResult,
} from './createRemoteWallet'

export {
	Services,
	StorageClient,
	Wallet,
	WalletPermissionsManager,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox/out/src/index.client.js'
