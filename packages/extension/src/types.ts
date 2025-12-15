/**
 * Extension-specific types for @1sat/extension
 */

import type {
	ConnectResult,
	SignTransactionRequest,
	SignTransactionResult,
	SignMessageResult,
	InscribeRequest,
	InscribeResult,
	SendOrdinalsRequest,
	SendResult,
	CreateListingRequest,
	ListingResult,
	PurchaseListingRequest,
	CancelListingRequest,
	TransferTokenRequest,
	BalanceResult,
	OrdinalOutput,
	TokenOutput,
	ListOptions,
	OneSatEvent,
	OneSatProvider,
} from './provider-types'

// Extend Window interface
declare global {
	interface Window {
		onesat?: OneSatProvider
	}
}

/**
 * Extension message types for internal communication
 */
export const MessageType = {
	REQUEST: 'ONESAT_REQUEST',
	RESPONSE: 'ONESAT_RESPONSE',
	EVENT: 'ONESAT_EVENT',
} as const

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType]

/**
 * RPC method names
 */
export const RpcMethod = {
	// Internal - state sync on page load
	INIT: '__init__',
	// Connection
	CONNECT: 'connect',
	DISCONNECT: 'disconnect',
	IS_CONNECTED: 'isConnected',
	// Signing
	SIGN_TRANSACTION: 'signTransaction',
	SIGN_MESSAGE: 'signMessage',
	// Ordinals
	INSCRIBE: 'inscribe',
	SEND_ORDINALS: 'sendOrdinals',
	// Listings
	CREATE_LISTING: 'createListing',
	PURCHASE_LISTING: 'purchaseListing',
	CANCEL_LISTING: 'cancelListing',
	// Tokens
	TRANSFER_TOKEN: 'transferToken',
	// Read-only
	GET_BALANCE: 'getBalance',
	GET_ORDINALS: 'getOrdinals',
	GET_TOKENS: 'getTokens',
	GET_UTXOS: 'getUtxos',
	GET_ADDRESSES: 'getAddresses',
	GET_IDENTITY_PUB_KEY: 'getIdentityPubKey',
} as const

/**
 * Initial state returned on page load
 */
export interface InitState {
	isConnected: boolean
	addresses: { paymentAddress: string; ordinalAddress: string } | null
	identityPubKey: string | null
}

export type RpcMethodValue = (typeof RpcMethod)[keyof typeof RpcMethod]

/**
 * Base request message from page to extension
 */
export interface ExtensionRequest<T = unknown> {
	type: typeof MessageType.REQUEST
	id: string
	method: RpcMethodValue
	params?: T
	origin?: string
}

/**
 * Response message from extension to page
 */
export interface ExtensionResponse<T = unknown> {
	type: typeof MessageType.RESPONSE
	id: string
	result?: T
	error?: ExtensionError
}

/**
 * Event message from extension to page
 */
export interface ExtensionEvent<T = unknown> {
	type: typeof MessageType.EVENT
	event: OneSatEvent
	data: T
}

/**
 * Union of all message types
 */
export type ExtensionMessage =
	| ExtensionRequest
	| ExtensionResponse
	| ExtensionEvent

/**
 * Error codes (JSON-RPC compatible)
 */
export const ErrorCode = {
	USER_REJECTED: 4001,
	UNAUTHORIZED: 4100,
	UNSUPPORTED_METHOD: 4200,
	DISCONNECTED: 4900,
	INTERNAL_ERROR: -32603,
	INVALID_PARAMS: -32602,
	METHOD_NOT_FOUND: -32601,
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

/**
 * Serializable error for extension messages
 */
export interface ExtensionError {
	code: ErrorCodeValue
	message: string
	data?: unknown
}

/**
 * Options for injecting the provider
 */
export interface InjectOptions {
	/** Custom wallet name shown in provider */
	walletName?: string
	/** Custom wallet version */
	walletVersion?: string
}

/**
 * Options for content bridge
 */
export interface ContentBridgeOptions {
	/** Filter allowed origins (default: all) */
	allowedOrigins?: string[]
	/** Enable debug logging */
	debug?: boolean
}

/**
 * Sender information passed to handlers
 */
export interface RequestSender {
	/** Origin of the requesting page */
	origin?: string
	/** Tab information */
	tab?: chrome.tabs.Tab
	/** Frame ID */
	frameId?: number
}

/**
 * Handler function type
 */
export type Handler<TParams = unknown, TResult = unknown> = (
	request: { params: TParams },
	sender: RequestSender,
) => Promise<TResult>

/**
 * Handler map for background script
 */
export interface HandlerMap {
	// Connection
	connect?: Handler<void, ConnectResult>
	disconnect?: Handler<void, void>
	isConnected?: Handler<void, boolean>
	// Signing
	signTransaction?: Handler<SignTransactionRequest, SignTransactionResult>
	signMessage?: Handler<{ message: string }, SignMessageResult>
	// Ordinals
	inscribe?: Handler<InscribeRequest, InscribeResult>
	sendOrdinals?: Handler<SendOrdinalsRequest, SendResult>
	// Listings
	createListing?: Handler<CreateListingRequest, ListingResult>
	purchaseListing?: Handler<PurchaseListingRequest, SendResult>
	cancelListing?: Handler<CancelListingRequest, SendResult>
	// Tokens
	transferToken?: Handler<TransferTokenRequest, SendResult>
	// Read-only
	getBalance?: Handler<void, BalanceResult>
	getOrdinals?: Handler<ListOptions | undefined, OrdinalOutput[]>
	getTokens?: Handler<ListOptions | undefined, TokenOutput[]>
	getUtxos?: Handler<void, Utxo[]>
	getAddresses?: Handler<void, { paymentAddress: string; ordinalAddress: string } | null>
	getIdentityPubKey?: Handler<void, string | null>
}

/**
 * Configuration for background handler
 */
export interface BackgroundHandlerConfig {
	/** Handler implementations */
	handlers: HandlerMap
	/** Determine if request should auto-approve (skip popup) */
	shouldAutoApprove?: (request: ExtensionRequest) => boolean
	/** Called when a site connects */
	onConnect?: (tabId: number, origin: string) => void
	/** Called when a site disconnects */
	onDisconnect?: (tabId: number, origin: string) => void
}

/**
 * UTXO type for getUtxos
 */
export interface Utxo {
	txid: string
	vout: number
	satoshis: number
	script: string
}

/**
 * Approval popup data
 */
export interface ApprovalData<T = unknown> {
	requestId: string
	method: RpcMethodValue
	params: T
	origin?: string
	favIconUrl?: string
}

/**
 * Connected site info
 */
export interface ConnectedSite {
	origin: string
	connectedAt: number
	permissions: string[]
}

/**
 * Wallet addresses state
 */
export interface WalletAddresses {
	paymentAddress: string
	ordinalAddress: string
	identityPubKey?: string
}
