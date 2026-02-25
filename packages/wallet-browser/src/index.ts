/**
 * @1sat/wallet-browser - Browser wallet factory for 1Sat Ordinals SDK
 *
 * This package provides the browser-specific wallet factory using IndexedDB storage.
 */

// Re-export everything from base wallet
export * from '@1sat/wallet'

// Browser-specific factory
export { createWebWallet } from './createWebWallet'
export type { WebWalletConfig, WebWalletResult } from './createWebWallet'

// Full sync
export { fullSync } from './fullSync'
export type { FullSyncOptions, FullSyncResult, FullSyncStage } from './fullSync'

// Monitor events
export type { MonitorEvent } from './types'

// Re-export browser toolbox utilities
export {
	Monitor,
	Services,
	StorageClient,
	StorageIdb,
	StorageProvider,
	Wallet,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox/out/src/index.client.js'
