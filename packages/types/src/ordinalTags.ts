import type { OrdfsMetadata } from './services.js'

/** Longest display name we put in customInstructions (not tags). */
export const MAX_NAME_TAG_LENGTH = 64

/**
 * Ordinals / indexer outpoint form: `txid_vout`.
 * Accepts dotted (BRC-100) or underscore input. Used for origin tags, CI
 * origin, BSV21 tokenId-style ids, and OrdFS keys.
 */
export function formatOrdinalOutpoint(outpoint: string): string {
	const s = outpoint.trim()
	if (s.length >= 66) {
		const sep = s[64]
		if (sep === '.' || sep === '_') {
			return `${s.slice(0, 64)}_${s.slice(65)}`
		}
	}
	const dot = s.indexOf('.')
	if (dot === 64) return `${s.slice(0, 64)}_${s.slice(65)}`
	return s.replace('.', '_')
}

/** @deprecated Use {@link formatOrdinalOutpoint} */
export const formatOriginOutpoint = formatOrdinalOutpoint

/**
 * Canonical identity tags for an ordinal (BRC-147).
 *
 * Emits filter tags (lowercase-safe). Does **not** emit `name:` (→ CI `name`).
 * Bare `origin` is only for the mint out itself (caller stamps that).
 */
export function ordinalTagsFromMetadata(
	metadata: Partial<OrdfsMetadata> | undefined,
	fallbackOrigin?: string,
): string[] {
	const tags: string[] = []

	const origin = metadata?.origin || fallbackOrigin
	if (origin) tags.push(`origin:${formatOrdinalOutpoint(origin)}`)

	const map = metadata?.map as Record<string, unknown> | undefined
	const subTypeData = parseMapSubTypeData(map)
	// Display pointer when media is not at origin (e.g. OrdFS parent / MAP content)
	const content =
		typeof map?.content === 'string'
			? map.content
			: typeof metadata?.parent === 'string'
				? metadata.parent
				: undefined
	if (content) tags.push(`content:${formatOrdinalOutpoint(content)}`)

	// collectionId is often nested: MAP subTypeData JSON (collection items)
	const collectionId =
		typeof map?.collectionId === 'string'
			? map.collectionId
			: typeof map?.collection === 'string'
				? map.collection
				: typeof subTypeData?.collectionId === 'string'
					? subTypeData.collectionId
					: typeof subTypeData?.collection === 'string'
						? subTypeData.collection
						: undefined
	if (collectionId) {
		tags.push(`collection:${formatOrdinalOutpoint(collectionId)}`)
	}

	const app = typeof map?.app === 'string' ? map.app : undefined
	if (app) tags.push(`app:${app}`)

	const typeTag = contentTypeTag(metadata?.contentType)
	if (typeTag) tags.push(typeTag)

	return tags
}

/**
 * Single `type:<mime>` tag. Strips `;…` parameters. No category dual-tag.
 */
export function contentTypeTag(
	contentType: string | undefined,
): string | undefined {
	const base = contentType?.split(';')[0]?.trim()
	if (!base) return undefined
	return `type:${base}`
}

/**
 * @deprecated Use {@link contentTypeTag}. Returns 0–1 tags for spread compat.
 */
export function contentTypeTags(contentType: string | undefined): string[] {
	const t = contentTypeTag(contentType)
	return t ? [t] : []
}

/** Parse MAP `subTypeData` (object or JSON string). */
export function parseMapSubTypeData(
	map: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!map) return undefined
	const raw = map.subTypeData
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		return raw as Record<string, unknown>
	}
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const o = JSON.parse(raw) as unknown
			if (o && typeof o === 'object' && !Array.isArray(o)) {
				return o as Record<string, unknown>
			}
		} catch {
			/* ignore */
		}
	}
	return undefined
}

/** MAP name, falling back to `subTypeData.name`. For CI `name`, not tags. */
export function nameFromMap(
	map: Record<string, unknown> | undefined,
): string | undefined {
	if (!map) return undefined
	if (typeof map.name === 'string' && map.name) return map.name

	const subTypeData = parseMapSubTypeData(map)
	const subName = subTypeData?.name
	return typeof subName === 'string' && subName ? subName : undefined
}

/** Truncate display name for CI. */
export function displayNameForCi(name: string | undefined): string | undefined {
	if (!name?.trim()) return undefined
	return name.trim().slice(0, MAX_NAME_TAG_LENGTH)
}
