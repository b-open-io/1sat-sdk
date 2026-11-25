import { describe, expect, it } from 'bun:test'
import { Script } from '@bsv/sdk'
import B from './b.js'

describe('B.decode', () => {
	it('round-trips a payload', () => {
		const script = B.lock([1, 2, 3], 'application/octet-stream', 'binary')
		const decoded = B.decode(script)
		expect(decoded?.data).toEqual([1, 2, 3])
		expect(decoded?.mediaType).toBe('application/octet-stream')
		expect(decoded?.encoding).toBe('binary')
	})

	it('decodes a zero-length payload (empty file)', () => {
		const script = B.lock([], 'text/plain', 'binary')
		const decoded = B.decode(Script.fromHex(script.toHex()))
		expect(decoded).not.toBeNull()
		expect(decoded?.data).toEqual([])
		expect(decoded?.mediaType).toBe('text/plain')
	})

	it('returns null for a non-B script', () => {
		expect(B.decode(Script.fromASM('OP_TRUE'))).toBeNull()
	})
})
