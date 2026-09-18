import { describe, expect, it } from 'bun:test'
import { Utils } from '@bsv/sdk'
import {
	outpointFromBytes,
	outpointToBytes,
	patchApply,
	patchDecode,
	patchEncode,
	PATCH_VERSION,
	PatchFormatError,
} from '../src/ordfs/patch'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

const TXID = 'aa'.repeat(32)
const BASE = enc('the quick brown fox jumps over the lazy dog, over and over again and again')
const NEW = enc('the quick brown fox leaps over the lazy dog, over and over again and again AND MORE')

describe('outpoint bytes', () => {
	it('round-trips with native LE vout', () => {
		const b = outpointToBytes(TXID, 0x01020304)
		expect(b.length).toBe(36)
		expect(Utils.toHex(b.subarray(0, 32))).toBe(TXID)
		// little-endian vout
		expect(b.subarray(32)).toEqual(Uint8Array.from([0x04, 0x03, 0x02, 0x01]))
		const back = outpointFromBytes(b)
		expect(back.txid).toBe(TXID)
		expect(back.vout).toBe(0x01020304)
	})

	it('handles vout above 2^24 (unsigned)', () => {
		const b = outpointToBytes(TXID, 0xffffffff)
		expect(outpointFromBytes(b).vout).toBe(0xffffffff)
	})

	it('rejects bad txid/vout', () => {
		expect(() => outpointToBytes('nope', 0)).toThrow(PatchFormatError)
		expect(() => outpointToBytes(TXID, -1)).toThrow(PatchFormatError)
		expect(() => outpointToBytes(TXID, 1.5)).toThrow(PatchFormatError)
	})
})

describe('patch envelope', () => {
	it('encode/decode round-trip', async () => {
		const rec = await patchEncode(NEW, BASE, `${TXID}.12`)
		expect(rec[0]).toBe(PATCH_VERSION)
		const { baseOutpoint, delta } = patchDecode(rec)
		expect(baseOutpoint).toBe(`${TXID}.12`)
		expect(delta.subarray(0, 3)).toEqual(Uint8Array.from([0xd6, 0xc3, 0xc4]))
		expect(dec(await patchApply(rec, BASE))).toBe(dec(NEW))
	})

	it('accepts underscore outpoint form', async () => {
		const rec = await patchEncode(NEW, BASE, `${TXID}_7`)
		expect(patchDecode(rec).baseOutpoint).toBe(`${TXID}.7`)
	})

	it('rejects wrong version', async () => {
		const rec = await patchEncode(NEW, BASE, `${TXID}.0`)
		rec[0] = 9
		expect(() => patchDecode(rec)).toThrow(/version/)
	})

	it('rejects truncated and non-vcdiff bodies', () => {
		expect(() => patchDecode(new Uint8Array(10))).toThrow(PatchFormatError)
		const bad = new Uint8Array(1 + 36 + 8)
		bad[0] = PATCH_VERSION
		expect(() => patchDecode(bad)).toThrow(/VCDIFF/)
	})

	it('patchApply against the wrong base yields wrong bytes, loudly enough to notice in hashes — but decodes only if structurally valid; garbage base is caller error (documented)', async () => {
		const rec = await patchEncode(NEW, BASE, `${TXID}.0`)
		const out = await patchApply(rec, enc('completely different content '.repeat(10)))
		expect(dec(out)).not.toBe(dec(NEW))
	})
})
