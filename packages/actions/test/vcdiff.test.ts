import { describe, expect, it } from 'bun:test'
import { VcdiffError, vcdiffDecode, vcdiffEncode } from '../src/ordfs/vcdiff'

const enc = (s: string) => new TextEncoder().encode(s)

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
	const out = new Uint8Array(
		await Bun.file(args[args.length - 1]).arrayBuffer(),
	)
	return { ok: true, out, err }
}

describe('vcdiff roundtrip', () => {
	it('append: delta is small and round-trips', async () => {
		const base = enc('hello world, this is the base file with some content')
		const target = enc(
			'hello world, this is the base file with some content AND AN APPEND',
		)
		const delta = await vcdiffEncode(target, base)
		expect(delta[0]).toBe(0xd6)
		expect(delta[3]).toBe(0x00)
		expect(delta[4]).toBe(0x00)
		expect(delta.length).toBeLessThan(target.length)
		expect(await vcdiffDecode(delta, base)).toEqual(target)
	})

	it('edit in the middle', async () => {
		const parts = Array.from(
			{ length: 500 },
			(_, i) => `line ${i} of the base\n`,
		)
		const base = enc(parts.join(''))
		const edited = [...parts]
		edited[250] = 'line 250 of the BASE, EDITED\n'
		const target = enc(edited.join(''))
		const delta = await vcdiffEncode(target, base)
		expect(delta.length).toBeLessThan(target.length / 4)
		expect(await vcdiffDecode(delta, base)).toEqual(target)
	})

	it('from-scratch (no dictionary) is pure ADD', async () => {
		const target = enc('fresh file with no base'.repeat(10))
		const delta = await vcdiffEncode(target)
		expect(await vcdiffDecode(delta)).toEqual(target)
	})

	it('empty target', async () => {
		const delta = await vcdiffEncode(new Uint8Array(0), enc('base'))
		expect(await vcdiffDecode(delta, enc('base'))).toEqual(new Uint8Array(0))
	})

	it('binary data with long runs and repeated blocks', async () => {
		const base = new Uint8Array(70000)
		for (let i = 0; i < base.length; i++) base[i] = (i * 31) & 0xff
		const target = new Uint8Array(base.length)
		target.set(base)
		target.fill(0xab, 1000, 40000)
		target.set(base.subarray(0, 5000), 50000)
		const delta = await vcdiffEncode(target, base)
		expect(delta.length).toBeLessThan(base.length / 4)
		expect(await vcdiffDecode(delta, base)).toEqual(target)
	})
})

describe('vcdiff strict decode', () => {
	it('rejects bad magic', async () => {
		expect(vcdiffDecode(enc('not a delta!!'))).rejects.toThrow(VcdiffError)
	})
	it('rejects non-zero version byte (what vcdiff-wasm emits)', async () => {
		const base = enc('AAAA base content for testing')
		const delta = await vcdiffEncode(
			enc('AAAA base content for testing PLUS'),
			base,
		)
		const bad = new Uint8Array(delta)
		bad[3] = 0x53
		expect(vcdiffDecode(bad, base)).rejects.toThrow(/version/)
	})
	it('rejects non-zero Hdr_Indicator', async () => {
		const base = enc('AAAA base content for testing')
		const delta = await vcdiffEncode(
			enc('AAAA base content for testing PLUS'),
			base,
		)
		const bad = new Uint8Array(delta)
		bad[4] = 0x01
		expect(vcdiffDecode(bad, base)).rejects.toThrow(/Hdr_Indicator/)
	})
	it('rejects truncated sections', async () => {
		expect(
			vcdiffDecode(new Uint8Array([0xd6, 0xc3, 0xc4, 0x00]), enc('x')),
		).rejects.toThrow(VcdiffError)
	})
})

describe('xdelta3 interoperability', () => {
	const hasXdelta = Bun.which('xdelta3') !== null

	it.skipIf(!hasXdelta)('xdelta3 decodes OUR delta', async () => {
		const base = enc(
			'AAAA base content for testing, with enough length to hash',
		)
		const target = enc(
			'AAAA base content for testing, with enough length to hash AND MORE APPENDED CONTENT HERE',
		)
		await Bun.write('/tmp/v-base.bin', base)
		await Bun.write('/tmp/v-delta.bin', await vcdiffEncode(target, base))
		const res = await xdelta3([
			'-f',
			'-d',
			'-s',
			'/tmp/v-base.bin',
			'/tmp/v-delta.bin',
			'/tmp/v-out.bin',
		])
		expect(res.ok).toBe(true)
		expect(res.out).toEqual(target)
	}, 15000)

	it.skipIf(!hasXdelta)('we decode xdelta3 -e -n -S none -A', async () => {
		const base = enc(
			'BBBB base content for testing, with enough length to hash and match',
		)
		const target = enc(
			'BBBB base content for testing, with enough length to hash and match THEN SOME NEW TAIL',
		)
		await Bun.write('/tmp/v-base2.bin', base)
		await Bun.write('/tmp/v-target2.bin', target)
		const res = await xdelta3([
			'-f',
			'-e',
			'-n',
			'-S',
			'none',
			'-A',
			'-s',
			'/tmp/v-base2.bin',
			'/tmp/v-target2.bin',
			'/tmp/v-delta2.bin',
		])
		expect(res.ok).toBe(true)
		const delta = new Uint8Array(
			await Bun.file('/tmp/v-delta2.bin').arrayBuffer(),
		)
		expect(delta[4]).toBe(0x00)
		expect(await vcdiffDecode(delta, base)).toEqual(target)
	}, 15000)
})
