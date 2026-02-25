/**
 * Full wallet synchronization with remote backup server.
 *
 * Performs a complete resync: push local → reset sync state → full pull from server.
 * This is a deliberate user action (not automatic) for recovering from sync issues.
 */

import type { WalletStorageManager } from '@bsv/wallet-toolbox/out/src/index.client.js'
import type { sdk as mobileToolboxSdk } from '@bsv/wallet-toolbox/out/src/index.client.js'
import { createSyncMap } from '@bsv/wallet-toolbox/out/src/storage/schema/entities/EntityBase.js'
import { EntitySyncState } from '@bsv/wallet-toolbox/out/src/storage/schema/entities/EntitySyncState.js'

type WalletStorageProvider = mobileToolboxSdk.WalletStorageProvider

export type FullSyncStage = 'pushing' | 'resetting' | 'pulling' | 'complete'

export interface FullSyncOptions {
	/** Local storage manager */
	storage: WalletStorageManager
	/** Remote backup storage provider (StorageClient) */
	remoteStorage: WalletStorageProvider
	/** Identity key for the wallet */
	identityKey: string
	/** Optional progress callback */
	onProgress?: (stage: FullSyncStage, message: string) => void
	/** Max rough size per chunk in bytes (default: 1MB) */
	maxRoughSize?: number
	/** Max items per chunk (default: 100) */
	maxItems?: number
}

export interface FullSyncResult {
	pushed: { inserts: number; updates: number }
	pulled: { inserts: number; updates: number }
}

/**
 * Perform a full sync with the remote backup server.
 *
 * Steps:
 * 1. Push all local data to remote backup
 * 2. Clear local syncMap / reset sync state
 * 3. Pull ALL data from server (not incremental)
 * 4. Rebuild complete server→client ID mappings
 *
 * @example
 * ```typescript
 * const result = await fullSync({
 *   storage,
 *   remoteStorage: remoteClient,
 *   identityKey: pubKey,
 *   onProgress: (stage, msg) => console.log(`[${stage}] ${msg}`)
 * });
 * console.log(`Pushed: ${result.pushed.inserts}/${result.pushed.updates}`);
 * console.log(`Pulled: ${result.pulled.inserts}/${result.pulled.updates}`);
 * ```
 */
export async function fullSync(
	options: FullSyncOptions,
): Promise<FullSyncResult> {
	const {
		storage,
		remoteStorage,
		identityKey,
		onProgress,
		maxRoughSize = 1000000, // 1 MB default
		maxItems = 100,
	} = options

	// Step 1: Push ALL local data to remote (bypassing timestamp filter)
	onProgress?.('pushing', 'Pushing local data to remote...')

	const localSettings = storage.getSettings()
	const remoteSettings = await remoteStorage.makeAvailable()

	let pushInserts = 0
	let pushUpdates = 0
	let chunkCount = 0

	for (;;) {
		// Get sync state from remote for proper offsets
		const ss = await EntitySyncState.fromStorage(
			remoteStorage,
			identityKey,
			localSettings,
		)
		const args = ss.makeRequestSyncChunkArgs(
			identityKey,
			remoteSettings.storageIdentityKey,
			maxRoughSize,
			maxItems,
		)

		// KEY: Override since to undefined - includes ALL data regardless of timestamp
		args.since = undefined

		// Get chunk from local storage
		const chunk = await storage.runAsSync(async (sync) =>
			sync.getSyncChunk(args),
		)

		// Send chunk to remote
		const result = await remoteStorage.processSyncChunk(args, chunk)
		pushInserts += result.inserts
		pushUpdates += result.updates
		chunkCount++

		onProgress?.(
			'pushing',
			`Chunk ${chunkCount}: ${result.inserts} inserts, ${result.updates} updates`,
		)

		if (result.done) break
	}

	onProgress?.(
		'pushing',
		`Pushed ${pushInserts} inserts, ${pushUpdates} updates`,
	)

	// Step 2: Reset sync state to force full pull
	onProgress?.('resetting', 'Resetting sync state...')

	const auth = await storage.getAuth()

	await storage.runAsStorageProvider(async (active) => {
		const syncStates = await active.findSyncStates({
			partial: {
				userId: auth.userId,
				storageIdentityKey: remoteSettings.storageIdentityKey,
			},
		})

		if (syncStates.length > 0) {
			const syncState = syncStates[0]
			await active.updateSyncState(syncState.syncStateId, {
				syncMap: JSON.stringify(createSyncMap()),
				when: undefined,
				status: 'unknown',
			})
			onProgress?.('resetting', 'Sync state reset complete')
		} else {
			onProgress?.('resetting', 'No existing sync state found')
		}
	})

	// Step 3: Pull from remote (full pull due to reset state)
	onProgress?.('pulling', 'Pulling all data from remote...')

	const pullResult = await storage.syncFromReader(identityKey, remoteStorage)

	onProgress?.(
		'pulling',
		`Pulled ${pullResult.inserts} inserts, ${pullResult.updates} updates`,
	)

	// Step 4: Complete
	onProgress?.('complete', 'Full sync complete')

	return {
		pushed: { inserts: pushInserts, updates: pushUpdates },
		pulled: { inserts: pullResult.inserts, updates: pullResult.updates },
	}
}
