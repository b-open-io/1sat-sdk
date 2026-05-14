import { describe, expect, test } from 'bun:test'
import { computeReprice } from '../src/repricer/computeReprice'
import type { RepricerBounds } from '../src/repricer/types'

const DEFAULT_BOUNDS: RepricerBounds = { maxMovePct: 25, minSats: 1 }

describe('computeReprice', () => {
	test('$1 target at $50/BSV → 2_000_000 sats', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 50,
			currentSats: 2_000_000,
			bounds: DEFAULT_BOUNDS,
		})
		expect(r).toEqual({ status: 'ok', newSats: 2_000_000 })
	})

	test('rounds to nearest integer sats', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 30,
			currentSats: 3_333_333,
			bounds: DEFAULT_BOUNDS,
		})
		expect(r.status).toBe('ok')
	})

	test('skips when move exceeds maxMovePct', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 50,
			currentSats: 1_000_000, // would compute 2_000_000, +100%
			bounds: DEFAULT_BOUNDS,
		})
		expect(r.status).toBe('skipped')
		if (r.status === 'skipped') expect(r.reason).toMatch(/maxMovePct/)
	})

	test('skips when below minSats', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 1000, // computes 100_000
			currentSats: 100_000,
			bounds: { maxMovePct: 100, minSats: 200_000 },
		})
		expect(r.status).toBe('skipped')
	})

	test('rejects non-positive bsvUsd', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 0,
			currentSats: 1_000_000,
			bounds: DEFAULT_BOUNDS,
		})
		expect(r.status).toBe('skipped')
	})

	test('rejects non-positive targetUsd', () => {
		const r = computeReprice({
			targetUsd: 0,
			bsvUsd: 50,
			currentSats: 1_000_000,
			bounds: DEFAULT_BOUNDS,
		})
		expect(r.status).toBe('skipped')
	})

	test('accepts no-op (same value)', () => {
		const r = computeReprice({
			targetUsd: 1,
			bsvUsd: 50,
			currentSats: 2_000_000,
			bounds: DEFAULT_BOUNDS,
		})
		expect(r).toEqual({ status: 'ok', newSats: 2_000_000 })
	})
})
