import { describe, expect, test } from 'bun:test'
import {
	axisTagValues,
	grantCoversScope,
	grantCoversView,
	parseViewBasket,
	viewGrantKey,
} from './viewScope'

describe('parseViewBasket 1sat (BRC-165)', () => {
	test('rejects bare p 1sat', () => {
		expect(parseViewBasket('1sat', 'p 1sat').ok).toBe(false)
	})

	test('p 1sat all', () => {
		expect(parseViewBasket('1sat', 'p 1sat all')).toEqual({
			ok: true,
			schemeId: '1sat',
			storageBasket: '1sat',
			grantBasket: 'p 1sat all',
			scope: { kind: 'all' },
		})
	})

	test('axis-only scopes (values not in basket)', () => {
		expect(parseViewBasket('1sat', 'p 1sat collection')).toMatchObject({
			ok: true,
			grantBasket: 'p 1sat collection',
			scope: { kind: 'collection' },
			axisPrefix: 'collection:',
		})
		expect(parseViewBasket('1sat', 'p 1sat app')).toMatchObject({
			axisPrefix: 'app:',
		})
		expect(parseViewBasket('1sat', 'p 1sat creator')).toMatchObject({
			axisPrefix: 'creator:',
		})
		expect(parseViewBasket('1sat', 'p 1sat id')).toMatchObject({
			ok: true,
			grantBasket: 'p 1sat id',
			scope: { kind: 'id' },
			axisPrefix: 'id:',
			autoAllowView: true,
		})
	})

	test('rejects values embedded in basket name', () => {
		expect(parseViewBasket('1sat', 'p 1sat collection foxes').ok).toBe(false)
		expect(
			parseViewBasket(
				'1sat',
				'p 1sat collection a1b2c3d4e5f6070890abcdef1234567890abcdef1234567890abcdef12345678 0',
			).ok,
		).toBe(false)
	})
})

describe('axisTagValues', () => {
	test('extracts values including outpoint punctuation', () => {
		const id =
			'a1b2c3d4e5f6070890abcdef1234567890abcdef1234567890abcdef12345678_0'
		expect(
			axisTagValues(
				[`collection:${id}`, 'type:image/png', 'collection:other'],
				'collection:',
			),
		).toEqual([id, 'other'])
	})
})

describe('viewGrantKey / grantCoversView', () => {
	test('value key', () => {
		expect(viewGrantKey('p 1sat collection', 'abc_0')).toBe(
			'p 1sat collection abc_0',
		)
	})

	test('all and whole-axis and value', () => {
		expect(grantCoversView('p 1sat all', 'p 1sat collection', 'x')).toBe(true)
		expect(grantCoversView('p 1sat collection', 'p 1sat collection', 'x')).toBe(
			true,
		)
		expect(
			grantCoversView('p 1sat collection x', 'p 1sat collection', 'x'),
		).toBe(true)
		expect(
			grantCoversView('p 1sat collection y', 'p 1sat collection', 'x'),
		).toBe(false)
		expect(grantCoversScope('p 1sat all', 'p 1sat collection')).toBe(true)
	})
})
