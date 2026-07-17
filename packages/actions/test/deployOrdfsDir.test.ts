import { describe, expect, it } from 'bun:test'
import { deployOrdfsDir, inscribeOrdfsDir } from '../src/ordfs'
import type { OneSatContext } from '../src/types'

// These guards run before any wallet interaction, so a minimal context suffices.
const ctx = { wallet: {}, chain: 'main' } as unknown as OneSatContext
const files = [
	{ path: 'a.md', base64Content: 'aGk=', contentType: 'text/markdown' }, // "hi"
]

describe('deployOrdfsDir input validation', () => {
	it('rejects an empty file list', async () => {
		const res = await deployOrdfsDir.execute(ctx, { files: [] })
		expect(res.error).toBe('no-files')
	})

	it('rejects an unknown write mode', async () => {
		const res = await deployOrdfsDir.execute(ctx, {
			files,
			writeMode: 'inscriptoin' as never,
		})
		expect(res.error).toMatch(/invalid-write-mode/)
	})

	it('rejects a signed inscription publish together with an external funding provider', async () => {
		const res = await deployOrdfsDir.execute(ctx, {
			files,
			writeMode: 'inscription',
			sign: true,
			fundingProvider: {
				fund: async () => ({ tx: [], txid: 'x' }),
			} as never,
		})
		expect(res.error).toMatch(/sigma-incompatible-with-funding-provider/)
	})

	it('allows a "b" write mode publish with an external funding provider (no anchor needed)', async () => {
		const res = await deployOrdfsDir.execute(ctx, {
			files,
			writeMode: 'b',
			sign: true,
			fundingProvider: {
				fund: async () => ({ tx: [], txid: 'x' }),
			} as never,
		})
		expect(res.error).not.toMatch(/sigma-incompatible-with-funding-provider/)
	})
})

describe('inscribeOrdfsDir back-compat alias', () => {
	it('is the same action as deployOrdfsDir', () => {
		expect(inscribeOrdfsDir).toBe(deployOrdfsDir)
	})
})
