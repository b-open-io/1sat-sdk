import { describe, expect, test } from 'bun:test'
import {
	type RepriceTarget,
	buildPriceUpdateTask,
} from '../src/repricer/buildPriceUpdateTask'
import type { BsvUsdQuote, RateProvider } from '../src/repricer/types'

function fakeProvider(quotes: BsvUsdQuote[] | Error): RateProvider {
	let i = 0
	return {
		name: 'fake',
		async getBsvUsd() {
			if (quotes instanceof Error) throw quotes
			return quotes[Math.min(i++, quotes.length - 1)]
		},
	}
}

const Q = (bsvUsd: number): BsvUsdQuote => ({
	bsvUsd,
	timestamp: 0,
	source: 'fake',
})

function target(overrides: Partial<RepriceTarget> = {}): RepriceTarget {
	return {
		name: 'accounts',
		targetUsd: 1,
		readCurrentSats: () => 1_900_000,
		onPersist: async () => {},
		...overrides,
	}
}

describe('buildPriceUpdateTask', () => {
	test('trigger respects intervalMs', () => {
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			bounds: { maxMovePct: 100, minSats: 1 },
			targets: [target()],
		})
		task.lastRunMsecsSinceEpoch = 1000
		expect(task.trigger(1500)).toEqual({ run: false })
		expect(task.trigger(2000)).toEqual({ run: true })
	})

	test('runTask persists new value', async () => {
		let persisted: number | undefined
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			bounds: { maxMovePct: 100, minSats: 1 },
			targets: [
				target({
					onPersist: async (sats) => {
						persisted = sats
					},
				}),
			],
		})
		await task.runTask()
		expect(persisted).toBe(2_000_000)
	})

	test('runTask reprices every target from one quote', async () => {
		const persisted: Record<string, number> = {}
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			bounds: { maxMovePct: 100, minSats: 1 },
			targets: [
				target({
					name: 'accounts',
					targetUsd: 1,
					onPersist: async (sats) => {
						persisted.accounts = sats
					},
				}),
				target({
					name: 'hosting',
					targetUsd: 5,
					readCurrentSats: () => 9_000_000,
					onPersist: async (sats) => {
						persisted.hosting = sats
					},
				}),
			],
		})
		const msg = await task.runTask()
		expect(persisted.accounts).toBe(2_000_000)
		expect(persisted.hosting).toBe(10_000_000)
		expect(msg).toContain('accounts')
		expect(msg).toContain('hosting')
	})

	test('a skipped target does not block the other target', async () => {
		let hostingPersisted: number | undefined
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			bounds: { maxMovePct: 10, minSats: 1 },
			targets: [
				// 1M → 2M is +100%, exceeds maxMovePct → skipped
				target({ name: 'accounts', readCurrentSats: () => 1_000_000 }),
				target({
					name: 'hosting',
					targetUsd: 5,
					readCurrentSats: () => 9_800_000,
					onPersist: async (sats) => {
						hostingPersisted = sats
					},
				}),
			],
		})
		const msg = await task.runTask()
		expect(msg).toMatch(/accounts: skipped/i)
		expect(hostingPersisted).toBe(10_000_000)
	})

	test('rate fetch failure does not throw', async () => {
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider(new Error('boom')),
			intervalMs: 1000,
			bounds: { maxMovePct: 100, minSats: 1 },
			targets: [target()],
		})
		const msg = await task.runTask()
		expect(msg).toMatch(/boom|failed/i)
	})

	test('trigger is no-op with no positive targets', () => {
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			bounds: { maxMovePct: 100, minSats: 1 },
			targets: [target({ targetUsd: 0 })],
		})
		task.lastRunMsecsSinceEpoch = 0
		expect(task.trigger(Date.now())).toEqual({ run: false })
	})

	test('task name is "PriceUpdate"', () => {
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			bounds: { maxMovePct: 100, minSats: 1 },
			targets: [target()],
		})
		expect(task.name).toBe('PriceUpdate')
	})
})
