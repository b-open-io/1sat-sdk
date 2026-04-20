import { describe, expect, test } from 'bun:test'
import {
	BYTES_PER_GB,
	computeCapacity,
	quoteRefundedCharge,
	refundCreditSats,
} from '../src/accounts/pricing'
import type { Payment } from '../src/accounts/types'

const CONFIG = {
	baselineBytes: 1 * BYTES_PER_GB,
	purchaseUnitBytes: 1_073_741_824,
	satsPerUnit: 1_000_000,
	durationBlocks: 4383,
}

function payment(partial: Partial<Payment>): Payment {
	return {
		id: 1,
		identityKey: '02'.padEnd(66, 'a'),
		txid: 'tx',
		bytesCovered: 0,
		satsPaid: 0,
		paidThroughBlock: 0,
		appliedAt: new Date(),
		...partial,
	}
}

describe('pricing.computeCapacity', () => {
	test('under capacity returns zero deficit', () => {
		const r = computeCapacity({
			baselineBytes: 1_000_000_000,
			paidBytes: 0,
			usedBytes: 500_000_000,
		})
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

describe('pricing.quoteRefundedCharge', () => {
	test('returns undefined when used bytes fit baseline + current payment', () => {
		const q = quoteRefundedCharge({
			usedBytes: CONFIG.baselineBytes + BYTES_PER_GB,
			currentPayment: payment({
				bytesCovered: BYTES_PER_GB,
				paidThroughBlock: 5000,
			}),
			currentBlock: 1000,
			config: CONFIG,
		})
		expect(q).toBeUndefined()
	})

	test('no current payment → full charge', () => {
		const q = quoteRefundedCharge({
			usedBytes: CONFIG.baselineBytes + 1,
			currentPayment: undefined,
			currentBlock: 0,
			config: CONFIG,
		})
		expect(q?.unitsCharged).toBe(1)
		expect(q?.fullSats).toBe(1_000_000)
		expect(q?.refundSats).toBe(0)
		expect(q?.chargeSats).toBe(1_000_000)
		expect(q?.paidThroughBlock).toBe(CONFIG.durationBlocks)
	})

	test('credits unused time on current payment', () => {
		// Current payment covered 1 GB at block 0, expires at 4383.
		// At block 1008 (~week 1 of a 4383-block month), ~77% remains.
		const q = quoteRefundedCharge({
			usedBytes: CONFIG.baselineBytes + 2 * BYTES_PER_GB,
			currentPayment: payment({
				bytesCovered: BYTES_PER_GB,
				paidThroughBlock: 4383,
			}),
			currentBlock: 1008,
			config: CONFIG,
		})
		expect(q?.unitsCharged).toBe(2)
		expect(q?.fullSats).toBe(2_000_000)
		// Refund = 1GB × 1M sats × (4383-1008)/4383 = floor(769_906)
		expect(q?.refundSats).toBe(Math.floor((1_000_000 * 3375) / 4383))
		expect(q?.chargeSats).toBe(q!.fullSats - q!.refundSats)
	})

	test('expired current payment has no refund', () => {
		const q = quoteRefundedCharge({
			usedBytes: CONFIG.baselineBytes + BYTES_PER_GB,
			currentPayment: payment({
				bytesCovered: BYTES_PER_GB,
				paidThroughBlock: 500,
			}),
			currentBlock: 1000,
			config: CONFIG,
		})
		expect(q?.refundSats).toBe(0)
		expect(q?.chargeSats).toBe(q?.fullSats)
	})
})

describe('pricing.refundCreditSats', () => {
	test('0 when no payment', () => {
		expect(
			refundCreditSats(undefined, 1000, 4383, BYTES_PER_GB, 1_000_000),
		).toBe(0)
	})

	test('0 when payment expired', () => {
		expect(
			refundCreditSats(
				payment({ bytesCovered: BYTES_PER_GB, paidThroughBlock: 500 }),
				1000,
				4383,
				BYTES_PER_GB,
				1_000_000,
			),
		).toBe(0)
	})

	test('prorates remaining time', () => {
		const credit = refundCreditSats(
			payment({ bytesCovered: BYTES_PER_GB, paidThroughBlock: 4383 }),
			1008,
			4383,
			BYTES_PER_GB,
			1_000_000,
		)
		expect(credit).toBe(Math.floor((1_000_000 * 3375) / 4383))
	})
})
