/**
 * @1sat/sdk - 1Sat Ordinals SDK
 *
 * Complete toolkit for BSV ordinals, tokens, and wallet integration.
 *
 * ## Quick Start - Browser dApp (Connect to wallet popup)
 * ```typescript
 * import { createOneSat } from '@1sat/sdk'
 *
 * const onesat = createOneSat({ appName: 'My dApp' })
 * const { paymentAddress, ordinalAddress } = await onesat.connect()
 *
 * // Sign, inscribe, transfer via wallet popup
 * await onesat.inscribe({ dataB64, contentType: 'image/png' })
 * ```
 *
 * ## Building Transactions Directly
 * ```typescript
 * import { createOrdinals, sendOrdinals, TxBuilder } from '@1sat/sdk'
 * import { fetchPayUtxos, broadcast } from '@1sat/sdk/client'
 *
 * // Create inscriptions
 * const result = await createOrdinals({
 *   utxos: await fetchPayUtxos(address),
 *   destinations: [{ address, inscription: { dataB64, contentType } }],
 *   paymentPk: privateKey,
 *   changeAddress
 * })
 *
 * // Broadcast
 * await broadcast(result.tx)
 * ```
 *
 * ## Full Wallet Engine (Server/Desktop)
 * ```typescript
 * import { OneSatWallet, WalletStorageManager, StorageIdb } from '@1sat/sdk/wallet'
 *
 * const wallet = new OneSatWallet({
 *   rootKey: privateKey,
 *   storage: await WalletStorageManager.createWithProviders(new StorageIdb({ name: 'wallet' })),
 *   chain: 'main'
 * })
 * await wallet.syncAll()
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Types (from @1sat/types)
// ============================================================================

// Enums (need value export for runtime access)
export {
	TokenType,
	TokenSelectionStrategy,
	TokenInputMode,
} from '@1sat/types'

// Type-only exports
export type {
	// UTXOs
	Utxo,
	NftUtxo,
	TokenUtxo,
	// Inscriptions
	Inscription,
	IconInscription,
	Destination,
	// Tokens
	Distribution,
	// Protocols
	MAP,
	PreMAP,
	// Results
	ChangeResult,
	TokenChangeResult,
	// Config types
	CreateOrdinalsConfig,
	CreateOrdinalsCollectionConfig,
	CreateOrdinalsCollectionItemConfig,
	SendOrdinalsConfig,
	TransferOrdTokensConfig,
	TokenSplitConfig,
	// Signers
	Signer,
	LocalSigner,
	RemoteSigner,
	// Payments & Listings
	Payment,
	NewListing,
	ExistingListing,
} from '@1sat/types'

// ============================================================================
// Constants (from @1sat/constants)
// ============================================================================
export {
	// Protocol identifiers
	ORD_PREFIX,
	MAP_PREFIX,
	// Fees
	DEFAULT_SAT_PER_KB,
	DUST_LIMIT,
	// Endpoints
	API_HOST,
	API_HOST_TESTNET,
	ORDFS_HOST,
	// OrdLock
	ORD_LOCK_PREFIX,
	ORD_LOCK_SUFFIX,
	// Content types
	TOKEN_CONTENT_TYPE,
	IMAGE_CONTENT_TYPES,
} from '@1sat/constants'

// ============================================================================
// Utils (from @1sat/utils)
// ============================================================================
export {
	// Outpoint parsing
	parseOutpoint,
	formatOutpoint,
	isValidOutpoint,
	// Metadata
	stringifyMetaData,
	// Validation
	validateSubTypeData,
	validIconData,
	validIconFormat,
} from '@1sat/utils'

// ============================================================================
// Protocols (from @1sat/protocols)
// ============================================================================
export {
	// Sigma signing
	signData,
	createSigma,
	isLocalSigner,
	isRemoteSigner,
	Sigma,
	// MAP protocol
	buildMapScript,
	buildMapAsm,
	appendMapToScript,
	createMap,
	isValidMap,
	// Templates
	OrdP2PKH,
	createOrdP2PKHScript,
	applyInscription,
	OrdLock,
	createOrdLockScript,
	isOrdLockScript,
	buildOutput,
	// Inscription building
	buildInscriptionEnvelope,
	buildInscriptionEnvelopeAsm,
	createInscription,
	createJsonInscription,
	hasInscriptionEnvelope,
} from '@1sat/protocols'

// ============================================================================
// Client (from @1sat/client)
// ============================================================================
export {
	HttpError,
	ArcadeClient,
	BaseClient,
	BeefClient,
	Bsv21Client,
	ChaintracksClient,
	OneSatServices,
	OrdfsClient,
	OwnerClient,
	OverlayClient,
	TxoClient,
	type OutputQueryOptions,
} from '@1sat/client'

// ============================================================================
// Actions (from @1sat/actions)
// ============================================================================
export * from '@1sat/actions'

// ============================================================================
// Core (from @1sat/core - wraps js-1sat-ord)
// ============================================================================
export {
	// TxBuilder (SDK-specific)
	TxBuilder,
	createTxBuilder,
	type TxBuilderConfig,
	// Input conversion
	inputFromUtxo,
	inputsFromUtxos,
	// Ordinal operations
	createOrdinals,
	sendOrdinals,
	burnOrdinals,
	// Token operations
	transferOrdTokens,
	deployBsv21Token,
	// Listing operations
	createOrdListings,
	createOrdTokenListings,
	cancelOrdListings,
	cancelOrdTokenListings,
	purchaseOrdListing,
	purchaseOrdTokenListing,
	// UTXO fetching
	fetchPayUtxos,
	fetchNftUtxos,
	fetchTokenUtxos,
	selectTokenUtxos,
	// UTXO operations
	sendUtxos,
	// Broadcasting
	OneSatBroadcaster,
	oneSatBroadcaster,
	// Config types
	type DeployBsv21TokenConfig,
	type CreateOrdListingsConfig,
	type CreateOrdTokenListingsConfig,
	type CancelOrdListingsConfig,
	type CancelOrdTokenListingsConfig,
	type PurchaseOrdListingConfig,
	type PurchaseOrdTokenListingConfig,
	type SendUtxosConfig,
	type BurnOrdinalsConfig,
	type NewTokenListing,
	// Enums (re-exported from js-1sat-ord for convenience)
	RoytaltyType,
} from '@1sat/core'

// ============================================================================
// Connect (from @1sat/connect) - Wallet popup integration
// ============================================================================
export {
	// Factory functions
	createOneSat,
	getOneSat,
	isOneSatAvailable,
	isOneSatInjected,
	getInjectedOneSat,
	waitForOneSat,
	// Provider
	OneSatBrowserProvider,
	PopupManager,
	// Types
	type OneSatConfig,
	type OneSatProvider,
	type ConnectResult,
	type OneSatEvent,
	type EventHandler,
	type RpcMethod,
	type SignTransactionRequest,
	type SignTransactionResult,
	type SignMessageResult,
	type InscribeRequest,
	type InscribeResult,
	type SendOrdinalsRequest,
	type SendResult,
	type CreateListingRequest,
	type ListingResult,
	type PurchaseListingRequest,
	type CancelListingRequest,
	type TransferTokenRequest,
	type BalanceResult,
	type OrdinalOutput,
	type TokenOutput,
	type ListOptions,
	type PopupConfig,
	type PendingRequest,
	type StoredConnection,
	// Constants
	RpcMethods,
	PROTOCOL_VERSION,
	MessageTypes,
	ErrorCodes,
	// Errors
	type ErrorCode,
	OneSatError,
	UserRejectedError,
	WalletLockedError,
	WalletNotConnectedError,
	InsufficientFundsError,
	PopupBlockedError,
	PopupClosedError,
	TimeoutError,
	fromErrorResponse,
	// Messages
	type MessageType,
	type BaseMessage,
	type RequestMessage,
	type ResponseMessage,
	type ProtocolMessage,
	createRequest,
	createResponse,
	createErrorResponse,
	isValidMessage,
	isResponse,
	// Storage
	saveConnection,
	loadConnection,
	clearConnection,
	hasStoredConnection,
} from '@1sat/connect'

// Version
export const VERSION = '0.0.1'
