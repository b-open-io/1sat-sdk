import { describe, expect, it } from 'bun:test'
import { Script, Utils } from '@bsv/sdk'
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
