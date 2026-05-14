import { describe, expect, test } from 'bun:test'
import type { AccountsConfig } from '@1sat/wallet-server'
import { createAccountsConfigLoader } from '../src/repricer/configLoader'

function fakeBase(): AccountsConfig {
	return {
		enabled: true,
		baselineBytes: 1_073_741_824,
		purchaseUnitBytes: 1_073_741_824,
		satsPerUnit: 1_000_000,
		durationBlocks: 4383,
		freeIdentityKeys: [],
	}
}

describe('createAccountsConfigLoader', () => {
	test('reads fresh on first call', () => {
		let reads = 0
		const loader = createAccountsConfigLoader({
			ttlMs: 60_000,
			read: () => {
				reads++
				return fakeBase()
			},
			now: () => 1000,
		})
		const cfg = loader()
		expect(cfg.satsPerUnit).toBe(1_000_000)
		expect(reads).toBe(1)
	})

	test('returns cached within TTL', () => {
		let reads = 0
		const loader = createAccountsConfigLoader({
			ttlMs: 60_000,
			read: () => {
				reads++
				return fakeBase()
			},
			now: () => 1000,
		})
		loader()
		loader()
		loader()
		expect(reads).toBe(1)
	})

	test('refreshes after TTL', () => {
		let reads = 0
		let t = 1000
		const loader = createAccountsConfigLoader({
			ttlMs: 60_000,
			read: () => {
				reads++
				return fakeBase()
			},
			now: () => t,
		})
		loader()
		t = 60_999
		loader()
		expect(reads).toBe(1)
		t = 61_001
		loader()
		expect(reads).toBe(2)
	})

	test('serves last good value when read throws', () => {
		let calls = 0
		const loader = createAccountsConfigLoader({
			ttlMs: 1,
			read: () => {
				calls++
				if (calls === 1) return fakeBase()
				throw new Error('disk gone')
			},
			now: () => calls * 100,
		})
		const first = loader()
		const second = loader()
		expect(second.satsPerUnit).toBe(first.satsPerUnit)
	})
})
