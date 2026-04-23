import { describe, expect, test } from 'bun:test'
import type { WalletOutput } from '@bsv/sdk'
import { pickNewestAlias } from '../src/identity/pickNewestAlias'

function out(outpoint: string, tags: string[]): WalletOutput {
	return { satoshis: 0, spendable: true, outpoint, tags }
}

describe('pickNewestAlias', () => {
	test('returns null for empty input', () => {
		expect(pickNewestAlias([])).toBeNull()
	})

	test('picks the highest publishedAt', () => {
		const a = out('aaaa.0', ['type:alias', 'id:A', 'publishedAt:1000'])
		const b = out('bbbb.0', ['type:alias', 'id:B', 'publishedAt:3000'])
		const c = out('cccc.0', ['type:alias', 'id:C', 'publishedAt:2000'])

		const result = pickNewestAlias([a, b, c])
		expect(result).not.toBeNull()
		expect(result!.winner.id).toBe('B')
		expect(result!.winner.publishedAt).toBe(3000)
		expect(result!.losers.map((l) => l.id)).toEqual(['C', 'A'])
	})

	test('untagged candidates rank below any tagged candidate', () => {
		const tagged = out('aaaa.0', ['type:alias', 'id:A', 'publishedAt:500'])
		const untagged = out('bbbb.0', ['type:alias', 'id:B'])

		const result = pickNewestAlias([untagged, tagged])
		expect(result!.winner.id).toBe('A')
		expect(result!.losers[0].id).toBe('B')
	})

	test('falls back to lexicographic outpoint when no tags have publishedAt', () => {
		const a = out('bbbb.0', ['type:alias', 'id:B'])
		const b = out('aaaa.0', ['type:alias', 'id:A'])

		const result = pickNewestAlias([a, b])
		expect(result!.winner.id).toBe('A')
		expect(result!.winner.outpoint).toBe('aaaa.0')
	})

	test('ties on publishedAt break on outpoint', () => {
		const a = out('bbbb.0', ['type:alias', 'id:B', 'publishedAt:1000'])
		const b = out('aaaa.0', ['type:alias', 'id:A', 'publishedAt:1000'])

		const result = pickNewestAlias([a, b])
		expect(result!.winner.id).toBe('A')
	})

	test('malformed publishedAt values are ignored', () => {
		const good = out('aaaa.0', ['type:alias', 'id:A', 'publishedAt:1000'])
		const bad = out('bbbb.0', [
			'type:alias',
			'id:B',
			'publishedAt:not-a-number',
		])

		const result = pickNewestAlias([good, bad])
		expect(result!.winner.id).toBe('A')
	})

	test('missing id tag does not crash', () => {
		const o = out('aaaa.0', ['type:alias', 'publishedAt:1000'])
		const result = pickNewestAlias([o])
		expect(result!.winner.id).toBeNull()
		expect(result!.winner.publishedAt).toBe(1000)
	})
})
