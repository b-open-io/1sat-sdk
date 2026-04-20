import { describe, expect, test } from 'bun:test'
import {
	BYTES_PER_GB,
	computeCapacity,
	priceForDeficit,
	quoteForAccount,
} from '../src/accounts/pricing'

describe('pricing.computeCapacity', () => {
	test('under capacity returns zero deficit', () => {
		const r = computeCapacity({
			baselineBytes: 1_000_000_000,
			paidBytes: 0,
			usedBytes: 500_000_000,
		})
		expect(r.capacityBytes).toBe(1_000_000_000)
		expect(r.deficitBytes).toBe(0)
	})

	test('paid bytes add to capacity', () => {
		const r = computeCapacity({
			baselineBytes: 1_000_000_000,
			paidBytes: BYTES_PER_GB,
			usedBytes: 1_100_000_000,
		})
		expect(r.capacityBytes).toBe(1_000_000_000 + BYTES_PER_GB)
		expect(r.deficitBytes).toBe(0)
	})

	test('over capacity reports deficit', () => {
		const r = computeCapacity({
			baselineBytes: 1_000_000,
			paidBytes: 0,
			usedBytes: 3_000_000,
		})
		expect(r.deficitBytes).toBe(2_000_000)
	})
})

describe('pricing.priceForDeficit', () => {
	test('no deficit → no charge', () => {
		const q = priceForDeficit(0, 1_000_000)
		expect(q.satoshisRequired).toBe(0)
		expect(q.gigabytesCharged).toBe(0)
		expect(q.bytesCovered).toBe(0)
	})

	test('sub-GB deficit rounds up to 1 GB', () => {
		const q = priceForDeficit(1024, 1_000_000)
		expect(q.gigabytesCharged).toBe(1)
		expect(q.satoshisRequired).toBe(1_000_000)
		expect(q.bytesCovered).toBe(BYTES_PER_GB)
	})

	test('2.5 GB deficit charges 3 GB', () => {
		const q = priceForDeficit(2.5 * BYTES_PER_GB, 1_000_000)
		expect(q.gigabytesCharged).toBe(3)
		expect(q.satoshisRequired).toBe(3_000_000)
		expect(q.bytesCovered).toBe(3 * BYTES_PER_GB)
	})
})

describe('pricing.quoteForAccount', () => {
	test('wraps priceForDeficit using account config', () => {
		const q = quoteForAccount(
			{
				enabled: true,
				baselineBytes: 0,
				satsPerGb: 1_000_000,
				durationBlocks: 4383,
			},
			{
				baselineBytes: 0,
				paidBytes: 0,
				capacityBytes: 0,
				usedBytes: BYTES_PER_GB,
				deficitBytes: BYTES_PER_GB,
			},
		)
		expect(q.satoshisRequired).toBe(1_000_000)
		expect(q.bytesCovered).toBe(BYTES_PER_GB)
	})
})
