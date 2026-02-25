import type { sdk } from '@bsv/wallet-toolbox/out/src/index.client.js'

type Chain = sdk.Chain

/**
 * Manifest stored in the backup ZIP file describing the backup contents.
 */
export interface BackupManifest {
	/** Backup format version */
	version: 1
	/** ISO timestamp when backup was created */
	createdAt: string
	/** Network chain (main or test) */
	chain: Chain
	/** Wallet identity public key */
	identityKey: string
	/** Number of sync chunks in the backup */
	chunkCount: number
}

/**
 * Progress events emitted during backup/restore operations.
 */
export interface BackupProgressEvent {
	stage:
		| 'preparing'
		| 'exporting'
		| 'downloading'
		| 'uploading'
		| 'importing'
		| 'complete'
	message: string
	/** Optional progress percentage (0-100) */
	progress?: number
}

/**
 * Callback type for progress updates during backup/restore.
 */
export type BackupProgressCallback = (event: BackupProgressEvent) => void
