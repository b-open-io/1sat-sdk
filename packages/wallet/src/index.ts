/**
 * @1sat/wallet - BRC-100 Wallet Engine for 1Sat Ordinals SDK
 *
 * This package provides the wallet functionality for the 1Sat SDK,
 * wrapping 1sat-wallet-toolbox with SDK-specific integrations.
 *
 * @example
 * ```typescript
 * import { OneSatWallet, WalletStorageManager, StorageIdb } from '@1sat/wallet'
 *
 * // Create storage
 * const storage = await WalletStorageManager.createWithProviders(
 *   new StorageIdb({ name: 'my-wallet' })
 * )
 *
 * // Initialize wallet (read-only with public key)
 * const wallet = new OneSatWallet({
 *   rootKey: publicKeyHex,
 *   storage,
 *   chain: 'main',
 *   owners: new Set([address1, address2])
 * })
 *
 * // Or with full signing capability
 * const signingWallet = new OneSatWallet({
 *   rootKey: privateKey,
 *   storage,
 *   chain: 'main'
 * })
 *
 * // Sync and use
 * await wallet.syncAll()
 * ```
 */

// Core wallet exports
export {
	OneSatWallet,
	type OneSatWalletArgs,
	type OneSatWalletEvents,
	type SyncCompleteEvent,
	type SyncErrorEvent,
	type SyncProgressEvent,
	type SyncStartEvent,
	type SyncTxEvent,
} from '@1sat/wallet-toolbox'

// Services
export { OneSatServices, type OrdfsMetadata } from '@1sat/wallet-toolbox'

// Signers
export { ReadOnlySigner } from '@1sat/wallet-toolbox'

// Indexers
export {
	Bsv21Indexer,
	CosignIndexer,
	deriveFundAddress,
	FundIndexer,
	Indexer,
	InscriptionIndexer,
	LockIndexer,
	Listing,
	MAP_PROTO,
	MapIndexer,
	OpNSIndexer,
	OrdLockIndexer,
	OriginIndexer,
	Outpoint,
	parseAddress,
	SigmaIndexer,
	TransactionParser,
	type Bsv21,
	type Bsv21OutputData,
	type Bsv21TokenData,
	type Bsv21TransactionData,
	type Cosign,
	type File,
	type IndexData,
	type IndexSummary,
	type Inscription,
	type Origin,
	type ParseContext,
	type ParsedOutput,
	type ParseResult,
	type Sigma,
	type Txo,
} from '@1sat/wallet-toolbox'

// Storage (from @bsv/wallet-toolbox/mobile for browser compatibility)
export {
	StorageIdb,
	WalletStorageManager,
	type Chain,
} from '@1sat/wallet-toolbox'
