import { describe, expect, it } from 'bun:test'
import { Utils } from '@bsv/sdk'
import {
	DIR_VERSION,
	DirFormatError,
	type DirManifest,
	dirDecode,
	dirDefault,
	dirEncode,
	dirName,
	dirNameString,
} from '../src/ordfs/dir'

const hex = (s: string) => new Uint8Array(Utils.toArray(s, 'hex'))
const text = (s: string) => dirName(s)

const LICENSE_TXID = 'aa'.repeat(32)

/** The worked example from docs/plans/ordfs-formats.html */
const example: DirManifest = {
	version: DIR_VERSION,
	entries: [
		{
			name: text('README.md'),
			isDir: false,
			ref: { kind: 'same-tx', vout: 1 },
		},
		{
			name: text('LICENSE'),
			isDir: false,
			ref: { kind: 'outpoint', txid: LICENSE_TXID, vout: 3 },
		},
		{
			name: text('package.json'),
			isDir: false,
			ref: { kind: 'same-tx', vout: 6 },
		},
		{
			name: text('src'),
			isDir: true,
			ref: { kind: 'same-tx', vout: 11 },
		},
	],
}

const exampleBytes = hex(
	`01000408074c4943454e5345${LICENSE_TXID}030000000009524541444d452e6d6401000c7061636b6167652e6a736f6e0601037372630b`,
)

describe('dirEncode', () => {
	it('matches the spec worked example byte-for-byte', () => {
		const out = dirEncode(example)
		expect(Utils.toHex(out)).toBe(Utils.toHex(exampleBytes))
	})

	it('sorts entries regardless of input order (canonical form)', () => {
		const shuffled: DirManifest = {
			version: DIR_VERSION,
			entries: [...example.entries].reverse(),
		}
		expect(Utils.toHex(dirEncode(shuffled))).toBe(
			Utils.toHex(dirEncode(example)),
		)
	})

	it('encodes exec and symlink flags', () => {
		const out = dirEncode({
			version: DIR_VERSION,
			entries: [
				{
					name: text('run.sh'),
					isDir: false,
					exec: true,
					ref: { kind: 'same-tx', vout: 0 },
				},
				{
					name: text('link'),
					isDir: false,
					symlink: true,
					ref: { kind: 'same-tx', vout: 1 },
				},
			],
		})
		// canonical order: "link" < "run.sh"; flags: symlink 0x04, exec 0x02
		expect(out[3]).toBe(0x04)
		expect(out).toContain(0x02)
	})

	it('rejects duplicate names, slashes, NULs, oversized names', () => {
		expect(() =>
			dirEncode({
				version: DIR_VERSION,
				entries: [
					{ name: text('a'), isDir: false, ref: { kind: 'same-tx', vout: 0 } },
					{ name: text('a'), isDir: true, ref: { kind: 'same-tx', vout: 1 } },
				],
			}),
		).toThrow(DirFormatError)
		expect(() => dirName('bad/name')).toThrow(DirFormatError)
		expect(() => dirName('bad\0name')).toThrow(DirFormatError)
		expect(() => dirName('x'.repeat(256))).toThrow(DirFormatError)
	})

	it('rejects same-tx vouts above 255', () => {
		expect(() =>
			dirEncode({
				version: DIR_VERSION,
				entries: [
					{
						name: text('a'),
						isDir: false,
						ref: { kind: 'same-tx', vout: 256 },
					},
				],
			}),
		).toThrow(DirFormatError)
	})
})

describe('dirDecode', () => {
	it('decodes the spec worked example', () => {
		const m = dirDecode(exampleBytes)
		expect(m.version).toBe(DIR_VERSION)
		expect(m.entries.map((e) => dirNameString(e.name))).toEqual([
			'LICENSE',
			'README.md',
			'package.json',
			'src',
		])
		expect(m.entries[0].ref).toEqual({
			kind: 'outpoint',
			txid: LICENSE_TXID,
			vout: 3,
		})
		expect(m.entries[3]).toMatchObject({ isDir: true })
	})

	it('round-trips', () => {
		expect(dirDecode(dirEncode(example))).toEqual(dirDecode(exampleBytes))
	})

	it('rejects non-canonical (unsorted) input', () => {
		const unsorted = new Uint8Array(exampleBytes)
		// swap first two entries' order by encoding an unsorted layout manually:
		// easiest: decode, mutate, re-encode is impossible (encoder sorts), so
		// hand-craft: same header, entries in README/LICENSE order
		const swapped = hex(
			`0100040009524541444d452e6d640108074c4943454e5345${LICENSE_TXID}03000000000c7061636b6167652e6a736f6e0601037372630b`,
		)
		expect(() => dirDecode(swapped)).toThrow(DirFormatError)
		expect(unsorted.length).toBeGreaterThan(0)
	})

	it('rejects reserved flag bits, bad version, trailing bytes, truncation', () => {
		const reserved = new Uint8Array(exampleBytes)
		reserved[3] |= 0x10 // reserved bit on first entry
		expect(() => dirDecode(reserved)).toThrow(DirFormatError)

		const badVersion = new Uint8Array(exampleBytes)
		badVersion[0] = 0x02
		expect(() => dirDecode(badVersion)).toThrow(DirFormatError)

		expect(() => dirDecode(exampleBytes.subarray(0, 10))).toThrow(
			DirFormatError,
		)

		const trailing = new Uint8Array(exampleBytes.length + 1)
		trailing.set(exampleBytes)
		expect(() => dirDecode(trailing)).toThrow(DirFormatError)
	})

	it('rejects empty manifests silently? No: empty entry list is valid', () => {
		const empty = dirEncode({ version: DIR_VERSION, entries: [] })
		expect(empty).toEqual(new Uint8Array([0x01, 0x00, 0x00]))
		expect(dirDecode(empty).entries).toEqual([])
	})

	it('dirDefault prefers "." then index.html', () => {
		const m: DirManifest = {
			version: DIR_VERSION,
			entries: [
				{
					name: text('index.html'),
					isDir: false,
					ref: { kind: 'same-tx', vout: 1 },
				},
				{ name: text('.'), isDir: false, ref: { kind: 'same-tx', vout: 0 } },
			],
		}
		expect(dirNameString(dirDefault(m)!.name)).toBe('.')
		expect(
			dirNameString(
				dirDefault({
					version: DIR_VERSION,
					entries: [m.entries[0]],
				})!.name,
			),
		).toBe('index.html')
		expect(dirDefault({ version: DIR_VERSION, entries: [] })).toBeUndefined()
	})
})
