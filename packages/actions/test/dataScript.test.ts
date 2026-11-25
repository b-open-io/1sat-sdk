import { describe, expect, it } from 'bun:test'
import { B } from '@1sat/templates'
import { OP, Script } from '@bsv/sdk'
import { buildDataScript } from '../src/ordfs/index.js'

describe('buildDataScript', () => {
	it('is OP_FALSE OP_RETURN followed by the B section, and decodes as B', () => {
		const body = new TextEncoder().encode('hello')
		const s = buildDataScript(body, 'text/plain').toBinary()
		expect(s[0]).toBe(OP.OP_FALSE)
		expect(s[1]).toBe(OP.OP_RETURN)
		const decoded = B.decode(Script.fromBinary(s))
		expect(decoded).not.toBeNull()
		expect(decoded?.mediaType).toBe('text/plain')
	})
})
