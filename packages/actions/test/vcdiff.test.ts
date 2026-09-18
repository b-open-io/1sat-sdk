import { describe, expect, it } from 'bun:test'
import { Utils } from '@bsv/sdk'
import { vcdiffDecode, vcdiffEncode, VcdiffError } from '../src/ordfs/vcdiff'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

/** Run the xdelta3 CLI (installed in CI/sandbox; skipped when absent). */
async function xdelta3(
	args: string[],
): Promise<{ ok: boolean; out?: Uint8Array; err: string }> {
	const proc = Bun.spawn(['xdelta3', ...args], {
		stdout: 'ignore',
		stderr: 'pipe',
	})
	const code = await proc.exited
	const err = new TextDecoder().decode(
		await new Response(proc.stderr ?? new Blob()).arrayBuffer(),
	)
	if (code !== 0) return { ok: false, err }
	const out = new Uint8Array(await Bun.file(args[args.length - 1]).arrayBuffer())
	return { ok: true, out, err }
}

describe('vcdiff roundtrip', () => {
	it('append: delta is small and round-trips', () => {
		const base = enc('hello world, this is the base file with some content')
		const target = enc('hello world, this is the base file with some content AND AN APPEND')
		const delta = vcdiffEncode(target, base)
		expect(delta[0]).toBe(0xd6)
		expect(delta[3]).toBe(0x00) // RFC version byte
		expect(delta.length).toBeLessThan(target.length)
		expect(vcdiffDecode(delta, base)).toEqual(target)
	})

	it('edit in the middle', () => {
		const parts = Array.from({ length: 500 }, (_, i) => `line ${i} of the base\n`)
		const base = enc(parts.join(''))
		const edited = [...parts]
		edited[250] = 'line 250 of the BASE, EDITED\n'
		const target = enc(edited.join(''))
		const delta = vcdiffEncode(target, base)
		expect(delta.length).toBeLessThan(target.length / 4)
		expect(vcdiffDecode(delta, base)).toEqual(target)
	})

	it('from-scratch (no dictionary) is pure ADD', () => {
		const target = enc('fresh file with no base'.repeat(10))
		const delta = vcdiffEncode(target)
		expect(vcdiffDecode(delta)).toEqual(target)
	})

	it('empty target', () => {
		const delta = vcdiffEncode(new Uint8Array(0), enc('base'))
		expect(vcdiffDecode(delta, enc('base'))).toEqual(new Uint8Array(0))
	})

	it('binary data with long runs and repeated blocks', () => {
		const base = new Uint8Array(70000)
		for (let i = 0; i < base.length; i++) base[i] = (i * 31) & 0xff
		const target = new Uint8Array(base.length)
		target.set(base)
		target.fill(0xab, 1000, 40000) // huge run
		target.set(base.subarray(0, 5000), 50000) // self-copy region
		const delta = vcdiffEncode(target, base)
		expect(delta.length).toBeLessThan(base.length / 4)
		expect(vcdiffDecode(delta, base)).toEqual(target)
	})

	it('large-ish file: 1MB, edited', () => {
		const base = new Uint8Array(1024 * 1024)
		let x = 123456789
		for (let i = 0; i < base.length; i++) {
			x = (Math.imul(x, 1103515245) + 12345) >>> 0
			base[i] = x & 0xff
		}
		const target = new Uint8Array(base)
		target.set(base.subarray(100000, 200000), 500000) // big copy
		target[300000] ^= 0xff
		const delta = vcdiffEncode(target, base)
		expect(delta.length).toBeLessThan(target.length / 8)
		expect(vcdiffDecode(delta, base)).toEqual(target)
	})
})

describe('vcdiff strict decode', () => {
	it('rejects bad magic', () => {
		expect(() => vcdiffDecode(enc('not a delta!!'))).toThrow(VcdiffError)
	})
	it('rejects non-zero version byte (what vcdiff-wasm emits)', () => {
		const base = enc('AAAA base content for testing')
		const delta = vcdiffEncode(enc('AAAA base content for testing PLUS'), base)
		const bad = new Uint8Array(delta)
		bad[3] = 0x53
		expect(() => vcdiffDecode(bad, base)).toThrow(/version/)
	})
	it('rejects truncated sections', () => {
		const base = enc('base'.repeat(50))
		const delta = vcdiffEncode(enc('base'.repeat(50) + ' tail'), base)
		expect(() => vcdiffDecode(delta.subarray(0, 12), base)).toThrow(VcdiffError)
	})
})

describe('xdelta3 interoperability', () => {
	const hasXdelta = Bun.which('xdelta3') !== null

	it('xdelta3 decodes OUR delta', async () => {
		if (!hasXdelta) return
		const base = enc('AAAA base content for testing, with enough length to hash')
		const target = enc('AAAA base content for testing, with enough length to hash AND MORE APPENDED CONTENT HERE')
		await Bun.write('/tmp/v-base.bin', base)
		await Bun.write('/tmp/v-delta.bin', vcdiffEncode(target, base))
		const res = await xdelta3(['-d', '-s', '/tmp/v-base.bin', '/tmp/v-delta.bin', '/tmp/v-out.bin'])
		expect(res.ok).toBe(true)
		expect(res.out).toEqual(target)
	}, 15000)

	it('we decode xdelta3 delta (no compression, default flags)', async () => {
		if (!hasXdelta) return
		const base = enc('BBBB base content for testing, with enough length to hash and match')
		const target = enc('BBBB base content for testing, with enough length to hash and match THEN SOME NEW TAIL')
		await Bun.write('/tmp/v-base2.bin', base)
		await Bun.write('/tmp/v-target2.bin', target)
		const res = await xdelta3(['-e', '-n', '-s', '/tmp/v-base2.bin', '/tmp/v-target2.bin', '/tmp/v-delta2.bin'])
		expect(res.ok).toBe(true)
		const delta = await Bun.file('/tmp/v-delta2.bin').arrayBuffer()
		expect(vcdiffDecode(new Uint8Array(delta), base)).toEqual(target)
	}, 15000)

	it('xdelta3 decodes OUR delta on binary data', async () => {
		if (!hasXdelta) return
		const base = new Uint8Array(300000)
		for (let i = 0; i < base.length; i++) base[i] = (i ^ (i >> 8)) & 0xff
		const target = new Uint8Array(base.length + 1000)
		target.set(base)
		target.set(base.subarray(50000, 51000), base.length)
		await Bun.write('/tmp/v-base3.bin', base)
		await Bun.write('/tmp/v-delta3.bin', vcdiffEncode(target, base))
		const res = await xdelta3(['-d', '-s', '/tmp/v-base3.bin', '/tmp/v-delta3.bin', '/tmp/v-out3.bin'])
		expect(res.ok).toBe(true)
		expect(res.out).toEqual(target)
	}, 30000)
})
