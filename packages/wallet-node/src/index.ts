/**
 * @1sat/wallet-node - Node/Bun wallet factory for 1Sat Ordinals SDK
 *
 * This package provides the Node-specific wallet factory using bun:sqlite storage.
 */

// Re-export everything from base wallet
export * from '@1sat/wallet'

// Node-specific factory
export { createNodeWallet } from './createNodeWallet'
export type { NodeWalletConfig, NodeWalletResult } from './createNodeWallet'

// bun:sqlite storage provider
export { StorageBunSqlite } from './storage-bun-sqlite'
export type { StorageBunSqliteOptions } from './storage-bun-sqlite'

// Full sync
export { fullSync } from './fullSync'
export type { FullSyncOptions, FullSyncResult, FullSyncStage } from './fullSync'

// Re-export node toolbox utilities
export {
	Monitor,
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox'
