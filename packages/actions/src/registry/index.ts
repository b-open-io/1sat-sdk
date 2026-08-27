/**
 * Registry Module
 *
 * Shared infrastructure for building on-chain registry packages.
 * Used by clawnet (skills, agents), theme-token (fonts, themes),
 * and any publisher creating ord-fs/json registry items.
 */

export {
	MANIFEST_CONTENT_TYPE,
	REGISTRY_TYPE_SET,
	REGISTRY_TYPES,
	type RegistryType,
} from './constants'
export { buildPackageOutputs, detectContentType } from './package-tx'
export type {
	PackageBroadcastResult,
	PackageFile,
	PackageMapMetadata,
	PackageTxOutput,
	PackageTxResult,
} from './types'
