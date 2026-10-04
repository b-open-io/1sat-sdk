import { describe, expect, test } from 'bun:test'
import { Utils } from '@bsv/sdk'
import {
	TRANSACTION_CBOR_CONTENT_TYPE,
	encodeMimeEntity,
	mediaType,
	parseMimeEntity,
} from '../src/mime'

const utf8 = (s: string) => Uint8Array.from(Utils.toArray(s, 'utf8'))

describe('MIME entity', () => {
	test('encode writes Content-Type, CRLF CRLF, then the body', () => {
		const body = new Uint8Array([0xa1, 0x00, 0x0d, 0x0a, 0x0d, 0x0a])
		const bytes = encodeMimeEntity(TRANSACTION_CBOR_CONTENT_TYPE, body)
		expect(Utils.toUTF8(Array.from(bytes.subarray(0, bytes.length - 6)))).toBe(
			'Content-Type: application/vnd.metanet.transaction+cbor\r\n\r\n',
		)
		const parsed = parseMimeEntity(bytes)
		expect(parsed.contentType).toBe(TRANSACTION_CBOR_CONTENT_TYPE)
		expect(parsed.body).toEqual(body)
	})

	test('BRC-169 A.7 plaintext parses as text/plain with a charset', () => {
		const parsed = parseMimeEntity(
			utf8(
				'Content-Type: text/plain; charset=utf-8\r\n\r\nSee you at conf2036 — crumbs',
			),
		)
		expect(mediaType(parsed.contentType)).toBe('text/plain')
		expect(Utils.toUTF8(Array.from(parsed.body))).toBe(
			'See you at conf2036 — crumbs',
		)
	})

	test('unknown headers are ignored; names are case-insensitive', () => {
		const parsed = parseMimeEntity(
			utf8('X-Other: 1\r\ncontent-type: Text/Plain\r\n\r\nhi'),
		)
		expect(mediaType(parsed.contentType)).toBe('text/plain')
		expect(parsed.headers['x-other']).toBe('1')
	})

	test('no header block is text/plain with the whole input as body', () => {
		const parsed = parseMimeEntity(utf8('just text'))
		expect(parsed.contentType).toBe('text/plain')
		expect(Utils.toUTF8(Array.from(parsed.body))).toBe('just text')
		const notHeaders = parseMimeEntity(utf8('hello there\r\n\r\nworld'))
		expect(notHeaders.contentType).toBe('text/plain')
		expect(notHeaders.body.length).toBe(20)
	})

	test('a header block without Content-Type is rejected', () => {
		expect(() => parseMimeEntity(utf8('X-Other: 1\r\n\r\nbody'))).toThrow(
			'Content-Type',
		)
	})
})
