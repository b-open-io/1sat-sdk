import { describe, expect, test } from 'bun:test'
import {
	P1SAT_INTENTS,
	P1SAT_INTENT_LABEL_PREFIX,
	P1SAT_LABEL,
	buildIntentLabel,
	hasP1SatDispatchLabel,
	parseIntentLabel,
} from './constants'

describe('intent labels', () => {
	test('build / parse round-trip', () => {
		const label = buildIntentLabel(P1SAT_INTENTS.OPNS_REGISTER)
		expect(label).toBe(`${P1SAT_INTENT_LABEL_PREFIX}opns.register`)
		expect(parseIntentLabel([label, 'other'])).toBe('opns.register')
	})

	test('hasP1SatDispatchLabel accepts intent or bare action', () => {
		expect(hasP1SatDispatchLabel([P1SAT_LABEL])).toBe(true)
		expect(hasP1SatDispatchLabel([buildIntentLabel('opns.register')])).toBe(
			true,
		)
		expect(hasP1SatDispatchLabel(['p 1sat input opns x'])).toBe(false)
		expect(hasP1SatDispatchLabel(undefined)).toBe(false)
	})
})
