export { FileBackupProvider, Zip, ZipDeflate } from './FileBackupProvider.js'
export { FileRestoreReader } from './FileRestoreReader.js'
export type {
	BackupManifest,
	BackupProgressEvent,
	BackupProgressCallback,
} from './types.js'

// Re-export fflate utilities needed for restore
export { unzip } from 'fflate'
export type { Unzipped } from 'fflate'
