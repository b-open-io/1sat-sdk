import { describe, expect, test } from 'bun:test'
import { buildPriceUpdateTask } from '../src/repricer/buildPriceUpdateTask'
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

describe('buildPriceUpdateTask', () => {
	test('trigger respects intervalMs', () => {
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			targetUsd: 1,
			bounds: { maxMovePct: 100, minSats: 1 },
			readCurrentSats: () => 2_000_000,
			onPersist: async () => {},
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
			targetUsd: 1,
			bounds: { maxMovePct: 100, minSats: 1 },
			readCurrentSats: () => 1_900_000,
			onPersist: async (sats) => {
				persisted = sats
			},
		})
		await task.runTask()
		expect(persisted).toBe(2_000_000)
	})

	test('runTask does not persist when compute skips', async () => {
		let persisted = false
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			targetUsd: 1,
			bounds: { maxMovePct: 10, minSats: 1 }, // 1M → 2M is +100%, skipped
			readCurrentSats: () => 1_000_000,
			onPersist: async () => {
				persisted = true
			},
		})
		const msg = await task.runTask()
		expect(persisted).toBe(false)
		expect(msg).toMatch(/skip|maxMovePct/i)
	})

	test('rate fetch failure does not throw', async () => {
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider(new Error('boom')),
			intervalMs: 1000,
			targetUsd: 1,
			bounds: { maxMovePct: 100, minSats: 1 },
			readCurrentSats: () => 1_000_000,
			onPersist: async () => {},
		})
		const msg = await task.runTask()
		expect(msg).toMatch(/boom|failed/i)
	})

	test('trigger is no-op when targetUsd is 0', () => {
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			targetUsd: 0,
			bounds: { maxMovePct: 100, minSats: 1 },
			readCurrentSats: () => 1_000_000,
			onPersist: async () => {},
		})
		task.lastRunMsecsSinceEpoch = 0
		expect(task.trigger(Date.now())).toEqual({ run: false })
	})

	test('task name is "PriceUpdate"', () => {
		const task = buildPriceUpdateTask({
			monitor: {},
			rateProvider: fakeProvider([Q(50)]),
			intervalMs: 1000,
			targetUsd: 1,
			bounds: { maxMovePct: 100, minSats: 1 },
			readCurrentSats: () => 1_000_000,
			onPersist: async () => {},
		})
		expect(task.name).toBe('PriceUpdate')
	})
})
