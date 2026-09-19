import { describe, expect, it } from 'bun:test'
import { OP, Script, Utils } from '@bsv/sdk'
import B, { Encoding } from './b.js'
import BitCom from './bitcom.js'
import MAP from './map.js'

describe('BitCom decoding', () => {
	it('ignores OP_RETURN bytes inside pushed prefix data', () => {
		const prefix = new Script().writeBin(Utils.toArray('ord-fs/json'))
		const map = MAP.set({ subType: 'collectionItem' })
		const script = Script.fromBinary([...prefix.toBinary(), ...map.toBinary()])

		const decoded = BitCom.decode(script)
		expect(decoded?.scriptPrefix).toEqual(prefix.toBinary())
		expect(MAP.decode(script)?.data).toEqual({
			subType: 'collectionItem',
		})
	})
})

describe('B.lock appends to a starting script', () => {
	it('emits the B section after the caller-supplied prefix', () => {
		const section = B.lock('hi', 'text/plain', Encoding.UTF8).toBinary()
		expect(section[0]).toBe(OP.OP_RETURN) // no starting script: just the section
		// A standalone zero-sat output starts with OP_FALSE so it is provably
		// unspendable; the caller supplies that as the starting script.
		const standalone = B.lock('hi', 'text/plain', Encoding.UTF8, undefined, [OP.OP_FALSE]).toBinary()
		expect(standalone).toEqual([OP.OP_FALSE, ...section])
		expect(B.decode(Script.fromBinary(standalone))).not.toBeNull()
	})
})
