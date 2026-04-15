import type { Bookmark } from '../hooks/use-bookmarks'

export type InputClassification =
	| { type: 'app-match'; apps: Bookmark[] }
	| { type: 'url'; url: string }
	| { type: 'outpoint'; txid: string; vout: number }
	| { type: 'internal'; page: string }
	| { type: 'ai-query'; text: string }

const OUTPOINT_RE = /^([0-9a-f]{64})_(\d+)$/i
const SCHEME_RE = /^(https?|ordfs):\/\//
const INTERNAL_RE = /^1sat:\/\/(.+)$/
const AI_SCHEME_RE = /^ai:\/\//

function fuzzyMatch(query: string, bookmark: Bookmark): boolean {
	const q = query.toLowerCase()
	const title = bookmark.title.toLowerCase()
	const domain = bookmark.url
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '')
		.toLowerCase()
	return title.includes(q) || domain.includes(q)
}

function looksLikeHostname(text: string): boolean {
	return /^[^\s]+\.[a-z]{2,}$/i.test(text) && !text.includes(' ')
}

export function classifyInput(
	text: string,
	bookmarks: Bookmark[],
): InputClassification {
	const trimmed = text.trim()

	if (!trimmed) return { type: 'ai-query', text: '' }

	// 1. Check bookmark fuzzy matches first
	const matches = bookmarks.filter((b) => fuzzyMatch(trimmed, b))
	if (matches.length > 0) return { type: 'app-match', apps: matches }

	// 2. Scheme URLs (https://, http://, ordfs://)
	if (SCHEME_RE.test(trimmed)) return { type: 'url', url: trimmed }

	// 3. AI scheme
	if (AI_SCHEME_RE.test(trimmed)) return { type: 'url', url: trimmed }

	// 4. Internal pages (1sat://)
	const internalMatch = trimmed.match(INTERNAL_RE)
	if (internalMatch) return { type: 'internal', page: internalMatch[1] }

	// 5. Outpoint (64 hex _ number)
	const outpointMatch = trimmed.match(OUTPOINT_RE)
	if (outpointMatch)
		return {
			type: 'outpoint',
			txid: outpointMatch[1],
			vout: Number(outpointMatch[2]),
		}

	// 6. Hostname-like (contains dot, no spaces)
	if (looksLikeHostname(trimmed))
		return { type: 'url', url: `https://${trimmed}` }

	// 7. Natural language fallback
	return { type: 'ai-query', text: trimmed }
}

/**
 * Secondary classification that skips bookmark matching.
 * Used when bookmarks already matched — provides the URL/outpoint/AI
 * suggestion that should show alongside the app grid.
 */
export function classifyInputSecondary(
	text: string,
): InputClassification | null {
	const trimmed = text.trim()
	if (!trimmed) return null

	if (SCHEME_RE.test(trimmed)) return { type: 'url', url: trimmed }
	if (AI_SCHEME_RE.test(trimmed)) return { type: 'url', url: trimmed }

	const internalMatch = trimmed.match(INTERNAL_RE)
	if (internalMatch) return { type: 'internal', page: internalMatch[1] }

	const outpointMatch = trimmed.match(OUTPOINT_RE)
	if (outpointMatch)
		return {
			type: 'outpoint',
			txid: outpointMatch[1],
			vout: Number(outpointMatch[2]),
		}

	if (looksLikeHostname(trimmed))
		return { type: 'url', url: `https://${trimmed}` }

	return null
}
