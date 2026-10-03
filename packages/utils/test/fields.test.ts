import { describe, expect, test } from 'bun:test'
import { PROFILE_FIELDS } from '@1sat/types'
import { PrivateKey, Utils } from '@bsv/sdk'
import { decode as cborDecode, encode as cborEncode } from '@ipld/dag-cbor'
import {
	decodeProfile,
	encodeProfile,
	fieldPairs,
	isIdentityKey,
} from '../src/fields'

const avatar = Array.from({ length: 36 }, (_, i) => i)
const utf8 = (s: string) => Utils.toArray(s, 'utf8')

describe('profile field codec', () => {
	test('round trip with all members', () => {
		const profile = { domain: '1sat.name', name: 'Alice', avatar }
		const bytes = encodeProfile(profile)
		expect(decodeProfile(bytes)).toEqual(profile)
		const map = cborDecode<Record<string, unknown>>(Uint8Array.from(bytes))
		expect(map[PROFILE_FIELDS.domain]).toBe('1sat.name')
		expect(map[PROFILE_FIELDS.name]).toBe('Alice')
		expect(map[PROFILE_FIELDS.avatar]).toBeInstanceOf(Uint8Array)
		expect((map[PROFILE_FIELDS.avatar] as Uint8Array).length).toBe(36)
	})

	test('absent optionals have no keys in the CBOR map', () => {
		const bytes = encodeProfile({ domain: '1sat.name', name: '' })
		const map = cborDecode<Record<string, unknown>>(Uint8Array.from(bytes))
		expect(Object.keys(map)).toEqual([PROFILE_FIELDS.domain])
		expect(decodeProfile(bytes)).toEqual({ domain: '1sat.name' })
	})

	test('encoding is deterministic', () => {
		const a = encodeProfile({ domain: 'x.io', name: 'A', avatar })
		const b = encodeProfile({ avatar, name: 'A', domain: 'x.io' })
		expect(a).toEqual(b)
	})

	test('values are written exactly as given; domain required', () => {
		const odd = { domain: ' Example.COM/x ', name: '  Spaced  ' }
		expect(decodeProfile(encodeProfile(odd))).toEqual(odd)
		expect(() => encodeProfile({ domain: '' })).toThrow(/domain/)
		expect(() =>
			encodeProfile({ domain: undefined as unknown as string }),
		).toThrow(/domain/)
		expect(() => decodeProfile(Array.from(cborEncode({ name: 'x' })))).toThrow(
			/domain/,
		)
		expect(() => decodeProfile(Array.from(cborEncode({ domain: 7 })))).toThrow(
			/domain/,
		)
		expect(() =>
			decodeProfile(Array.from(cborEncode({ domain: 'x', name: 1 }))),
		).toThrow(/name/)
	})

	test('avatar must be 36 bytes', () => {
		expect(() => encodeProfile({ domain: 'x.io', avatar: [1, 2] })).toThrow(
			/36/,
		)
		expect(() =>
			decodeProfile(
				Array.from(cborEncode({ domain: 'x.io', avatar: new Uint8Array(3) })),
			),
		).toThrow(/36/)
	})

	test('unknown map members are ignored; non-maps rejected', () => {
		const bytes = Array.from(cborEncode({ domain: 'x.io', future: 1 }))
		expect(decodeProfile(bytes)).toEqual({ domain: 'x.io' })
		expect(() => decodeProfile(Array.from(cborEncode([1, 2])))).toThrow(/map/)
	})
})

describe('identity field + pairs', () => {
	test('isIdentityKey accepts compressed keys only', () => {
		const key = new PrivateKey(42).toPublicKey()
		expect(isIdentityKey(key.encode(true) as number[])).toBe(true)
		expect(isIdentityKey(key.encode(false) as number[])).toBe(false)
		expect(isIdentityKey([1, 2, 3])).toBe(false)
	})

	test('fieldPairs splits into [utf8 key, value] and rejects odd counts', () => {
		expect(fieldPairs([utf8('a'), [1], utf8('b'), [2, 3]])).toEqual([
			['a', [1]],
			['b', [2, 3]],
		])
		expect(fieldPairs([])).toEqual([])
		expect(() => fieldPairs([utf8('dangling')])).toThrow(/pairs/)
	})
})
