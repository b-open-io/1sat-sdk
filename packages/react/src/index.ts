// Re-export everything from connect
export * from '@1sat/connect'

// Wallet context (BRC-100 / provider registry)
export {
	WalletProvider,
	useWallet,
	type WalletContextValue,
	type WalletProviderProps,
	type WalletStatus,
} from './wallet-context'

// Sigma OAuth callback
export { SigmaCallback, type SigmaCallbackProps } from './SigmaCallback'

// Connect dialog
export {
	ConnectDialog,
	type ConnectDialogProps,
	type ConnectDialogProviderInfo,
	type ConnectDialogRenderProps,
} from './ConnectDialog'
export {
	ConnectDialogProvider,
	useConnectDialog,
	type ConnectDialogProviderProps,
} from './ConnectDialogProvider'

// Components
export { ConnectButton, type ConnectButtonProps } from './ConnectButton'
export {
	WalletSelector,
	type WalletSelectorProps,
	type WalletSelectorProviderInfo,
	type WalletSelectorRenderProps,
} from './WalletSelector'
