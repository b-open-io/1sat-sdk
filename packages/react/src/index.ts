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

// Legacy context (popup-based — will be removed in OPL-1453)
export {
	OneSatProvider,
	useOneSatContext,
	type OneSatContextValue,
	type OneSatProviderProps,
} from './context'

// Legacy hooks (popup-based — will be removed in OPL-1453)
export {
	useBalance,
	useOrdinals,
	useTokens,
	useUtxos,
	useSignTransaction,
	useSignMessage,
	useInscribe,
	useSendOrdinals,
	useTransferToken,
	useCreateListing,
	usePurchaseListing,
	useCancelListing,
} from './hooks'

// Components
export { ConnectButton, type ConnectButtonProps } from './ConnectButton'
