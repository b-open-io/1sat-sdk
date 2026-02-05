/**
 * @1sat/wallet - BRC-100 Wallet Engine for 1Sat Ordinals SDK
 *
 * This package provides the wallet functionality for the 1Sat SDK.
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
	type IngestResult,
	type OneSatWalletArgs,
	type OneSatWalletEvents,
} from './OneSatWallet'

// Services
export { OneSatServices } from '@1sat/client'
export type {
	Bsv21OutputData,
	Bsv21TokenData,
	Bsv21TransactionData,
	Capability,
	OrdfsMetadata,
	SyncOutput,
} from '@1sat/types'

// Signers
export { ReadOnlySigner } from './signers/ReadOnlySigner'

// API Clients
export {
	ArcadeClient,
	BaseClient,
	BeefClient,
	Bsv21Client,
	ChaintracksClient,
	OrdfsClient,
	OwnerClient,
	OverlayClient,
	TxoClient,
} from '@1sat/client'

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
} from './indexers'

// Address sync
export {
	AddressManager,
	AddressSyncFetcher,
	AddressSyncManager,
	AddressSyncProcessor,
	AddressSyncQueueIdb,
	AddressSyncQueueSqlite,
	BRC29_PROTOCOL_ID,
	YOURS_PREFIX,
	type AddressDerivation,
	type AddressSyncEvents,
	type AddressSyncFetcherEvents,
	type AddressSyncFetcherOptions,
	type AddressSyncManagerOptions,
	type AddressSyncProcessorEvents,
	type AddressSyncProcessorOptions,
	type AddressSyncQueueInput,
	type AddressSyncQueueItem,
	type AddressSyncQueueItemStatus,
	type AddressSyncQueueStats,
	type AddressSyncQueueStorage,
	type AddressSyncState,
} from './address-sync'

// Backup
export {
	FileBackupProvider,
	FileRestoreReader,
	Zip,
	ZipDeflate,
	unzip,
	type BackupManifest,
	type BackupProgressCallback,
	type BackupProgressEvent,
	type Unzipped,
} from './backup'

// Factory
export {
	createWebWallet,
	fullSync,
	type FullSyncOptions,
	type FullSyncResult,
	type FullSyncStage,
	type WebWalletConfig,
	type WebWalletResult,
} from './factory'

// CWI (Compute With Integrity)
export {
	ChromeCWI,
	CWIEventName,
	EventCWI,
	createChromeCWI,
	createCWI,
	createEventCWI,
	type CWIResponseDetail,
	type CWITransport,
} from './cwi'

// Note: Storage utilities (StorageIdb, WalletStorageManager, Chain) should be
// imported directly from '@bsv/wallet-toolbox/mobile'
