import { displayNameForCi, formatOrdinalOutpoint } from '@1sat/types'

/**
 * BRC-147 load-bearing remittance fields mirrored from filter tags
 * (origin / content / app / collection). Outpoint values normalized to `_`.
 */
export function remittanceFromOrdinalTags(tags: string[] | undefined): {
	origin?: string
	content?: string
	app?: string
	collection?: string
} {
	if (!tags?.length) return {}
	let origin: string | undefined
	let content: string | undefined
	let app: string | undefined
	let collection: string | undefined
	for (const t of tags) {
		const n = t.trim()
		if (n.startsWith('origin:') && !origin) {
			origin = formatOrdinalOutpoint(n.slice(7))
		} else if (n.startsWith('content:') && !content) {
			content = formatOrdinalOutpoint(n.slice(8))
		} else if (n.startsWith('app:') && !app) {
			app = n.slice(4)
		} else if (n.startsWith('collection:') && !collection) {
			collection = formatOrdinalOutpoint(n.slice(11))
		}
	}
	return {
		...(origin && { origin }),
		...(content && { content }),
		...(app && { app }),
		...(collection && { collection }),
	}
}

/** Spend-derivation CI plus BRC-147 remittance dual-stamped from tags. */
export function buildOrdinalCustomInstructions(opts: {
	protocolID: unknown
	keyID: string
	counterparty?: string
	tags?: string[]
	name?: string
	/** Extra fields merged last (e.g. listing metadata). */
	extra?: Record<string, unknown>
}): string {
	const name = displayNameForCi(opts.name)
	return JSON.stringify({
		protocolID: opts.protocolID,
		keyID: opts.keyID,
		...(opts.counterparty !== undefined && {
			counterparty: opts.counterparty,
		}),
		...remittanceFromOrdinalTags(opts.tags),
		...(name && { name }),
		...opts.extra,
	})
}

export type OrdinalRemittanceFields = {
	origin?: string
	content?: string
	app?: string
	collection?: string
	name?: string
}

/**
 * Overwrite BRC-147 remittance fields on existing CI JSON.
 * Keeps derivation and any other keys. Only sets fields present on `auth`.
 */
export function overwriteOrdinalCiFields(
	existingJson: string,
	auth: OrdinalRemittanceFields,
): string {
	const o = JSON.parse(existingJson) as Record<string, unknown>
	if (auth.origin !== undefined) o.origin = auth.origin
	if (auth.content !== undefined) o.content = auth.content
	if (auth.app !== undefined) o.app = auth.app
	if (auth.collection !== undefined) o.collection = auth.collection
	if (auth.name !== undefined) {
		const n = displayNameForCi(auth.name)
		if (n) o.name = n
	}
	return JSON.stringify(o)
}
