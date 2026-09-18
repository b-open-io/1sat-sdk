import { describe, expect, it } from 'bun:test'
import { Utils } from '@bsv/sdk'
import { decode as ablyDecode } from '@ably/vcdiff-decoder'
import { vcdiffDecode, vcdiffEncode, VcdiffError } from '../src/ordfs/vcdiff'

const enc = (s: string) => new TextEncoder().encode(s)
const eq = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((v, i) => v === b[i])

/** Run the xdelta3 CLI (reference decoder). Skipped when absent. */
async function cliDecode(
	delta: Uint8Array,
	source: Uint8Array,
): Promise<Uint8Array> {
	await Bun.write('/tmp/sdk-v-src.bin', source)
	await Bun.write('/tmp/sdk-v-delta.bin', delta)
	const p = Bun.spawnSync([
		'xdelta3', '-f', '-d',
		'-s', '/tmp/sdk-v-src.bin', '/tmp/sdk-v-delta.bin', '/tmp/sdk-v-out.bin',
	])
	if (p.exitCode !== 0) {
		throw new Error(`xdelta3: ${p.stderr.toString().trim()}`)
	}
	return new Uint8Array(await Bun.file('/tmp/sdk-v-out.bin').arrayBuffer())
}
const hasXdelta = Bun.which('xdelta3') !== null

describe('vcdiff roundtrip', () => {
	it('append: delta is small, RFC header, round-trips', async () => {
		const base = enc('hello world, this is the base file with some content')
		const target = enc('hello world, this is the base file with some content AND AN APPEND')
		const delta = await vcdiffEncode(target, base)
		expect(delta.subarray(0, 4)).toEqual(Uint8Array.from([0xd6, 0xc3, 0xc4, 0x00]))
		expect(delta.length).toBeLessThan(target.length)
		expect(await vcdiffDecode(delta, base)).toEqual(target)
	})

	it('edit in the middle', async () => {
		const base = enc('The quick brown fox jumps over the lazy dog, again and again.')
		const target = enc('The quick red fox leaps over the lazy dog, again and again.')
		const delta = await vcdiffEncode(target, base)
		expect(await vcdiffDecode(delta, base)).toEqual(target)
	})

	it('from-scratch (no dictionary) is valid', async () => {
		const target = enc('brand new file content')
		const delta = await vcdiffEncode(target)
		expect(await vcdiffDecode(delta, new Uint8Array(0))).toEqual(target)
	})

	it('binary data with repeated blocks', async () => {
		const base = new Uint8Array(100000)
		for (let i = 0; i < base.length; i++) base[i] = (i ^ (i >> 8)) & 0xff
		const target = new Uint8Array(base.length + 1000)
		target.set(base)
		target.set(base.subarray(50000, 51000), base.length)
		const delta = await vcdiffEncode(target, base)
		expect(delta.length).toBeLessThan(20000)
		expect(await vcdiffDecode(delta, base)).toEqual(target)
	})

	it('rejects garbage with VcdiffError', async () => {
		const base = enc('base'.repeat(50))
		const garbage = enc('this is not a vcdiff delta at all')
		await expect(vcdiffDecode(garbage, base)).rejects.toThrow(VcdiffError)
	})
})

describe('interop', () => {
	it('xdelta3 CLI (RFC reference) decodes OUR delta — text', async () => {
		if (!hasXdelta) return
		const base = enc('AAAA base content for testing, with enough length to hash and match')
		const target = enc('AAAA base content for testing, with enough length to hash and match THEN SOME NEW TAIL')
		const delta = await vcdiffEncode(target, base)
		expect(await cliDecode(delta, base)).toEqual(target)
	}, 30000)

	it('xdelta3 CLI decodes OUR delta — binary', async () => {
		if (!hasXdelta) return
		const base = new Uint8Array(300000)
		for (let i = 0; i < base.length; i++) base[i] = (i ^ (i >> 8)) & 0xff
		const target = new Uint8Array(base.length + 1000)
		target.set(base)
		target.set(base.subarray(50000, 51000), base.length)
		const delta = await vcdiffEncode(target, base)
		expect(await cliDecode(delta, base)).toEqual(target)
	}, 60000)

	it('@ably/vcdiff-decoder (Google format) decodes OUR delta', async () => {
		const base = enc('AAAA base content for the ably decoder interop test')
		const target = enc('AAAA base content for the ably decoder interop test WITH AN EDIT AT THE END')
		const delta = await vcdiffEncode(target, base)
		expect(eq(ablyDecode(delta, base), target)).toBe(true)
	})

	it('we decode xdelta3 CLI delta (code table dialect, uncompressed)', async () => {
		if (!hasXdelta) return
		const base = enc('BBBB base content for testing, with enough length to hash and match. '.repeat(200))
		const target = enc('BBBB base content for testing, with enough length to hash and match! '.repeat(200) + ' appended tail')
		await Bun.write('/tmp/sdk-v-b.bin', base)
		await Bun.write('/tmp/sdk-v-t.bin', target)
		const p = Bun.spawnSync(['xdelta3', '-f', '-e', '-n', '-S', 'none', '-s', '/tmp/sdk-v-b.bin', '/tmp/sdk-v-t.bin', '/tmp/sdk-v-d.bin'])
		expect(p.exitCode).toBe(0)
		const delta = new Uint8Array(await Bun.file('/tmp/sdk-v-d.bin').arrayBuffer())
		expect(await vcdiffDecode(delta, base)).toEqual(target)
	}, 30000)

	it('secondary-compressed deltas are rejected with a clear error', async () => {
		if (!hasXdelta) return
		const base = enc('CCCC base content for the rejection test, long enough to compress. '.repeat(2000))
		const target = enc('CCCC base content for the rejection test, long enough to compress? '.repeat(2000) + ' tail')
		await Bun.write('/tmp/sdk-v-b2.bin', base)
		await Bun.write('/tmp/sdk-v-t2.bin', target)
		const p = Bun.spawnSync(['xdelta3', '-f', '-e', '-s', '/tmp/sdk-v-b2.bin', '/tmp/sdk-v-t2.bin', '/tmp/sdk-v-d2.bin'])
		expect(p.exitCode).toBe(0)
		const delta = new Uint8Array(await Bun.file('/tmp/sdk-v-d2.bin').arrayBuffer())
		// sanity: this delta IS secondary-compressed (Hdr_Indicator bit 0)
		expect(delta[4] & 0x01).toBe(1)
		expect(vcdiffDecode(delta, base)).rejects.toThrow(/secondary-compressed/)
	}, 30000)
})
