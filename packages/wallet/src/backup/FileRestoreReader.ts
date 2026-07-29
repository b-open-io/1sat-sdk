import type { sdk } from '@bsv/wallet-toolbox-client/out/src/index.client.js'
import type { TableSettings } from '@bsv/wallet-toolbox-client/out/src/storage/schema/tables/TableSettings.js'
import { decode } from '@msgpack/msgpack'
import type { Unzipped } from 'fflate'
import type { BackupManifest } from './types'

type RequestSyncChunkArgs = sdk.RequestSyncChunkArgs
type SyncChunk = sdk.SyncChunk
type WalletStorageSyncReader = sdk.WalletStorageSyncReader

/**
 * FileRestoreReader implements WalletStorageSyncReader to serve sync chunks
 * from a previously exported backup ZIP file during wallet restore.
 *
 * Usage:
 * 1. Unzip the backup file with fflate.unzip()
 * 2. Read and parse manifest.json
 * 3. Create FileRestoreReader with unzipped data and manifest
 * 4. Call storage.syncFromReader(identityKey, reader)
 * 5. Reader serves chunks sequentially via getSyncChunk()
 *
 * @example
 * ```typescript
 * import { unzip } from 'fflate';
 *
 * const zipData = new Uint8Array(await file.arrayBuffer());
 * const unzipped = await new Promise<Unzipped>((resolve, reject) => {
 *   unzip(zipData, (err, data) => (err ? reject(err) : resolve(data)));
 * });
 *
 * const manifest = JSON.parse(
 *   new TextDecoder().decode(unzipped['manifest.json'])
 * );
 *
 * const reader = new FileRestoreReader(unzipped, manifest);
 * await storage.syncFromReader(manifest.identityKey, reader);
 * ```
 */
export class FileRestoreReader implements WalletStorageSyncReader {
	private unzipped: Unzipped
	private manifest: BackupManifest
	private currentChunkIndex = 0
	private settings: TableSettings

	constructor(unzipped: Unzipped, manifest: BackupManifest) {
		this.unzipped = unzipped
		this.manifest = manifest

		// Create settings from manifest
		this.settings = {
			created_at: new Date(manifest.createdAt),
			updated_at: new Date(manifest.createdAt),
			storageIdentityKey: `backup-${manifest.identityKey.slice(0, 16)}`,
			storageName: 'FileBackup',
			chain: manifest.chain,
			dbtype: 'IndexedDB',
			maxOutputScript: 256,
		}
	}

	/**
	 * Get the backup manifest.
	 */
	getManifest(): BackupManifest {
		return this.manifest
	}

	/**
	 * Reset the reader to start from the beginning.
	 * Call this if you need to re-read the backup.
	 */
	reset(): void {
		this.currentChunkIndex = 0
	}

	// WalletStorageSyncReader interface methods

	async makeAvailable(): Promise<TableSettings> {
		return this.settings
	}

	/**
	 * Returns sync chunks sequentially from the backup.
	 * When all chunks are consumed, returns an empty chunk to signal completion.
	 */
	async getSyncChunk(args: RequestSyncChunkArgs): Promise<SyncChunk> {
		if (this.currentChunkIndex >= this.manifest.chunkCount) {
			// Return empty chunk to signal completion
			return {
				fromStorageIdentityKey: this.settings.storageIdentityKey,
				toStorageIdentityKey: args.toStorageIdentityKey,
				userIdentityKey: this.manifest.identityKey,
			}
		}

		const chunkName = `chunk-${String(this.currentChunkIndex).padStart(4, '0')}.bin`
		const chunkData = this.unzipped[chunkName]

		if (!chunkData) {
			throw new Error(`Missing chunk file: ${chunkName}`)
		}

		const chunk = decode(chunkData) as SyncChunk
		this.currentChunkIndex++

		return chunk
	}
}
