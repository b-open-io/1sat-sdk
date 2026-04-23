import type { WalletOutput } from '@bsv/sdk'

export interface AliasCandidate {
	outpoint: string
	id: string | null
	publishedAt: number | null
}

const PUBLISHED_AT_PREFIX = 'publishedAt:'
const ID_PREFIX = 'id:'

function parseCandidate(output: WalletOutput): AliasCandidate {
	let id: string | null = null
	let publishedAt: number | null = null

	for (const tag of output.tags ?? []) {
		if (tag.startsWith(PUBLISHED_AT_PREFIX)) {
			const raw = tag.slice(PUBLISHED_AT_PREFIX.length)
			const n = Number(raw)
			if (Number.isFinite(n)) publishedAt = n
		} else if (tag.startsWith(ID_PREFIX)) {
			id = tag.slice(ID_PREFIX.length)
		}
	}

	return { outpoint: output.outpoint, id, publishedAt }
}

/**
 * Pick the newest `type:alias` output by `publishedAt:<ms>` tag.
 *
 * Ties break on outpoint lexicographically so two wallets seeing the same
 * set resolve to the same winner. Candidates without a `publishedAt:` tag
 * rank below any candidate that has one; if none have it, falls back to
 * outpoint lex order. Returns null on empty input.
 */
export function pickNewestAlias(
	outputs: WalletOutput[],
): { winner: AliasCandidate; losers: AliasCandidate[] } | null {
	if (outputs.length === 0) return null

	const candidates = outputs.map(parseCandidate)

	candidates.sort((a, b) => {
		const aAt = a.publishedAt
		const bAt = b.publishedAt
		if (aAt !== null && bAt !== null) {
			if (aAt !== bAt) return bAt - aAt
		} else if (aAt !== null) {
			return -1
		} else if (bAt !== null) {
			return 1
		}
		return a.outpoint < b.outpoint ? -1 : a.outpoint > b.outpoint ? 1 : 0
	})

	const [winner, ...losers] = candidates
	return { winner, losers }
}
