/**
 * @1sat/core - Transaction building core for 1Sat Ordinals SDK
 *
 * This package wraps js-1sat-ord to provide all ordinal and token
 * transaction building functions, plus SDK-specific utilities like TxBuilder.
 *
 * @example
 * ```typescript
 * import { createOrdinals, sendOrdinals, transferOrdTokens } from '@1sat/core'
 * ```
 */

// TxBuilder - SDK-specific fluent API
export { createTxBuilder, TxBuilder, type TxBuilderConfig } from './builder'
export { inputFromUtxo, inputsFromUtxos } from './input'

// ============================================================================
// Protocol implementations (formerly @1sat/protocols)
// ============================================================================

// Sigma protocol
export {
	createSigma,
	isLocalSigner,
	isRemoteSigner,
	Sigma,
	signData,
} from './sigma'

// MAP protocol
export {
	appendMapToScript,
	buildMapAsm,
	buildMapScript,
	createMap,
	isValidMap,
} from './map'

// Inscription envelope
export {
	buildInscriptionEnvelope,
	buildInscriptionEnvelopeAsm,
	createInscription,
	createJsonInscription,
	hasInscriptionEnvelope,
} from './inscription'

// OrdP2PKH template
export {
	applyInscription,
	createOrdP2PKHScript,
	OrdP2PKH,
} from './ordp2pkh'

// OrdLock template
export {
	buildOutput,
	createOrdLockScript,
	isOrdLockScript,
	OrdLock,
} from './ordlock'

// ============================================================================
// Re-export everything from js-1sat-ord
// ============================================================================

// Ordinal operations
export {
	createOrdinals,
	sendOrdinals,
	burnOrdinals,
} from 'js-1sat-ord'

// Token operations
export {
	transferOrdTokens,
	deployBsv21Token,
} from 'js-1sat-ord'

// Listing operations
export {
	createOrdListings,
	createOrdTokenListings,
	cancelOrdListings,
	cancelOrdTokenListings,
	purchaseOrdListing,
	purchaseOrdTokenListing,
} from 'js-1sat-ord'

// UTXO operations
export { sendUtxos } from 'js-1sat-ord'

// UTXO fetching (also in @1sat/client, but re-export for convenience)
export {
	fetchPayUtxos,
	fetchNftUtxos,
	fetchTokenUtxos,
	selectTokenUtxos,
} from 'js-1sat-ord'

// Utilities
export {
	stringifyMetaData,
	validateSubTypeData,
} from 'js-1sat-ord'

// Broadcasting
export {
	OneSatBroadcaster,
	oneSatBroadcaster,
} from 'js-1sat-ord'

// Re-export all types from js-1sat-ord
export type {
	Utxo,
	NftUtxo,
	TokenUtxo,
	Inscription,
	Destination,
	Distribution,
	Payment,
	MAP,
	PreMAP,
	ChangeResult,
	TokenChangeResult,
	CreateOrdinalsConfig,
	CreateOrdinalsCollectionConfig,
	CreateOrdinalsCollectionItemConfig,
	SendOrdinalsConfig,
	TransferOrdTokensConfig,
	DeployBsv21TokenConfig,
	CreateOrdListingsConfig,
	CreateOrdTokenListingsConfig,
	CancelOrdListingsConfig,
	CancelOrdTokenListingsConfig,
	PurchaseOrdListingConfig,
	PurchaseOrdTokenListingConfig,
	SendUtxosConfig,
	BurnOrdinalsConfig,
	NewListing,
	ExistingListing,
	NewTokenListing,
	TokenSplitConfig,
	LocalSigner,
	RemoteSigner,
} from 'js-1sat-ord'

// Enums
export {
	TokenType,
	TokenInputMode,
	TokenSelectionStrategy,
	RoytaltyType,
} from 'js-1sat-ord'

// ============================================================================
// Re-export @1sat/templates for consumers that want full ScriptTemplate classes
// Aliased where names conflict with core's simpler helper implementations
// ============================================================================

// Script Templates (aliased to avoid conflicts with core's implementations)
export {
	OrdLock as OrdLockTemplate,
	Lock,
	Inscription as InscriptionTemplate,
	BSV20,
	BSV21,
} from '@1sat/templates'

// BitCom Protocols (aliased to avoid conflicts with core's implementations)
export {
	AIP,
	BAP,
	MAP as MAPTemplate,
	Sigma as SigmaTemplate,
	B,
	BitCom,
} from '@1sat/templates'

// BSocial
export { BSocial } from '@1sat/templates'

// Signing abstraction
export { PrivateKeySigner, WalletSigner } from '@1sat/templates'
export type { Signer } from '@1sat/templates'

// Template types
export type {
	OrdLockData,
	LockData,
	InscriptionFile,
	InscriptionOptions,
} from '@1sat/templates'

// Template constants
export {
	ORDLOCK_PREFIX,
	ORDLOCK_SUFFIX,
	LOCK_PREFIX,
	LOCK_SUFFIX,
	AIP_PREFIX,
	B_PREFIX,
	MediaType,
	Encoding,
	BAP_PROTOCOL_PREFIX,
	BAPAttestationType,
	MAP_PREFIX,
	MAPCommand,
	SIGMA_PREFIX,
	SigmaAlgorithm,
	BSocialActionType,
	BSocialContext,
} from '@1sat/templates'

// Template protocol types
export type {
	Protocol,
	BitComProtocol,
	BitComDecoded,
	AIPData,
	AIPOptions,
	BData,
	BAPData,
	MAPData,
	SigmaData,
	SigmaOptions,
	BSV20Operation,
	TokenData,
	BSV20TokenData,
	TokenOptions,
	TokenInscription,
	BSV20Inscription,
	BSV20Options,
	BSV21Operation,
	BSV21TokenData,
	BSV21Inscription,
	BSV21Options,
	BSocialAction,
	BSocialPost,
	BSocialLike,
	BSocialFollow,
	BSocialMessage,
	BSocialVideo,
	BSocialDecoded,
} from '@1sat/templates'
