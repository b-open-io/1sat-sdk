import { describe, expect, test } from 'bun:test'
import {
	P1SAT_LABEL,
	buildActionDispatchLabel,
	buildExternalInputLabel,
	buildInputAssetLabel,
	ensureSchemeActionLabel,
	hasAssetDispatchLabel,
	hasSchemeDispatchLabel,
	parseInputAssetLabels,
	parseOneInputLabel,
} from './constants.js'

describe('scheme dispatch labels', () => {
	test('buildActionDispatchLabel', () => {
		expect(buildActionDispatchLabel('1sat')).toBe('p 1sat action')
		expect(buildActionDispatchLabel('opns')).toBe('p opns action')
		expect(P1SAT_LABEL).toBe('p 1sat action')
	})

	test('hasSchemeDispatchLabel / hasAssetDispatchLabel', () => {
		expect(hasSchemeDispatchLabel([P1SAT_LABEL], '1sat')).toBe(true)
		expect(hasSchemeDispatchLabel(['p opns input id abc'], 'opns')).toBe(true)
		expect(hasSchemeDispatchLabel(['p opns input id abc'], '1sat')).toBe(false)
		expect(hasAssetDispatchLabel(['p bsv21 action'])).toBe(true)
		expect(hasAssetDispatchLabel(['p 1sat'])).toBe(false)
		expect(hasAssetDispatchLabel(undefined)).toBe(false)
	})

	test('ensureSchemeActionLabel', () => {
		expect(ensureSchemeActionLabel(undefined, '1sat')).toEqual([P1SAT_LABEL])
		expect(ensureSchemeActionLabel(['other'], 'opns')).toEqual([
			'other',
			'p opns action',
		])
		expect(ensureSchemeActionLabel([P1SAT_LABEL], '1sat')).toEqual([
			P1SAT_LABEL,
		])
	})
})

describe('input labels', () => {
	test('held: p <scheme> input id <key>', () => {
		const label = buildInputAssetLabel('1sat', 'id1')
		expect(label).toBe('p 1sat input id id1')
		expect(parseInputAssetLabels([label])).toEqual([
			{ scheme: '1sat', basket: '1sat', id: 'id1' },
		])
	})

	test('opns / bsv21', () => {
		expect(buildInputAssetLabel('opns', 'abc')).toBe('p opns input id abc')
		expect(buildInputAssetLabel('bsv21', 'tok')).toBe('p bsv21 input id tok')
		expect(parseInputAssetLabels(['p opns input id abc'])).toEqual([
			{ scheme: 'opns', basket: 'opns', id: 'abc' },
		])
	})

	test('rejects legacy basket-middle and bare-key forms', () => {
		expect(parseOneInputLabel('p 1sat input opns oldid')).toBeUndefined()
		expect(parseOneInputLabel('p 1sat input barekey')).toBeUndefined()
		expect(parseInputAssetLabels(['p 1sat input opns oldid'])).toEqual([])
	})

	test('external: p <scheme> input <outpoint>', () => {
		const op = `${'aa'.repeat(32)}.0`
		const label = buildExternalInputLabel('1sat', op)
		expect(label).toBe(`p 1sat input ${op}`)
		expect(parseOneInputLabel(label)).toEqual({
			kind: 'outpoint',
			scheme: '1sat',
			outpoint: op,
		})
	})
})
