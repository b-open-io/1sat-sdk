/**
 * Registry constants -- shared across all publishers.
 */

export const REGISTRY_TYPES = [
	// shadcn/ui standard types
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
	'registry:example',
	'registry:internal',
	// Agent extension types
	'registry:skill',
	'registry:agent',
	'registry:organization',
] as const

export type RegistryType = (typeof REGISTRY_TYPES)[number]
export const REGISTRY_TYPE_SET: ReadonlySet<string> = new Set(REGISTRY_TYPES)
export const MANIFEST_CONTENT_TYPE = 'ord-fs/json'
