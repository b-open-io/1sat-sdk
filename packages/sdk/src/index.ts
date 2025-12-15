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
export type {
	// UTXOs
	Utxo,
	NftUtxo,
	TokenUtxo,
	// Inscriptions
	Inscription,
	ContentType,
	SubTypeData,
	// Tokens
	TokenType,
	TokenSelectionStrategy,
	TokenInputMode,
	Distribution,
	// Protocols
	MAP,
	PreMAP,
	// Results
	ChangeResult,
	// Config types
	CreateOrdinalsConfig,
	CreateOrdinalsCollectionConfig,
	CreateOrdinalsCollectionItemConfig,
	SendOrdinalsConfig,
	// Signers
	Signer,
	LocalSigner,
	RemoteSigner,
} from '@1sat/types'

// ============================================================================
// Constants (from @1sat/constants)
// ============================================================================
export {
	// Protocol opcodes
	OP_FALSE,
	OP_IF,
	OP_ENDIF,
	OP_RETURN,
	ORD_PREFIX,
	MAP_PREFIX,
	// Fees
	DEFAULT_SAT_PER_KB,
	MIN_FEE,
	DUST_LIMIT,
	// Endpoints
	API_HOST_MAIN,
	API_HOST_TEST,
	ORDFS_URL,
} from '@1sat/constants'

// ============================================================================
// Utils (from @1sat/utils)
// ============================================================================
export {
	// Encoding
	hexToBase64,
	base64ToHex,
	// Outpoint parsing
	parseOutpoint,
	formatOutpoint,
	// Metadata
	stringifyMetaData,
	// Validation
	validateSubType,
	validateIconSize,
} from '@1sat/utils'

// ============================================================================
// Protocols (from @1sat/protocols)
// ============================================================================
export {
	// Sigma signing
	signData,
	isLocalSigner,
	// Templates
	OrdP2PKH,
	OrdLock,
	// Inscription building
	buildInscriptionEnvelope,
} from '@1sat/protocols'

// ============================================================================
// Client (from @1sat/client)
// ============================================================================
export {
	// UTXO fetching
	fetchPayUtxos,
	fetchNftUtxos,
	fetchTokenUtxos,
	selectTokenUtxos,
	// Broadcasting
	OneSatBroadcaster,
	broadcast,
	// Input conversion
	inputFromUtxo,
} from '@1sat/client'

// ============================================================================
// Core (from @1sat/core)
// ============================================================================
export {
	// TxBuilder
	TxBuilder,
	createTxBuilder,
	// High-level operations
	createOrdinals,
	sendOrdinals,
} from '@1sat/core'

// ============================================================================
// Connect (from @1sat/connect) - Wallet popup integration
// ============================================================================
export {
	// Factory functions
	createOneSat,
	getOneSat,
	isOneSatAvailable,
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
