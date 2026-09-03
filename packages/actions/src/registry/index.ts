/**
 * Registry Module
 *
 * Shared infrastructure for building on-chain registry packages.
 * Used by any publisher creating ord-fs/json registry items.
 */

export { buildPackageOutputs, detectContentType } from './package-tx.js'

export type {
	PackageBroadcastResult,
	PackageFile,
	PackageMapMetadata,
	PackageTxOutput,
	PackageTxResult,
} from './types.js'

export {
	MANIFEST_CONTENT_TYPE,
	REGISTRY_TYPE_SET,
	REGISTRY_TYPES,
	type RegistryType,
} from './constants.js'
