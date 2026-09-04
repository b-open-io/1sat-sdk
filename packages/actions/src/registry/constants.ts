/**
 * Registry constants -- shared across all publishers.
 */

export const REGISTRY_TYPES = [
	// Current shadcn/ui registry item types.
	'registry:base',
	'registry:lib',
	'registry:block',
	'registry:component',
	'registry:ui',
	'registry:hook',
	'registry:page',
	'registry:file',
	'registry:font',
	'registry:theme',
	'registry:style',
	'registry:item',
	// Legacy shadcn/ui types retained for existing publishers.
	'registry:example',
	'registry:internal',
	// 1Sat outer package metadata types, not shadcn/ui item types.
	'registry:asset',
	'registry:skill',
	'registry:agent',
	'registry:organization',
] as const

export type RegistryType = (typeof REGISTRY_TYPES)[number]
export const REGISTRY_TYPE_SET: ReadonlySet<string> = new Set(REGISTRY_TYPES)
export const MANIFEST_CONTENT_TYPE = 'ord-fs/json'
