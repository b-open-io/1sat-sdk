import { describe, expect, it } from 'bun:test'
import { Utils } from '@bsv/sdk'
import {
	PATCH_CONTENT_TYPE,
	PATCH_VERSION,
	PatchFormatError,
	patchApply,
	patchDecode,
	patchEncode,
	patchFromContent,
} from '../src/ordfs/patch'

const enc = (s: string) => new TextEncoder().encode(s)
const BASE = { txid: 'ab'.repeat(32), vout: 7 }

describe('ordfs/patch envelope', () => {
	it('round-trips version, outpoint, delta', async () => {
		const bytes = await patchFromContent({
			base: BASE,
			source: enc('hello world, this is the base file'),
			target: enc('hello world, this is the base file PLUS'),
		})
		expect(bytes[0]).toBe(PATCH_VERSION)
		const rec = patchDecode(bytes)
		expect(rec.base).toEqual(BASE)
		expect(rec.delta[0]).toBe(0xd6)
		expect(rec.delta[4]).toBe(0x00)
		expect(Utils.toHex(patchEncode(rec))).toBe(Utils.toHex(bytes))
	})

	it('applies against source bytes', async () => {
		const source = enc('the quick brown fox')
		const target = enc('the quick brown fox jumps')
		const rec = patchDecode(
			await patchFromContent({ base: BASE, source, target }),
		)
		expect(await patchApply(rec, source)).toEqual(target)
	})

	it('refuses identical content', async () => {
		const body = enc('same')
		expect(
			patchFromContent({ base: BASE, source: body, target: body }),
		).rejects.toThrow(PatchFormatError)
	})

	it('rejects empty delta and bad version', () => {
		expect(() =>
			patchEncode({
				version: PATCH_VERSION,
				base: BASE,
				delta: new Uint8Array(0),
			}),
		).toThrow(PatchFormatError)
		expect(() => patchDecode(new Uint8Array(40))).toThrow(PatchFormatError)
		const tooShort = new Uint8Array(37)
		expect(() => patchDecode(tooShort)).toThrow(PatchFormatError)
	})

	it('content type constant', () => {
		expect(PATCH_CONTENT_TYPE).toBe('ordfs/patch')
	})
})
