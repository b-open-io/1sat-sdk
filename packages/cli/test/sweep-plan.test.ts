import { describe, expect, test } from 'bun:test'
import type { ScanResult } from '@1sat/actions'
import { selectedSweepClasses } from '../src/commands/sweep-classes'
import { buildSweepPlan, planHasWork } from '../src/commands/sweep-plan'

function scan(partial: Partial<ScanResult>): ScanResult {
	return {
		funding: [],
		ordinals: [],
		opnsNames: [],
		bsv21Tokens: [],
		bsv20Tokens: [],
		locked: [],
		run: [],
		listings: [],
		totalFundingSats: 0,
		...partial,
	}
}

describe('buildSweepPlan', () => {
	test('listed OrdLocks stay in their class, not a separate sweep class', () => {
		const listedOpns = {
			outpoint: 'a.0',
			satoshis: 1,
			score: 0,
			events: ['ordlock', 'type:application/op-ns'],
		}
		const plan = buildSweepPlan(
			scan({
				opnsNames: [listedOpns],
				listings: [listedOpns],
			}),
			selectedSweepClasses(undefined, undefined),
		)
		expect(plan.opns).toEqual({ count: 1, listed: 1 })
		expect(plan.ordinals.count).toBe(0)
		expect(planHasWork(plan)).toBe(true)
	})

	test('--skip opns leaves a listed name unswept', () => {
		const listedOpns = {
			outpoint: 'a.0',
			satoshis: 1,
			score: 0,
			events: ['ordlock', 'type:application/op-ns'],
		}
		const plan = buildSweepPlan(
			scan({ opnsNames: [listedOpns], listings: [listedOpns] }),
			selectedSweepClasses(undefined, 'opns'),
		)
		expect(plan.opns).toEqual({ count: 0, listed: 0 })
		expect(planHasWork(plan)).toBe(false)
	})
})
