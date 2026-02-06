/**
 * @1sat/wallet-node - Node/Bun wallet factory for 1Sat Ordinals SDK
 *
 * This package provides the Node-specific wallet factory using Knex storage (SQLite/MySQL).
 */

// Re-export everything from base wallet
export * from '@1sat/wallet'

// Node-specific factory
export { createNodeWallet } from './createNodeWallet'
export type { NodeWalletConfig, NodeWalletResult } from './createNodeWallet'

// Full sync
export { fullSync } from './fullSync'
export type { FullSyncOptions, FullSyncResult, FullSyncStage } from './fullSync'

// Re-export node toolbox utilities
export {
	Monitor,
	Services,
	StorageClient,
	StorageKnex,
	StorageProvider,
	Wallet,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox'
