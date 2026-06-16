import { describe, expect, it } from 'bun:test'
import { inscribeOrdfsDir } from '../src/ordfs'
import type { OneSatContext } from '../src/types'

// These guards run before any wallet interaction, so a minimal context suffices.
const ctx = { wallet: {}, chain: 'main' } as unknown as OneSatContext
const files = [
	{ path: 'a.md', base64Content: 'aGk=', contentType: 'text/markdown' }, // "hi"
]

describe('inscribeOrdfsDir input validation', () => {
	it('rejects an empty file list', async () => {
		const res = await inscribeOrdfsDir.execute(ctx, { files: [] })
		expect(res.error).toBe('no-files')
	})

	it('rejects an unknown sign mode rather than publishing unsigned', async () => {
		const res = await inscribeOrdfsDir.execute(ctx, {
			files,
			sign: 'sigam' as never,
		})
		expect(res.error).toMatch(/invalid-sign-mode/)
	})

	it('rejects sigma together with an external funding provider', async () => {
		const res = await inscribeOrdfsDir.execute(ctx, {
			files,
			sign: 'sigma',
			fundingProvider: {
				fund: async () => ({ tx: [], txid: 'x' }),
			} as never,
		})
		expect(res.error).toMatch(/sigma-incompatible-with-funding-provider/)
	})
})
