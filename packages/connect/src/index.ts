import { OneSatBrowserProvider } from './provider'
import type { OneSatConfig, OneSatProvider } from './types'

// --- Core: generic wallet connection ---

export {
	connectWallet,
	getAvailableProviders,
	loadLastProvider,
	type AvailableProvider,
	type ConnectWalletConfig,
	type ConnectWalletOptions,
	type ConnectWalletResult,
	type WalletProviderConfig,
} from './connectWallet'

// --- Sigma: OAuth flow + CWI wallet connection ---

export {
	completeSigmaOAuth,
	connectSigmaWallet,
	initiateSigmaOAuth,
	setSigmaIdentity,
	sigmaAuthClient,
	SIGMA_URL,
	type SigmaOAuthConfig,
	type SigmaOAuthResult,
	type SigmaProviderConfig,
} from './sigma-oauth'

// --- BRC-77 request signing ---

export { signRequest } from './auth'

// --- Errors ---

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

// --- Legacy popup provider ---
// @deprecated Use connectWallet() + @1sat/actions instead.
// Kept for backward compatibility with existing consumers (droplit, extension).

export { OneSatBrowserProvider } from './provider'
export { type PendingRequest, type PopupConfig, PopupManager } from './popup'
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
 * @deprecated Use connectWallet() with a provider config instead.
 * The popup provider is a legacy pre-CWI interface.
 */
export function createOneSat(config?: OneSatConfig): OneSatProvider {
	const injected = getInjectedOneSat()
	if (injected) return injected
	const provider = new OneSatBrowserProvider(config)
	if (typeof window !== 'undefined' && !window.onesat) {
		window.onesat = provider
	}
	return provider
}

/**
 * @deprecated Use connectWallet() instead.
 */
export function getOneSat(config?: OneSatConfig): OneSatProvider {
	return createOneSat(config)
}

/**
 * @deprecated Use connectWallet() with autoDetect instead.
 */
export function isOneSatInjected(): boolean {
	return (
		typeof window !== 'undefined' &&
		window.onesat !== undefined &&
		window.onesat.isOneSat === true
	)
}

/** @deprecated */
export function getInjectedOneSat(): OneSatProvider | undefined {
	if (isOneSatInjected()) return window.onesat
	return undefined
}

/** @deprecated */
export function isOneSatAvailable(): boolean {
	return typeof window !== 'undefined' && window.onesat?.isOneSat === true
}

/** @deprecated Use connectWallet() with autoDetect instead. */
export function waitForOneSat(timeout = 3000): Promise<OneSatProvider> {
	return new Promise((resolve, reject) => {
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
