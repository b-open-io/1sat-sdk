// --- Core: generic wallet connection ---

export {
	type AvailableProvider,
	type ConnectWalletConfig,
	type ConnectWalletOptions,
	type ConnectWalletResult,
	connectWallet,
	getAvailableProviders,
	loadLastProvider,
	type WalletProviderConfig,
} from './connectWallet'

// --- Connected session lifecycle (identity / auth polling) ---

export {
	createWalletSession,
	type DisconnectedEvent,
	type DisconnectReason,
	type IdentityChangeEvent,
	type WalletSession,
	type WalletSessionOptions,
	type WalletSessionStatus,
} from './walletSession'

// --- Sigma: OAuth flow + CWI wallet connection ---

export {
	completeSigmaOAuth,
	connectSigmaWallet,
	getStoredSigmaBapId,
	initiateSigmaOAuth,
	reconnectSigmaWallet,
	SIGMA_URL,
	type SigmaOAuthConfig,
	type SigmaOAuthResult,
	type SigmaProviderConfig,
	setSigmaIdentity,
	sigmaAuthClient,
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
	OneSatEvent,
	OneSatProvider,
	RpcMethod,
} from './types'
export { RpcMethods } from './types'
