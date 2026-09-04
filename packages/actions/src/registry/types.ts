import type { RegistryType } from './constants'

/**
 * A file to include in a registry package inscription.
 */
export interface PackageFile {
	/** Relative file path (e.g. "SKILL.md", "refs/api.md") */
	path: string
	/** File content as bytes */
	content: Uint8Array
	/** MIME content type (e.g. "text/markdown", "font/woff2") */
	contentType: string
}

/**
 * MAP metadata for a registry package manifest.
 * All fields become MAP SET key-value pairs on the manifest inscription.
 */
export interface PackageMapMetadata {
	/** Registry identifier -- consumer-provided application namespace */
	app: string
	/** Outer package type advertised in MAP metadata (not necessarily a shadcn/ui item type) */
	type: RegistryType
	/** Package name (lowercase, hyphenated, 1-64 chars) */
	name: string
	/** Semantic version (e.g. "1.0.0") */
	version: string
	/** Human-readable description */
	description: string
	/** BCP 47 language tag (e.g. "en", "zh") */
	language?: string
	/** URL to homepage or repository */
	homepage?: string
	/** Previous manifest outpoint for version chaining */
	prev?: string
	/** OpNS name if publisher owns it */
	'opns.name'?: string
	/** Outpoint of the OpNS name ordinal */
	'opns.outpoint'?: string
	/** Human-readable display title */
	title?: string
	/** Author name or identifier */
	author?: string
	/** JSON-serialized string[] of npm dependencies */
	dependencies?: string
	/** JSON-serialized string[] of dev dependencies */
	devDependencies?: string
	/** JSON-serialized string[] of registry item dependencies */
	registryDependencies?: string
	/** JSON-serialized string[] of category tags */
	categories?: string
	/** Additional MAP fields (e.g. font.family, font.variable) */
	[key: string]: string | undefined
}

/**
 * A single output in a package inscription transaction.
 */
export interface PackageTxOutput {
	/** Hex-encoded locking script */
	lockingScriptHex: string
	/** Satoshi amount (always 1 for inscriptions) */
	satoshis: number
	/** Human-readable description of this output */
	description: string
	/** Whether this is the manifest output (the package's on-chain identity) */
	isManifest: boolean
}

/**
 * Result of building package inscription outputs.
 */
export interface PackageTxResult {
	/** All outputs ready for transaction construction */
	outputs: PackageTxOutput[]
	/** Index of the manifest output in the outputs array */
	manifestVout: number
}

/**
 * Result after broadcasting a package inscription transaction.
 */
export interface PackageBroadcastResult {
	/** Transaction ID */
	txid: string
	/** Manifest outpoint: "{txid}_{manifestVout}" */
	manifestOutpoint: string
}
