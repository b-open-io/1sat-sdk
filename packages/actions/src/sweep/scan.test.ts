import { describe, expect, it } from 'bun:test'
import type { IndexedOutput } from '@1sat/types'
import { isListedOutput } from './scan.js'

function out(
	partial: Partial<IndexedOutput> & Pick<IndexedOutput, 'outpoint'>,
): IndexedOutput {
	return { score: 0, ...partial }
}

describe('isListedOutput (OPL-4696)', () => {
	it('detects ordlock event', () => {
		expect(
			isListedOutput(out({ outpoint: 'a.0', events: ['ordlock', 'own:1x'] })),
		).toBe(true)
	})

	it('detects list: event', () => {
		expect(isListedOutput(out({ outpoint: 'a.0', events: ['list:1'] }))).toBe(
			true,
		)
	})

	it('detects data.ordlock', () => {
		expect(
			isListedOutput(
				out({ outpoint: 'a.0', data: { ordlock: { price: 1000 } } }),
			),
		).toBe(true)
	})

	it('ignores plain ordinals and time-locks', () => {
		expect(
			isListedOutput(out({ outpoint: 'a.0', events: ['type:image/png'] })),
		).toBe(false)
		expect(
			isListedOutput(out({ outpoint: 'a.0', events: ['lock:800000'] })),
		).toBe(false)
	})
})
