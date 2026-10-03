import { describe, expect, test } from 'bun:test'
import {
	OPNS_PROFILE_FIELD,
	OPNS_RECORD_IDENTITY_KEY,
	OPNS_RECORD_PROFILE_KEY,
} from '@1sat/types'
import { PrivateKey, Utils } from '@bsv/sdk'
import { decode as cborDecode, encode as cborEncode } from '@ipld/dag-cbor'
import {
	decodeOpnsProfile,
	decodeOpnsRecord,
	encodeOpnsProfile,
	encodeOpnsRecord,
	isOpnsDomain,
} from './record'

const identityKey = new PrivateKey(42).toPublicKey().toString()
const avatar = `${'ab'.repeat(32)}_3`
const utf8 = (s: string) => Utils.toArray(s, 'utf8')

describe('OpNS record codec', () => {
	test('identity only round trip', () => {
		const fields = encodeOpnsRecord({ identityKey })
		expect(fields).toHaveLength(2)
		expect(Utils.toUTF8(fields[0])).toBe(OPNS_RECORD_IDENTITY_KEY)
		expect(Utils.toHex(fields[1])).toBe(identityKey)
		expect(decodeOpnsRecord(fields)).toEqual({ identityKey })
	})

	test('identity + profile with all fields round trip', () => {
		const record = {
			identityKey,
			profile: { domain: '1sat.name', displayName: 'Alice', avatar },
		}
		const fields = encodeOpnsRecord(record)
		expect(fields).toHaveLength(4)
		expect(Utils.toUTF8(fields[2])).toBe(OPNS_RECORD_PROFILE_KEY)
		expect(decodeOpnsRecord(fields)).toEqual(record)

		const map = cborDecode<Record<string, unknown>>(Uint8Array.from(fields[3]))
		expect(map[OPNS_PROFILE_FIELD.domain]).toBe('1sat.name')
		expect(map[OPNS_PROFILE_FIELD.displayName]).toBe('Alice')
		const avatarBytes = map[OPNS_PROFILE_FIELD.avatar]
		expect(avatarBytes).toBeInstanceOf(Uint8Array)
		expect((avatarBytes as Uint8Array).length).toBe(36)
	})

	test('absent optionals have no keys in the CBOR map', () => {
		const bytes = encodeOpnsProfile({
			domain: '1sat.name',
			displayName: '  ',
			avatar: '',
		})
		const map = cborDecode<Record<string, unknown>>(Uint8Array.from(bytes))
		expect(Object.keys(map)).toEqual([OPNS_PROFILE_FIELD.domain])
		expect(decodeOpnsProfile(bytes)).toEqual({ domain: '1sat.name' })
	})

	test('domain is lowercased and required', () => {
		const bytes = encodeOpnsProfile({ domain: ' Example.COM ' })
		expect(decodeOpnsProfile(bytes).domain).toBe('example.com')
		expect(() => encodeOpnsProfile({ domain: '' })).toThrow(/domain/)
		expect(() => encodeOpnsProfile({ domain: 'https://x.com' })).toThrow(
			/domain/,
		)
		expect(isOpnsDomain('a-b.c0.io')).toBe(true)
		expect(isOpnsDomain('Upper.io')).toBe(false)
		expect(isOpnsDomain('host:80')).toBe(false)
		expect(isOpnsDomain('-bad.io')).toBe(false)
	})

	test('profile without domain is rejected on decode', () => {
		const bytes = Array.from(cborEncode({ displayName: 'x' }))
		expect(() => decodeOpnsProfile(bytes)).toThrow(/domain/)
	})

	test('unknown pairs are skipped, in any position', () => {
		const [idKey, idVal, profKey, profVal] = encodeOpnsRecord({
			identityKey,
			profile: { domain: '1sat.name' },
		})
		const fields = [
			utf8('future'),
			[1, 2, 3],
			idKey,
			idVal,
			utf8('other'),
			utf8('anything'),
			profKey,
			profVal,
		]
		expect(decodeOpnsRecord(fields)).toEqual({
			identityKey,
			profile: { domain: '1sat.name' },
		})
	})

	test('missing identity is rejected', () => {
		const [, , profKey, profVal] = encodeOpnsRecord({
			identityKey,
			profile: { domain: '1sat.name' },
		})
		expect(() => decodeOpnsRecord([profKey, profVal])).toThrow(
			/missing identity/,
		)
	})

	test('duplicate identity and odd field counts are rejected', () => {
		const pair = encodeOpnsRecord({ identityKey })
		expect(() => decodeOpnsRecord([...pair, ...pair])).toThrow(/duplicate/)
		expect(() => decodeOpnsRecord([...pair, utf8('dangling')])).toThrow(/pairs/)
	})

	test('pre-#83 positional bind is not a record', () => {
		const pub = Utils.toArray(identityKey, 'hex')
		expect(() => decodeOpnsRecord([pub])).toThrow()
		expect(() => decodeOpnsRecord([pub, utf8('Alice')])).toThrow(
			/missing identity/,
		)
	})

	test('identity must be a compressed key', () => {
		expect(() =>
			decodeOpnsRecord([utf8(OPNS_RECORD_IDENTITY_KEY), [1, 2, 3]]),
		).toThrow(/compressed/)
	})
})
