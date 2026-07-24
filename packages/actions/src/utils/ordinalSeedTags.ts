import type { WalletOutput } from '@bsv/sdk'

/**
 * Ordinal identity tags to file on a self-kept spend of `source`.
 * Bare `origin` promotes to `origin:<source.outpoint>`.
 * Does not include id:, listing markers, or domain flags (opns:published, …).
 */
export function ordinalSeedTags(source: WalletOutput): string[] {
	const out: string[] = []
	for (const t of source.tags ?? []) {
		if (t === 'origin') {
			const promoted = `origin:${source.outpoint}`
			if (!out.includes(promoted)) out.push(promoted)
			continue
		}
		if (
			t.startsWith('origin:') ||
			t.startsWith('type:') ||
			t.startsWith('name:')
		) {
			if (!out.includes(t)) out.push(t)
		}
	}
	return out
}
