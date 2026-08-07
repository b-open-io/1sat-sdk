import { describe, expect, test } from 'bun:test'
import {
	P1SAT_INTENTS,
	P1SAT_INTENT_LABEL_PREFIX,
	P1SAT_LABEL,
	buildInputAssetLabel,
	buildIntentLabel,
	ensureP1SatActionLabel,
	hasP1SatDispatchLabel,
	parseInputAssetLabels,
	parseIntentLabel,
} from './constants'

describe('intent labels', () => {
	test('build / parse round-trip', () => {
		const label = buildIntentLabel(P1SAT_INTENTS.OPNS_REGISTER)
		expect(label).toBe(`${P1SAT_INTENT_LABEL_PREFIX}opns.register`)
		expect(parseIntentLabel([label, 'other'])).toBe('opns.register')
	})

	test('hasP1SatDispatchLabel accepts any p 1sat payload label', () => {
		expect(hasP1SatDispatchLabel([P1SAT_LABEL])).toBe(true)
		expect(hasP1SatDispatchLabel([buildIntentLabel('opns.register')])).toBe(
			true,
		)
		expect(hasP1SatDispatchLabel(['p 1sat input 1sat x'])).toBe(true)
		expect(hasP1SatDispatchLabel(['p 1sat'])).toBe(false)
		expect(hasP1SatDispatchLabel(undefined)).toBe(false)
	})
})

describe('action dispatch label', () => {
	test('ensureP1SatActionLabel adds bare p 1sat action', () => {
		expect(ensureP1SatActionLabel(undefined)).toEqual([P1SAT_LABEL])
		expect(ensureP1SatActionLabel(['other'])).toEqual(['other', P1SAT_LABEL])
		expect(ensureP1SatActionLabel([P1SAT_LABEL])).toEqual([P1SAT_LABEL])
	})
})

describe('input labels', () => {
	test('full basket including spaces', () => {
		const label = buildInputAssetLabel('p 1sat ordinals', 'id1')
		expect(label).toBe('p 1sat input p 1sat ordinals id1')
		expect(parseInputAssetLabels([label])).toEqual([
			{ basket: 'p 1sat ordinals', id: 'id1' },
		])
	})

	test('plain basket', () => {
		const label = buildInputAssetLabel('1sat', 'abc')
		expect(parseInputAssetLabels([label])).toEqual([
			{ basket: '1sat', id: 'abc' },
		])
	})
})
