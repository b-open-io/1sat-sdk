import { OneSatBrowserProvider } from './provider'
import type { OneSatConfig, OneSatProvider } from './types'

// Export connectWallet — recommended entry point for BRC-100 wallet detection
export {
	connectWallet,
	getAvailableProviders,
	connectSigmaWallet,
	type AvailableProvider,
	type ConnectWalletConfig,
	type ConnectWalletOptions,
	type ConnectWalletResult,
	type SigmaProviderConfig,
	type WalletProviderConfig,
} from './connectWallet'

// Export Sigma OAuth flow
export {
	completeSigmaOAuth,
	initiateSigmaOAuth,
	setSigmaIdentity,
	sigmaAuthClient,
	SIGMA_URL,
	type SigmaOAuthConfig,
	type SigmaOAuthResult,
} from './sigma-oauth'

// Export BRC-77 request signing
export { signRequest } from './auth'

// Export errors
export {
	AuthorizationTimeoutError,
	CodeReplayError,
	type ErrorCode,
	ErrorCodes,
	FallbackRequiredError,
	fromErrorResponse,
	InsufficientFundsError,
	OneSatError,
	PopupBlockedError,
	PopupClosedError,
	StateMismatchError,
	TimeoutError,
	TransportUnavailableError,
	UserRejectedError,
	WalletLockedError,
	WalletNotConnectedError,
} from './errors'
// Export messages
export {
	type BaseMessage,
	createErrorResponse,
	createRequest,
	createResponse,
	isResponse,
	isValidMessage,
	type MessageType,
	MessageTypes,
	PROTOCOL_VERSION,
	type ProtocolMessage,
	type RequestMessage,
	type ResponseMessage,
} from './messages'
export { type PendingRequest, type PopupConfig, PopupManager } from './popup'
// Export provider
export { OneSatBrowserProvider } from './provider'

// Export storage utilities
export {
	clearConnection,
	hasStoredConnection,
	loadConnection,
	type StoredConnection,
	saveConnection,
} from './storage'
export {
	AutoTransport,
	createAutoTransport,
	createRedirectTransport,
	RedirectTransport,
} from './transport'
// Export types
export type {
	BalanceResult,
	CancelListingRequest,
	ConnectParams,
	ConnectResult,
	CreateListingRequest,
	CWIHandshakeReason,
	CWIRequestMessage,
	CWIResponseMessage,
	CWIState,
	CWIStateMessage,
	CWITransport,
	CWITransportConfig,
	CWITransportEvent,
	CWITransportEventHandler,
	CWITransportName,
	CWIWalletStatus,
	EventHandler,
	InscribeRequest,
	InscribeResult,
	ListingResult,
	ListOptions,
	MobileFallbackMode,
	OneSatConfig,
	OneSatEvent,
	OneSatProvider,
	OrdinalOutput,
	PurchaseListingRequest,
	RpcMethod,
	SendOrdinalsRequest,
	SendResult,
	SignMessageResult,
	SignTransactionRequest,
	SignTransactionResult,
	TokenOutput,
	TransferTokenRequest,
	TransportMode,
	Utxo,
} from './types'
export { RpcMethods } from './types'
// Export wallet-side utilities (for popup pages)
export {
	closePopup,
	getPopupContext,
	isPopupContext,
	type PopupParams,
	parsePopupParams,
	rejectRequest,
	sendErrorResponse,
	sendResponse,
	walletLockedError,
	walletNotConnectedError,
} from './wallet'

/**
 * Check if the OneSat provider is injected by browser extension
 * Extensions inject window.onesat with isOneSat: true
 */
export function isOneSatInjected(): boolean {
	return (
		typeof window !== 'undefined' &&
		window.onesat !== undefined &&
		window.onesat.isOneSat === true
	)
}

/**
 * Get the injected OneSat provider from browser extension
 * Returns undefined if no extension is installed
 */
export function getInjectedOneSat(): OneSatProvider | undefined {
	if (isOneSatInjected()) {
		return window.onesat
	}
	return undefined
}

/**
 * Create or get a OneSat provider
 *
 * Detection priority:
 * 1. If browser extension is installed (window.onesat.isOneSat), use it
 * 2. Otherwise, create a popup-based provider
 *
 * @example
 * ```typescript
 * import { createOneSat } from '@1sat/connect'
 *
 * const onesat = createOneSat({
 *   appName: 'My dApp',
 * })
 *
 * // Connect to wallet (opens popup if no extension)
 * const { paymentAddress, ordinalAddress } = await onesat.connect()
 *
 * // Sign a transaction
 * const result = await onesat.signTransaction({ rawtx })
 * ```
 */
export function createOneSat(config?: OneSatConfig): OneSatProvider {
	// Check for injected extension provider first
	const injected = getInjectedOneSat()
	if (injected) {
		return injected
	}

	// Fall back to popup-based provider
	const provider = new OneSatBrowserProvider(config)

	// Inject into window (so subsequent calls find it)
	if (typeof window !== 'undefined' && !window.onesat) {
		window.onesat = provider
	}

	return provider
}

/**
 * Get the existing provider from window.onesat or create a new popup provider
 * @deprecated Use createOneSat() instead - it handles detection automatically
 */
export function getOneSat(config?: OneSatConfig): OneSatProvider {
	return createOneSat(config)
}

/**
 * Check if any OneSat provider is available (extension or popup)
 */
export function isOneSatAvailable(): boolean {
	return typeof window !== 'undefined' && window.onesat?.isOneSat === true
}

/**
 * Wait for the OneSat extension to be injected
 * Useful for detecting extension after page load
 *
 * @param timeout - Max time to wait in ms (default: 3000)
 * @returns The injected provider, or throws if timeout
 */
export function waitForOneSat(timeout = 3000): Promise<OneSatProvider> {
	return new Promise((resolve, reject) => {
		// Already available
		if (isOneSatInjected()) {
			resolve(window.onesat!)
			return
		}

		const startTime = Date.now()

		const checkInterval = setInterval(() => {
			if (isOneSatInjected()) {
				clearInterval(checkInterval)
				resolve(window.onesat!)
				return
			}

			if (Date.now() - startTime > timeout) {
				clearInterval(checkInterval)
				reject(new Error('OneSat extension not detected'))
			}
		}, 100)
	})
}
