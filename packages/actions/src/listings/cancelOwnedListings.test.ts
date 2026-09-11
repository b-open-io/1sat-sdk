import { describe, expect, it } from 'bun:test'
import { cancelOwnedListings } from './cancelOwnedListings.js'

describe('cancelOwnedListings (OPL-4696)', () => {
	it('is registered as an action that cancels, not creates', () => {
		expect(cancelOwnedListings.meta.name).toBe('cancelOwnedListings')
		expect(cancelOwnedListings.meta.description.toLowerCase()).toContain(
			'cancel',
		)
		expect(cancelOwnedListings.meta.description.toLowerCase()).not.toContain(
			'create',
		)
	})

	it('returns empty result when the wallet has no ordlock tags', async () => {
		const wallet = {
			listOutputs: async () => ({ outputs: [] }),
		}
		const result = await cancelOwnedListings.execute(
			{ wallet, chain: 'main', isBaseWallet: true } as never,
			{},
		)
		expect(result.cancelled).toBe(0)
		expect(result.txids).toEqual([])
		expect(result.errors).toEqual([])
	})

	it('skips listed outputs that have no id tag', async () => {
		const wallet = {
			listOutputs: async () => ({
				outputs: [{ outpoint: 'aa.0', tags: ['ordlock'] }],
			}),
		}
		const result = await cancelOwnedListings.execute(
			{ wallet, chain: 'main', isBaseWallet: true } as never,
			{},
		)
		expect(result.cancelled).toBe(0)
		expect(result.errors).toEqual(['aa.0: missing-id', 'aa.0: missing-id'])
	})
})
