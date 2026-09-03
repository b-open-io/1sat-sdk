import { formatOrdinalOutpoint } from '@1sat/types'
import type { WalletOutput } from '@bsv/sdk'

/**
 * Ordinal identity tags to file on a self-kept spend of `source` (BRC-147).
 * - Bare `origin` → `origin:<spent outpoint>` (underscore form)
 * - Copy `origin:…` / `content:…` / `collection:…` / `type:…` / `app:…` / `creator:…`
 * - Does not copy `name:` (display name lives in CI)
 * - Does not include id:, listing markers, or domain flags
 */
export function ordinalSeedTags(source: WalletOutput): string[] {
	const out: string[] = []
	for (const t of source.tags ?? []) {
		if (t === 'origin') {
			const promoted = `origin:${formatOrdinalOutpoint(source.outpoint)}`
			if (!out.includes(promoted)) out.push(promoted)
			continue
		}
		if (t.startsWith('origin:')) {
			const normalized = `origin:${formatOrdinalOutpoint(t.slice(7))}`
			if (!out.includes(normalized)) out.push(normalized)
			continue
		}
		if (t.startsWith('content:')) {
			const normalized = `content:${formatOrdinalOutpoint(t.slice(8))}`
			if (!out.includes(normalized)) out.push(normalized)
			continue
		}
		if (t.startsWith('collection:')) {
			const normalized = `collection:${formatOrdinalOutpoint(t.slice(11))}`
			if (!out.includes(normalized)) out.push(normalized)
			continue
		}
		if (
			t.startsWith('type:') ||
			t.startsWith('app:') ||
			t.startsWith('creator:')
		) {
			if (!out.includes(t)) out.push(t)
		}
	}
	// Drop hierarchical category-only type when a more specific type: exists
	const types = out.filter((t) => t.startsWith('type:'))
	if (types.length > 1) {
		const full = types.filter((t) => t.includes('/'))
		if (full.length > 0) {
			return out.filter((t) => !t.startsWith('type:') || full.includes(t))
		}
	}
	return out
}
