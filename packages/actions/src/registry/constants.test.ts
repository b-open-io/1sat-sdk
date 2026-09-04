import { describe, expect, test } from 'bun:test'
import { REGISTRY_TYPE_SET } from './constants.js'

describe('registry type vocabulary', () => {
	test('includes current shadcn/ui types and the 1Sat asset extension', () => {
		expect(REGISTRY_TYPE_SET.has('registry:base')).toBe(true)
		expect(REGISTRY_TYPE_SET.has('registry:item')).toBe(true)
		expect(REGISTRY_TYPE_SET.has('registry:asset')).toBe(true)
	})

	test('keeps legacy types readable', () => {
		expect(REGISTRY_TYPE_SET.has('registry:example')).toBe(true)
		expect(REGISTRY_TYPE_SET.has('registry:internal')).toBe(true)
	})
})
