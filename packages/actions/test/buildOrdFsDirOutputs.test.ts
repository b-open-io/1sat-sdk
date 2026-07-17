import { describe, expect, it } from 'bun:test'
import { B, MAP } from '@1sat/templates'
import { PrivateKey, Script, Utils } from '@bsv/sdk'
import { buildOrdFsDirOutputs } from '../src/ordfs/outputs'

const addr = PrivateKey.fromRandom().toPublicKey().toAddress()
const bytes = (s: string) => new Uint8Array(Utils.toArray(s, 'utf8'))

describe('buildOrdFsDirOutputs', () => {
	it('builds file, subdir, and root-manifest outputs; only the root is isManifest', async () => {
		const res = await buildOrdFsDirOutputs(
			[
				{
					path: 'theme.json',
					content: bytes('{"x":1}'),
					contentType: 'application/json',
				},
				{
					path: 'refs/a.md',
					content: bytes('hi'),
					contentType: 'text/markdown',
				},
			],
			{
				locking: { address: addr },
				map: { app: 'test', type: 'registry:file' },
			},
		)

		// 2 files + 1 subdir manifest + 1 root manifest
		expect(res.outputs).toHaveLength(4)
		expect(res.manifestVout).toBe(3)
		expect(res.outputs.map((o) => o.isManifest)).toEqual([
			false,
			false,
			false,
			true,
		])
		for (const o of res.outputs) {
			expect(o.satoshis).toBe(1)
			expect(o.lockingScriptHex.length).toBeGreaterThan(0)
		}
	})

	it('is MAP-agnostic: the suffix is present only when map is supplied', async () => {
		const file = {
			path: 'a.json',
			content: bytes('1'),
			contentType: 'application/json',
		}
		const withMap = await buildOrdFsDirOutputs([file], {
			locking: { address: addr },
			map: { app: 'x', type: 'y' },
		})
		const without = await buildOrdFsDirOutputs([file], {
			locking: { address: addr },
		})
		// The MAP suffix lengthens the root manifest's locking script.
		expect(
			withMap.outputs[withMap.manifestVout].lockingScriptHex.length,
		).toBeGreaterThan(
			without.outputs[without.manifestVout].lockingScriptHex.length,
		)
	})

	describe("writeMode: 'b'", () => {
		it('writes every output as a 0-sat B protocol output, ignoring locking', async () => {
			const res = await buildOrdFsDirOutputs(
				[
					{
						path: 'a.json',
						content: bytes('{"x":1}'),
						contentType: 'application/json',
					},
					{
						path: 'refs/a.md',
						content: bytes('hi'),
						contentType: 'text/markdown',
					},
				],
				{ writeMode: 'b' },
			)

			expect(res.outputs).toHaveLength(4)
			for (const o of res.outputs) {
				expect(o.satoshis).toBe(0)
			}
		})

		it('composes B + MAP into one combined OP_RETURN that both templates can decode', async () => {
			const file = {
				path: 'a.json',
				content: bytes('1'),
				contentType: 'application/json',
			}
			const map = { app: 'x', type: 'y' }

			const res = await buildOrdFsDirOutputs([file], { writeMode: 'b', map })

			const manifestScript = Script.fromHex(
				res.outputs[res.manifestVout].lockingScriptHex,
			)

			const decodedB = B.decode(manifestScript)
			expect(decodedB).not.toBeNull()
			expect(decodedB?.mediaType).toBe('ord-fs/json')
			expect(JSON.parse(Utils.toUTF8(decodedB?.data as number[]))).toEqual(
				res.tree.root,
			)

			const decodedMap = MAP.decode(manifestScript)
			expect(decodedMap).not.toBeNull()
			expect(decodedMap?.data).toEqual(map)
		})

		it('requires no locking strategy at all', async () => {
			const file = {
				path: 'a.txt',
				content: bytes('hi'),
				contentType: 'text/plain',
			}
			// No `locking` supplied — must not throw, unlike 'inscription' mode.
			const res = await buildOrdFsDirOutputs([file], { writeMode: 'b' })
			// 1 file + 1 root manifest.
			expect(res.outputs).toHaveLength(2)
		})

		it("throws when 'inscription' mode is used without a locking strategy", async () => {
			const file = {
				path: 'a.txt',
				content: bytes('hi'),
				contentType: 'text/plain',
			}
			await expect(
				buildOrdFsDirOutputs([file], { writeMode: 'inscription' }),
			).rejects.toThrow(/locking.*is required/)
		})
	})
})
