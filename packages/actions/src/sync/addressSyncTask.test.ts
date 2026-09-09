import { describe, expect, test } from 'bun:test'
import {
	ADDRESS_SYNC_TASK_NAME,
	DEFAULT_ADDRESS_SYNC_INTERVAL_MS,
	buildAddressSyncTask,
} from './addressSyncTask.js'

describe('buildAddressSyncTask', () => {
	test('is due when lastRun is 0', () => {
		const task = buildAddressSyncTask({ storage: {} }, 60_000, {
			run: async () => {},
		})
		expect(task.name).toBe(ADDRESS_SYNC_TASK_NAME)
		expect(task.trigger(Date.now()).run).toBe(true)
	})

	test('no-ops until the interval elapses', () => {
		const task = buildAddressSyncTask({ storage: {} }, 60_000, {
			run: async () => {},
		})
		const now = 1_000_000
		task.lastRunMsecsSinceEpoch = now
		expect(task.trigger(now + 59_000).run).toBe(false)
		expect(task.trigger(now + 60_000).run).toBe(true)
	})

	test('runTask reports success and failure', async () => {
		const ok = buildAddressSyncTask({ storage: {} }, DEFAULT_ADDRESS_SYNC_INTERVAL_MS, {
			run: async () => {},
		})
		expect(await ok.runTask()).toBe('sync complete')

		const bad = buildAddressSyncTask({ storage: {} }, DEFAULT_ADDRESS_SYNC_INTERVAL_MS, {
			run: async () => {
				throw new Error('junglebus down')
			},
		})
		expect(await bad.runTask()).toBe('sync failed: junglebus down')
	})
})
