/**
 * @1sat/wallet - BRC-100 Wallet Engine for 1Sat Ordinals SDK
 *
 * This package provides the wallet functionality for the 1Sat SDK,
 * wrapping @1sat/wallet-toolbox with SDK-specific integrations.
 *
 * @example
 * ```typescript
 * import { OneSatWallet, OneSatServices } from '@1sat/wallet'
 * import { WalletStorageManager, StorageIdb } from '@bsv/wallet-toolbox/mobile'
 *
 * // Create storage (from @bsv/wallet-toolbox)
 * const storage = await WalletStorageManager.createWalletStorageManager(
 *   new StorageIdb({ name: 'my-wallet' })
 * )
 *
 * // Initialize wallet
 * const wallet = new OneSatWallet({
 *   rootKey: privateKey,
 *   storage,
 *   chain: 'main',
 *   owners: new Set([address1, address2])
 * })
 *
 * // Sync and use
 * wallet.syncAll()
 * ```
 */

// Core wallet exports
export {
	OneSatWallet,
	type OneSatWalletArgs,
	type OneSatWalletEvents,
	type IngestResult,
} from '@1sat/wallet-toolbox'

// Services
export {
	OneSatServices,
	type SyncOutput,
	type OrdfsMetadata,
	type Capability,
} from '@1sat/wallet-toolbox'

// Signers
export { ReadOnlySigner } from '@1sat/wallet-toolbox'

// API Clients
export {
	BaseClient,
	ChaintracksClient,
	BeefClient,
	ArcadeClient,
	TxoClient,
	OwnerClient,
	OrdfsClient,
	Bsv21Client,
} from '@1sat/wallet-toolbox'

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
	MapIndexer,
	OpNSIndexer,
	OrdLockIndexer,
	OriginIndexer,
	Outpoint,
	parseAddress,
	SigmaIndexer,
	type Bsv21,
	type Bsv21OutputData,
	type Bsv21TokenData,
	type Bsv21TransactionData,
	type CosignData,
	type File,
	type IndexData,
	type IndexSummary,
	type Inscription,
	type Origin,
	type ParseContext,
	type ParseResult,
	type Sigma,
	type Txo,
} from '@1sat/wallet-toolbox'

// Note: Storage utilities (StorageIdb, WalletStorageManager, Chain) should be
// imported directly from '@bsv/wallet-toolbox/mobile'
