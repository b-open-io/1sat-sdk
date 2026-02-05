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

// Templates (also in @1sat/protocols)
export {
	OrdP2PKH,
	OrdLock,
	applyInscription,
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
