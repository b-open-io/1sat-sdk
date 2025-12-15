/**
 * Connection result returned after successful wallet connection
 */
export interface ConnectResult {
	paymentAddress: string
	ordinalAddress: string
	identityPubKey: string
}

/**
 * Provider configuration options
 */
export interface OneSatConfig {
	/** Name of the dApp (shown in approval popup) */
	appName?: string
	/** Base URL for the wallet popup (default: https://1sat.market) */
	popupUrl?: string
	/** Request timeout in milliseconds (default: 300000 = 5 minutes) */
	timeout?: number
	/** Network to use (default: main) */
	network?: 'main' | 'test'
}

/**
 * RPC method names for wallet communication
 */
export const RpcMethods = {
	// Connection
	CONNECT: 'connect',
	DISCONNECT: 'disconnect',

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
} as const

export type RpcMethod = (typeof RpcMethods)[keyof typeof RpcMethods]

/**
 * Request to sign a transaction
 */
export interface SignTransactionRequest {
	rawtx: string
	description?: string
}

/**
 * Result of transaction signing
 */
export interface SignTransactionResult {
	rawtx: string
	txid: string
}

/**
 * Result of message signing (BSM format)
 */
export interface SignMessageResult {
	message: string
	signature: string
	address: string
}

/**
 * Request to create an inscription
 */
export interface InscribeRequest {
	dataB64: string
	contentType: string
	destinationAddress?: string
	metaData?: Record<string, string>
}

/**
 * Result of inscription creation
 */
export interface InscribeResult {
	txid: string
	origin: string
}

/**
 * Request to send ordinals
 */
export interface SendOrdinalsRequest {
	outpoints: string[]
	destinationAddress: string
}

/**
 * Generic send/transfer result
 */
export interface SendResult {
	txid: string
}

/**
 * Request to create a listing
 */
export interface CreateListingRequest {
	outpoints: string[]
	priceSatoshis: number
}

/**
 * Result of listing creation
 */
export interface ListingResult {
	txid: string
	listingOutpoints: string[]
}

/**
 * Request to purchase a listing
 */
export interface PurchaseListingRequest {
	listingOutpoint: string
}

/**
 * Request to cancel listings
 */
export interface CancelListingRequest {
	listingOutpoints: string[]
}

/**
 * Request to transfer tokens
 */
export interface TransferTokenRequest {
	tokenId: string
	amount: string
	destinationAddress: string
}

/**
 * Balance result
 */
export interface BalanceResult {
	satoshis: number
	usd?: number
}

/**
 * Ordinal output
 */
export interface OrdinalOutput {
	outpoint: string
	satoshis: number
	origin?: string
	contentType?: string
}

/**
 * Token output (BSV20/21)
 */
export interface TokenOutput {
	outpoint: string
	satoshis: number
	tokenId: string
	amount: string
	symbol?: string
}

/**
 * UTXO for payment
 */
export interface Utxo {
	txid: string
	vout: number
	satoshis: number
	script: string
}

/**
 * List options for queries
 */
export interface ListOptions {
	limit?: number
	offset?: number
}

/**
 * Event types emitted by the provider
 */
export type OneSatEvent = 'connect' | 'disconnect' | 'accountChange'

/**
 * Event handler function type
 */
export type EventHandler<T = unknown> = (data: T) => void

/**
 * Window interface extension for TypeScript
 * Browser extensions inject window.onesat with isOneSat: true
 */
declare global {
	interface Window {
		onesat?: OneSatProvider
	}
}

/**
 * Main provider interface
 * Implemented by both popup provider and browser extension
 */
export interface OneSatProvider {
	/** Identifies this as the OneSat provider (for detection) */
	readonly isOneSat: true

	// Connection
	connect(): Promise<ConnectResult>
	disconnect(): Promise<void>
	isConnected(): boolean

	// Signing
	signTransaction(
		request: SignTransactionRequest,
	): Promise<SignTransactionResult>
	signMessage(message: string): Promise<SignMessageResult>

	// Ordinals
	inscribe(request: InscribeRequest): Promise<InscribeResult>
	sendOrdinals(request: SendOrdinalsRequest): Promise<SendResult>

	// Listings
	createListing(request: CreateListingRequest): Promise<ListingResult>
	purchaseListing(request: PurchaseListingRequest): Promise<SendResult>
	cancelListing(request: CancelListingRequest): Promise<SendResult>

	// Tokens
	transferToken(request: TransferTokenRequest): Promise<SendResult>

	// Read-only
	getBalance(): Promise<BalanceResult>
	getOrdinals(options?: ListOptions): Promise<OrdinalOutput[]>
	getTokens(options?: ListOptions): Promise<TokenOutput[]>
	getUtxos(): Promise<Utxo[]>

	// Events
	on<T = unknown>(event: OneSatEvent, handler: EventHandler<T>): void
	off(event: OneSatEvent, handler: EventHandler): void

	// Utility
	getAddresses(): { paymentAddress: string; ordinalAddress: string } | null
	getIdentityPubKey(): string | null
}
