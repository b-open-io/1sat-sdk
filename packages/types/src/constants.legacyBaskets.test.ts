import { describe, expect, test } from 'bun:test'
import {
	LEGACY_P1SAT_BASKET_MIGRATIONS,
	ONESAT_BASKET,
} from './constants.js'

describe('legacy basket migrations', () => {
	test('includes leftover theme-token ordinals basket', () => {
		expect(LEGACY_P1SAT_BASKET_MIGRATIONS).toContainEqual({
			from: 'ordinals',
			to: ONESAT_BASKET,
		})
		expect(LEGACY_P1SAT_BASKET_MIGRATIONS).toContainEqual({
			from: 'p 1sat ordinals',
			to: ONESAT_BASKET,
		})
	})
})
