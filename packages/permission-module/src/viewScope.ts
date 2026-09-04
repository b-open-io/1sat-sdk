import type { PermissionSchemeId } from '@1sat/types'
import { basketForScheme } from '@1sat/types'

/** Parsed view scope from a `p <scheme> …` basket name (BRC-165 for `1sat`). */
export type ViewScope =
	| { kind: 'all' }
	| { kind: 'collection' }
	| { kind: 'app' }
	| { kind: 'creator' }
	| { kind: 'id' }

export type ParseViewBasketResult =
	| {
			ok: true
			schemeId: PermissionSchemeId
			storageBasket: string
			/** Canonical permission basket name used as grant key (axis only). */
			grantBasket: string
			scope: ViewScope
			/** Tag prefix required on the request for non-all scopes. */
			axisPrefix?: 'collection:' | 'app:' | 'creator:' | 'id:'
			/** When true, skip standing view-grant prompts (single-row id lookup). */
			autoAllowView?: boolean
	  }
	| { ok: false; error: string }

const SCOPES = new Set(['all', 'collection', 'app', 'creator', 'id'])

/**
 * Parse a listOutputs basket for a permission scheme.
 *
 * BRC-165 (`1sat`): scope required — axis only in the basket name.
 * Filter values come from tags (`collection:…`, `app:…`, `creator:…`).
 *
 * Other schemes: `p <scheme> all` or bare `p <scheme>` → all.
 */
export function parseViewBasket(
	schemeId: PermissionSchemeId,
	basket: string,
): ParseViewBasketResult {
	const raw = basket.trim().toLowerCase()
	const prefix = `p ${schemeId}`
	if (raw !== prefix && !raw.startsWith(`${prefix} `)) {
		return { ok: false, error: `not a p ${schemeId} basket` }
	}

	const rest = raw === prefix ? '' : raw.slice(prefix.length).trim()
	const storageBasket = basketForScheme(schemeId)

	if (schemeId !== '1sat') {
		if (rest === '' || rest === 'all') {
			return {
				ok: true,
				schemeId,
				storageBasket,
				grantBasket: `${prefix} all`,
				scope: { kind: 'all' },
			}
		}
		return {
			ok: false,
			error: `Unknown p ${schemeId} scope "${rest}" (only "all" is supported)`,
		}
	}

	if (rest === '') {
		return {
			ok: false,
			error:
				'p 1sat requires a scope (use "p 1sat all|collection|app|creator|id")',
		}
	}

	// Exactly one scope token — no values in the basket name
	if (/\s/.test(rest) || !SCOPES.has(rest)) {
		return {
			ok: false,
			error: `Invalid p 1sat scope "${rest}" (expected all|collection|app|creator|id; values go in tags)`,
		}
	}

	const kind = rest as ViewScope['kind']
	const grantBasket = `p 1sat ${kind}`
	if (kind === 'all') {
		return {
			ok: true,
			schemeId,
			storageBasket,
			grantBasket,
			scope: { kind: 'all' },
		}
	}

	return {
		ok: true,
		schemeId,
		storageBasket,
		grantBasket,
		scope: { kind },
		axisPrefix: `${kind}:`,
		...(kind === 'id' ? { autoAllowView: true } : {}),
	}
}

/** Axis tag values on the request for a given prefix (e.g. `collection:`). */
export function axisTagValues(
	tags: string[] | undefined,
	prefix: string,
): string[] {
	if (!tags?.length) return []
	const out: string[] = []
	const p = prefix.toLowerCase()
	for (const t of tags) {
		const n = t.trim().toLowerCase()
		if (n.startsWith(p) && n.length > p.length) {
			out.push(n.slice(p.length))
		}
	}
	return out
}

/**
 * Permission-store key for a view grant.
 * - `p 1sat all` — full inventory
 * - `p 1sat collection` — legacy whole-axis (any collection value)
 * - `p 1sat collection <value>` — one allowed tag value
 */
export function viewGrantKey(axisBasket: string, value?: string): string {
	const axis = axisBasket.trim().toLowerCase()
	if (!value) return axis
	return `${axis} ${value.trim().toLowerCase()}`
}

/** True if a stored grant key covers this axis (+ optional value). */
export function grantCoversView(
	grantedKey: string,
	axisBasket: string,
	value?: string,
): boolean {
	const g = grantedKey.trim().toLowerCase()
	const axis = axisBasket.trim().toLowerCase()
	const allMatch = /^p ([a-z0-9]+) all$/.exec(g)
	if (allMatch) {
		const scheme = allMatch[1]
		return axis === `p ${scheme} all` || axis.startsWith(`p ${scheme} `)
	}
	if (g === axis) return true
	if (value !== undefined && g === viewGrantKey(axis, value)) return true
	return false
}

/** @deprecated Prefer {@link grantCoversView}. */
export function grantCoversScope(
	grantedBasket: string,
	requestedGrantBasket: string,
): boolean {
	return grantCoversView(grantedBasket, requestedGrantBasket)
}
