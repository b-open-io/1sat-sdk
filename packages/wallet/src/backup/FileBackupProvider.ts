import type {
	TableSettings,
	TableSyncState,
	TableUser,
	sdk,
} from '@bsv/wallet-toolbox-client'
import { encode } from '@msgpack/msgpack'
import { Zip, ZipDeflate } from 'fflate'

type AuthId = sdk.AuthId
type ProcessSyncChunkResult = sdk.ProcessSyncChunkResult
type RequestSyncChunkArgs = sdk.RequestSyncChunkArgs
type SyncChunk = sdk.SyncChunk
type WalletStorageProvider = sdk.WalletStorageProvider
type WalletServices = sdk.WalletServices

/**
 * FileBackupProvider implements WalletStorageProvider to receive sync chunks
 * during wallet export. It encodes each chunk with MessagePack and streams
 * it directly to a fflate Zip instance.
 *
 * Usage:
 * 1. Create fflate.Zip with streaming callback
 * 2. Create FileBackupProvider with the zip instance
 * 3. Call storage.syncToWriter(auth, provider)
 * 4. Provider receives processSyncChunk() calls and writes to zip
 * 5. Call provider.getChunkCount() to get chunk count for manifest
 *
 * @example
 * ```typescript
 * import { Zip } from 'fflate';
 *
 * const chunks: Uint8Array[] = [];
 * const zip = new Zip((err, data, final) => {
 *   if (err) throw err;
 *   chunks.push(data);
 *   if (final) {
 *     const blob = new Blob(chunks, { type: 'application/zip' });
 *     // Download or save blob
 *   }
 * });
 *
 * const provider = new FileBackupProvider(zip, storage.getSettings(), identityKey);
 * await storage.syncToWriter(auth, provider);
 * console.log(`Exported ${provider.getChunkCount()} chunks`);
 * ```
 */
export class FileBackupProvider implements WalletStorageProvider {
	private zip: Zip
	private chunkCount = 0
	private settings: TableSettings
	private identityKey: string

	constructor(zip: Zip, settings: TableSettings, identityKey: string) {
		this.zip = zip
		this.settings = settings
		this.identityKey = identityKey
	}

	/**
	 * Get the number of chunks written. Call after sync completes.
	 */
	getChunkCount(): number {
		return this.chunkCount
	}

	/**
	 * Add a file to the zip archive with compression.
	 * Creates a ZipDeflate stream and pushes the data in one chunk.
	 */
	private addFileToZip(filename: string, data: Uint8Array): void {
		const deflate = new ZipDeflate(filename, { level: 6 })
		this.zip.add(deflate)
		deflate.push(data, true) // true = final chunk
	}

	// WalletStorageProvider interface methods

	isStorageProvider(): boolean {
		return false
	}

	setServices(_v: WalletServices): void {
		// Not needed for backup
	}

	// WalletStorageSync interface methods

	async findOrInsertSyncStateAuth(
		_auth: AuthId,
		_storageIdentityKey: string,
		_storageName: string,
	): Promise<{ syncState: TableSyncState; isNew: boolean }> {
		throw new Error('Not supported: findOrInsertSyncStateAuth')
	}

	async setActive(
		_auth: AuthId,
		_newActiveStorageIdentityKey: string,
	): Promise<number> {
		throw new Error('Not supported: setActive')
	}

	async getSyncChunk(_args: RequestSyncChunkArgs): Promise<SyncChunk> {
		throw new Error(
			'Not supported: getSyncChunk - this is a write-only provider',
		)
	}

	/**
	 * Receives sync chunks from WalletStorageManager.syncToWriter().
	 * Encodes each chunk with MessagePack and adds to the zip.
	 */
	async processSyncChunk(
		_args: RequestSyncChunkArgs,
		chunk: SyncChunk,
	): Promise<ProcessSyncChunkResult> {
		const chunkName = `chunk-${String(this.chunkCount).padStart(4, '0')}.bin`
		const encoded = encode(chunk)

		// Add chunk to zip with compression using ZipDeflate
		this.addFileToZip(chunkName, new Uint8Array(encoded))
		this.chunkCount++

		// Check if this chunk has any data - if all arrays are empty or undefined, we're done
		const hasData =
			(chunk.provenTxs && chunk.provenTxs.length > 0) ||
			(chunk.provenTxReqs && chunk.provenTxReqs.length > 0) ||
			(chunk.outputBaskets && chunk.outputBaskets.length > 0) ||
			(chunk.txLabels && chunk.txLabels.length > 0) ||
			(chunk.outputTags && chunk.outputTags.length > 0) ||
			(chunk.transactions && chunk.transactions.length > 0) ||
			(chunk.txLabelMaps && chunk.txLabelMaps.length > 0) ||
			(chunk.commissions && chunk.commissions.length > 0) ||
			(chunk.outputs && chunk.outputs.length > 0) ||
			(chunk.outputTagMaps && chunk.outputTagMaps.length > 0) ||
			(chunk.certificates && chunk.certificates.length > 0) ||
			(chunk.certificateFields && chunk.certificateFields.length > 0)

		return {
			done: !hasData,
			maxUpdated_at: undefined,
			updates: 0,
			inserts: 0,
		}
	}

	// WalletStorageWriter interface methods (throw not supported)

	async makeAvailable(): Promise<TableSettings> {
		return this.settings
	}

	async migrate(
		_storageName: string,
		_storageIdentityKey: string,
	): Promise<string> {
		throw new Error('Not supported: migrate')
	}

	async destroy(): Promise<void> {
		throw new Error('Not supported: destroy')
	}

	async findOrInsertUser(
		identityKey: string,
	): Promise<{ user: TableUser; isNew: boolean }> {
		// Return a mock user for backup purposes
		const now = new Date()
		return {
			user: {
				userId: 1,
				identityKey: identityKey || this.identityKey,
				activeStorage: this.settings.storageIdentityKey || '',
				created_at: now,
				updated_at: now,
			},
			isNew: false,
		}
	}

	async abortAction(_auth: AuthId, _args: unknown): Promise<never> {
		throw new Error('Not supported: abortAction')
	}

	async createAction(_auth: AuthId, _args: unknown): Promise<never> {
		throw new Error('Not supported: createAction')
	}

	async processAction(_auth: AuthId, _args: unknown): Promise<never> {
		throw new Error('Not supported: processAction')
	}

	async internalizeAction(_auth: AuthId, _args: unknown): Promise<never> {
		throw new Error('Not supported: internalizeAction')
	}

	async getCapabilities(): Promise<never> {
		throw new Error('Not supported: getCapabilities')
	}

	async beginActionBatch(_auth: AuthId, _args: unknown): Promise<never> {
		throw new Error('Not supported: beginActionBatch')
	}

	async extendActionBatch(_auth: AuthId, _args: unknown): Promise<never> {
		throw new Error('Not supported: extendActionBatch')
	}

	async renewActionBatch(_auth: AuthId, _args: unknown): Promise<never> {
		throw new Error('Not supported: renewActionBatch')
	}

	async prepareActionBatchCommit(
		_auth: AuthId,
		_args: unknown,
	): Promise<never> {
		throw new Error('Not supported: prepareActionBatchCommit')
	}

	async putActionBatchBlob(_auth: AuthId, _args: unknown): Promise<never> {
		throw new Error('Not supported: putActionBatchBlob')
	}

	async commitActionBatch(_auth: AuthId, _args: unknown): Promise<never> {
		throw new Error('Not supported: commitActionBatch')
	}

	async abortActionBatch(_auth: AuthId, _args: unknown): Promise<never> {
		throw new Error('Not supported: abortActionBatch')
	}

	async insertCertificateAuth(
		_auth: AuthId,
		_certificate: unknown,
	): Promise<number> {
		throw new Error('Not supported: insertCertificateAuth')
	}

	async relinquishCertificate(_auth: AuthId, _args: unknown): Promise<number> {
		throw new Error('Not supported: relinquishCertificate')
	}

	async relinquishOutput(_auth: AuthId, _args: unknown): Promise<number> {
		throw new Error('Not supported: relinquishOutput')
	}

	// WalletStorageReader interface methods (throw not supported)

	isAvailable(): boolean {
		return true
	}

	getServices(): WalletServices {
		throw new Error('Not supported: getServices')
	}

	getSettings(): TableSettings {
		return this.settings
	}

	async findCertificatesAuth(_auth: AuthId, _args: unknown): Promise<never[]> {
		throw new Error('Not supported: findCertificatesAuth')
	}

	async findOutputBasketsAuth(_auth: AuthId, _args: unknown): Promise<never[]> {
		throw new Error('Not supported: findOutputBasketsAuth')
	}

	async findOutputsAuth(_auth: AuthId, _args: unknown): Promise<never[]> {
		throw new Error('Not supported: findOutputsAuth')
	}

	async findProvenTxReqs(_args: unknown): Promise<never[]> {
		throw new Error('Not supported: findProvenTxReqs')
	}

	async listActions(_auth: AuthId, _vargs: unknown): Promise<never> {
		throw new Error('Not supported: listActions')
	}

	async listCertificates(_auth: AuthId, _vargs: unknown): Promise<never> {
		throw new Error('Not supported: listCertificates')
	}

	async listOutputs(_auth: AuthId, _vargs: unknown): Promise<never> {
		throw new Error('Not supported: listOutputs')
	}
}

// Re-export Zip and ZipDeflate for convenience
export { Zip, ZipDeflate }
