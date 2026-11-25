import { describe, expect, it } from 'bun:test'
import { Script } from '@bsv/sdk'
import Inscription from './inscription.js'

describe('Inscription.decode', () => {
	it('round-trips content and type', () => {
		const script = Inscription.create(
			new Uint8Array([104, 105]),
			'text/plain',
		).lock()
		const decoded = Inscription.decode(script)
		expect(decoded?.file.type).toBe('text/plain')
		expect(decoded?.file.content).toEqual(new Uint8Array([104, 105]))
	})

	it('decodes a zero-length file', () => {
		const script = Inscription.create(new Uint8Array(0), 'text/plain').lock()
		const decoded = Inscription.decode(Script.fromHex(script.toHex()))
		expect(decoded).not.toBeNull()
		expect(decoded?.file.type).toBe('text/plain')
		expect(decoded?.file.content).toEqual(new Uint8Array(0))
		expect(decoded?.file.size).toBe(0)
	})

	it('returns null for a script without an ord envelope', () => {
		expect(Inscription.decode(Script.fromASM('OP_TRUE'))).toBeNull()
	})
})
