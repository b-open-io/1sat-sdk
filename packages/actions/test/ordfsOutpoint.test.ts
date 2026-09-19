import { describe, expect, it } from 'bun:test'
import { outpointFromBytes, outpointToBytes } from '@1sat/templates'
import { DIR_VERSION, dirDecode, dirEncode, dirName } from '../src/ordfs/dir'
import {
	outpointFromWire,
	outpointToWire,
	txidFromWire,
	txidToWire,
} from '../src/ordfs/outpoint'
import { PATCH_VERSION, patchDecode, patchEncode } from '../src/ordfs/patch'

const TXID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

describe('outpoint wire order', () => {
	it('matches @1sat/templates internal-order encoding', () => {
		const vout = 3
		const ours = outpointToWire(TXID, vout)
		const theirs = outpointToBytes(`${TXID}_${vout}`)
		expect(theirs).not.toBeNull()
		expect(Array.from(ours)).toEqual(theirs as number[])
		expect(txidToWire(TXID)[0]).toBe(0xef)
		expect(txidToWire(TXID)[31]).toBe(0x01)
		expect(txidFromWire(ours.subarray(0, 32))).toBe(TXID)
		expect(outpointFromWire(ours)).toEqual({ txid: TXID, vout })
		expect(outpointFromBytes(Array.from(ours))).toBe(`${TXID}_${vout}`)
	})

	it('dir encode/decode round-trips a non-palindromic txid', () => {
		const encoded = dirEncode({
			version: DIR_VERSION,
			entries: [
				{
					name: dirName('f'),
					isDir: false,
					ref: { kind: 'outpoint', txid: TXID, vout: 1 },
				},
			],
		})
		expect(encoded[6]).toBe(0xef)
		expect(encoded[37]).toBe(0x01)
		expect(dirDecode(encoded).entries[0].ref).toEqual({
			kind: 'outpoint',
			txid: TXID,
			vout: 1,
		})
	})

	it('patch encode/decode uses the same 36B layout', () => {
		const delta = new Uint8Array([0xd6, 0xc3, 0xc4, 0x00, 0x00])
		const bytes = patchEncode({
			version: PATCH_VERSION,
			base: { txid: TXID, vout: 7 },
			delta,
		})
		expect(bytes[1]).toBe(0xef)
		expect(bytes[32]).toBe(0x01)
		expect(patchDecode(bytes).base).toEqual({ txid: TXID, vout: 7 })
	})
})
