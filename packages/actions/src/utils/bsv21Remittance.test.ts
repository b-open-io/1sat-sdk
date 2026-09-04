import { describe, expect, test } from 'bun:test'
import {
	bsv21FieldsFromOutput,
	bsv21FilterTags,
	buildBsv21CustomInstructions,
	overwriteBsv21CiFields,
	parseBsv21CustomInstructions,
} from './bsv21Remittance.js'
import {
	buildOrdinalCustomInstructions,
	overwriteOrdinalCiFields,
} from './ordinalRemittance.js'

describe('bsv21FilterTags', () => {
	test('token id only', () => {
		expect(bsv21FilterTags({ tokenId: 'abc_0' })).toEqual(['bsv21:abc_0'])
	})
	test('deploy only (no token id tag)', () => {
		expect(bsv21FilterTags({ deploy: true })).toEqual(['bsv21:deploy'])
	})
	test('deploy and auth with id', () => {
		expect(
			bsv21FilterTags({ tokenId: 'abc_0', deploy: true, auth: true }),
		).toEqual(['bsv21:abc_0', 'bsv21:deploy', 'bsv21:auth'])
	})
})

describe('buildBsv21CustomInstructions / parse', () => {
	test('round-trip load-bearing + derivation', () => {
		const s = buildBsv21CustomInstructions({
			token: {
				id: 'abc_0',
				amt: '100',
				op: 'transfer',
				sym: 'Demo',
				dec: 2,
			},
			protocolID: [0, 'onesat'],
			keyID: 'k1',
			counterparty: 'self',
		})
		const p = parseBsv21CustomInstructions(s)
		expect(p.id).toBe('abc_0')
		expect(p.amt).toBe('100')
		expect(p.sym).toBe('Demo')
		expect(p.keyID).toBe('k1')
	})
})

describe('overwriteBsv21CiFields', () => {
	test('overwrites token fields, keeps derivation', () => {
		const base = buildBsv21CustomInstructions({
			token: { id: 'lie_0', amt: '1', op: 'transfer', sym: 'FAKE' },
			protocolID: [0, 'p 1sat'],
			keyID: 'keep-me',
			counterparty: 'self',
		})
		const next = overwriteBsv21CiFields(base, {
			id: 'real_0',
			amt: '500',
			op: 'transfer',
			sym: 'SCAM',
			dec: 10,
		})
		const p = parseBsv21CustomInstructions(next)
		expect(p.id).toBe('real_0')
		expect(p.amt).toBe('500')
		expect(p.sym).toBe('SCAM')
		expect(p.dec).toBe('10')
		expect(p.keyID).toBe('keep-me')
		expect(p.counterparty).toBe('self')
		expect(p.protocolID).toEqual([0, 'p 1sat'])
	})
})

describe('overwriteOrdinalCiFields', () => {
	test('overwrites remittance, keeps derivation', () => {
		const base = buildOrdinalCustomInstructions({
			protocolID: [0, 'p 1sat'],
			keyID: 'k1',
			counterparty: 'self',
			tags: ['origin:aa_0', 'app:evil'],
		})
		const next = overwriteOrdinalCiFields(base, {
			origin: 'bb_0',
			app: 'good',
			collection: 'cc_0',
		})
		const p = JSON.parse(next) as Record<string, unknown>
		expect(p.origin).toBe('bb_0')
		expect(p.app).toBe('good')
		expect(p.collection).toBe('cc_0')
		expect(p.keyID).toBe('k1')
		expect(p.protocolID).toEqual([0, 'p 1sat'])
	})
})

describe('bsv21FieldsFromOutput', () => {
	test('CI preferred over tags', () => {
		const f = bsv21FieldsFromOutput({
			customInstructions: buildBsv21CustomInstructions({
				token: { id: 'fromci_0', amt: '9', sym: 'CI' },
			}),
			tags: ['bsv21:fromtag_0', 'amt:1', 'sym:TAG'],
		})
		expect(f.tokenId).toBe('fromci_0')
		expect(f.amt).toBe('9')
		expect(f.sym).toBe('CI')
	})
	test('tag fallback', () => {
		const f = bsv21FieldsFromOutput({
			tags: ['bsv21:t_0', 'amt:5', 'dec:2'],
		})
		expect(f.tokenId).toBe('t_0')
		expect(f.amt).toBe('5')
		expect(f.dec).toBe('2')
	})
	test('deploy outpoint is token id', () => {
		const f = bsv21FieldsFromOutput({
			tags: ['bsv21:deploy'],
			customInstructions: buildBsv21CustomInstructions({
				token: { amt: '1000000', op: 'deploy+mint', sym: 'X' },
			}),
			outpoint: 'aa'.repeat(32) + '.0',
		})
		expect(f.isDeploy).toBe(true)
		expect(f.amt).toBe('1000000')
		expect(f.tokenId).toBe(`${'aa'.repeat(32)}_0`)
	})
})
