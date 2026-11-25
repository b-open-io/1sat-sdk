import { describe, expect, test } from 'bun:test'
import { selectedSweepClasses } from '../src/commands/sweep-classes'

describe('selectedSweepClasses', () => {
	test('default is every transferable class', () => {
		expect([...selectedSweepClasses(undefined, undefined)].sort()).toEqual([
			'bsv',
			'bsv20',
			'bsv21',
			'opns',
			'ordinals',
		])
	})

	test('--only opns,bsv20', () => {
		expect([...selectedSweepClasses('opns,bsv20', undefined)].sort()).toEqual([
			'bsv20',
			'opns',
		])
	})

	test('--skip opns drops names', () => {
		expect(selectedSweepClasses(undefined, 'opns').has('opns')).toBe(false)
		expect(selectedSweepClasses(undefined, 'opns').has('ordinals')).toBe(true)
	})

	test('rejects both flags and unknown names', () => {
		expect(() => selectedSweepClasses('bsv', 'opns')).toThrow(
			/mutually exclusive/,
		)
		expect(() => selectedSweepClasses('nfts', undefined)).toThrow(
			/Unknown --only/,
		)
	})
})
