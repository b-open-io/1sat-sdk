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
	getStoredSigmaBapId,
	initiateSigmaOAuth,
	reconnectSigmaWallet,
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

// --- Types (kept for downstream consumers that reference them) ---

export type {
	OneSatConfig,
	OneSatProvider,
	OneSatEvent,
	RpcMethod,
} from './types'
export { RpcMethods } from './types'
