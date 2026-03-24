import {
	INTERNAL_PAGES,
	type InternalPage,
	type ParsedRoute,
} from '../../shared/url-types'

const TXID_RE = /^[0-9a-fA-F]{64}$/
const OUTPOINT_RE = /^([0-9a-fA-F]{64})_(\d+)$/
const OPNS_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/

/**
 * Hostname heuristic: contains a dot, starts with alphanumeric,
 * and the TLD portion is 2+ alpha chars. Matches things like
 * "example.com", "docs.example.co.uk", but not "hello world".
 */
const HOSTNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}(\/.*)?$/

/** Base URL for the local ORDFS gateway */
export const ORDFS_BASE = 'http://127.0.0.1:8080'

/**
 * Parse a user-entered URL string into a structured route.
 *
 * Handles:
 * - 1sat:// internal pages and on-chain references
 * - ordfs:// on-chain content
 * - Bare outpoints (<64-hex>_<vout> or <64-hex>)
 * - https:// and http:// web URLs
 * - Bare hostnames (example.com)
 * - Everything else as a DuckDuckGo search
 *
 * Returns null for empty/invalid input.
 */
export function parseUrl(input: string): ParsedRoute | null {
	if (input == null || typeof input !== 'string') return null

	const trimmed = input.trim()
	if (trimmed.length === 0) return null

	// ── ai:// scheme ───────────────────────────────────────────────────
	const aiMatch = trimmed.match(/^ai:\/\//i)
	if (aiMatch) {
		const query = trimmed.slice(aiMatch[0].length).trim()
		return { type: 'ai-chat', query }
	}

	// ── 1sat:// scheme ──────────────────────────────────────────────────
	const oneSatMatch = trimmed.match(/^1sat:\/\//i)
	if (oneSatMatch) {
		const body = trimmed.slice(oneSatMatch[0].length)
		return parseOneSatBody(body)
	}

	// ── ordfs:// scheme ─────────────────────────────────────────────────
	const ordfsMatch = trimmed.match(/^ordfs:\/\//i)
	if (ordfsMatch) {
		const body = trimmed.slice(ordfsMatch[0].length)
		return parseOnchainBody(body)
	}

	// ── https:// or http:// ─────────────────────────────────────────────
	if (/^https?:\/\//i.test(trimmed)) {
		return { type: 'web', url: trimmed }
	}

	// ── Bare outpoint: <64-hex>_<vout> ──────────────────────────────────
	const outpointMatch = trimmed.match(OUTPOINT_RE)
	if (outpointMatch) {
		const txid = outpointMatch[1]
		const vout = Number.parseInt(outpointMatch[2], 10)
		return {
			type: 'onchain-outpoint',
			txid,
			vout,
			partition: `${txid}_${vout}`,
		}
	}

	// ── Bare 64-hex txid (default vout 0) ───────────────────────────────
	if (TXID_RE.test(trimmed)) {
		return {
			type: 'onchain-outpoint',
			txid: trimmed,
			vout: 0,
			partition: `${trimmed}_0`,
		}
	}

	// ── Bare hostname (example.com) ─────────────────────────────────────
	if (HOSTNAME_RE.test(trimmed)) {
		return { type: 'web', url: `https://${trimmed}` }
	}

	// ── Fallthrough: search query ───────────────────────────────────────
	const params = new URLSearchParams({ q: trimmed })
	return {
		type: 'search',
		query: trimmed,
		url: `https://duckduckgo.com/?${params.toString()}`,
	}
}

/**
 * Parse the body after `1sat://`. This can be:
 * - An internal page name (wallet/overview, settings, etc.)
 * - An on-chain outpoint (<txid>_<vout>)
 * - An OpNS name
 */
function parseOneSatBody(body: string): ParsedRoute | null {
	if (body.length === 0) return null

	// Split off query string
	const [pathPart, queryPart] = splitQuery(body)

	// Check if the full path matches an internal page
	if (INTERNAL_PAGES.has(pathPart)) {
		return {
			type: 'internal',
			page: pathPart as InternalPage,
			params: parseQueryParams(queryPart),
		}
	}

	// If the path uses a known internal prefix (e.g. "wallet/xyz") but
	// doesn't match any valid page, reject it rather than reinterpreting
	// the prefix as an OpNS name.
	if (pathPart.includes('/')) {
		const prefix = pathPart.slice(0, pathPart.indexOf('/'))
		for (const page of INTERNAL_PAGES) {
			if (page === prefix || page.startsWith(`${prefix}/`)) {
				return null
			}
		}
	}

	// Not an internal page — try on-chain parsing
	return parseOnchainBody(body)
}

/**
 * Parse on-chain body (shared between 1sat:// non-internal and ordfs://).
 * The body may be: <txid>_<vout>[/path], <txid>[/path], or <opns-name>[/path]
 */
function parseOnchainBody(body: string): ParsedRoute | null {
	if (body.length === 0) return null

	// Strip any query string for on-chain routes
	const [pathOnly] = splitQuery(body)

	// Split into segments: first segment is the identifier, rest is subpath
	const slashIdx = pathOnly.indexOf('/')
	const identifier = slashIdx === -1 ? pathOnly : pathOnly.slice(0, slashIdx)
	const subpath = slashIdx === -1 ? undefined : pathOnly.slice(slashIdx)

	// Try outpoint: <txid>_<vout>
	const outpointMatch = identifier.match(OUTPOINT_RE)
	if (outpointMatch) {
		const txid = outpointMatch[1]
		const vout = Number.parseInt(outpointMatch[2], 10)
		return {
			type: 'onchain-outpoint',
			txid,
			vout,
			...(subpath ? { path: subpath } : {}),
			partition: `${txid}_${vout}`,
		}
	}

	// Try bare txid (64 hex chars, no underscore)
	if (TXID_RE.test(identifier)) {
		return {
			type: 'onchain-outpoint',
			txid: identifier,
			vout: 0,
			...(subpath ? { path: subpath } : {}),
			partition: `${identifier}_0`,
		}
	}

	// Try OpNS name
	if (OPNS_NAME_RE.test(identifier)) {
		return {
			type: 'onchain-opns',
			name: identifier,
			...(subpath ? { path: subpath } : {}),
			partition: identifier,
		}
	}

	// Invalid on-chain reference
	return null
}

/** Split a path string on the first `?` into [path, queryString | undefined] */
function splitQuery(input: string): [string, string | undefined] {
	const idx = input.indexOf('?')
	if (idx === -1) return [input, undefined]
	return [input.slice(0, idx), input.slice(idx + 1)]
}

/** Parse a query string into a Record<string, string> */
function parseQueryParams(qs: string | undefined): Record<string, string> {
	if (!qs) return {}
	const params: Record<string, string> = {}
	const searchParams = new URLSearchParams(qs)
	for (const [key, value] of searchParams) {
		params[key] = value
	}
	return params
}
