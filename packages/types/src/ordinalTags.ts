import type { OrdfsMetadata } from './services'

/** Longest `name:` tag value we store. */
export const MAX_NAME_TAG_LENGTH = 64

/**
 * Canonical identity tags for an ordinal, derived from ORDFS metadata.
 *
 * The single place that decides what tags an ordinal carries. Every path that
 * reads from ORDFS — `resolveOrdinalTags` in actions, the wallet's
 * `OriginIndexer`, the permission module's verification — must go through
 * here, so an asset is tagged identically whether it arrived by sync, by
 * purchase, or by transfer.
 *
 * Pure: callers fetch through their own services and pass the result in.
 *
 * Emits:
 * - `origin:<outpoint>` — the resolved genesis. **Omitted entirely when
 *   unknown**; an empty `origin:` reads as a resolved value and is never
 *   correct. The bare `origin` marker is a separate thing, set only on the
 *   inscription transaction itself, where the output cannot know its own
 *   outpoint.
 * - `type:<category>` **and** `type:<base>` — hierarchical, so callers can
 *   query broadly (`type:image`) or exactly (`type:image/png`).
 * - `name:<name>` — from MAP `name`, else `subTypeData.name`, truncated.
 *
 * @param metadata - ORDFS metadata, resolved at seq `-2`
 * @param fallbackOrigin - used only when metadata carries no origin
 */
export function ordinalTagsFromMetadata(
	metadata: Partial<OrdfsMetadata> | undefined,
	fallbackOrigin?: string,
): string[] {
	const tags: string[] = []

	const origin = metadata?.origin || fallbackOrigin
	if (origin) tags.push(`origin:${origin}`)

	for (const t of contentTypeTags(metadata?.contentType)) tags.push(t)

	const name = nameFromMap(metadata?.map)
	if (name) tags.push(`name:${name.slice(0, MAX_NAME_TAG_LENGTH)}`)

	return tags
}

/**
 * Hierarchical `type:` tags for a content type.
 *
 * `image/png; charset=x` yields `type:image` and `type:image/png`. Returns
 * empty for a missing or blank content type — an empty `type:` is never useful.
 */
export function contentTypeTags(contentType: string | undefined): string[] {
	const base = contentType?.split(';')[0]?.trim()
	if (!base) return []

	const category = base.split('/')[0]
	return category && category !== base
		? [`type:${category}`, `type:${base}`]
		: [`type:${base}`]
}

/** MAP name, falling back to `subTypeData.name`. */
export function nameFromMap(
	map: Record<string, unknown> | undefined,
): string | undefined {
	if (!map) return undefined
	if (typeof map.name === 'string' && map.name) return map.name

	const subTypeData = map.subTypeData as Record<string, unknown> | undefined
	const subName = subTypeData?.name
	return typeof subName === 'string' && subName ? subName : undefined
}
