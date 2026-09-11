import { describe, expect, it } from 'bun:test'
import { OneSatBrowserProvider } from '../src/provider'

describe('createListing disable (OPL-4700)', () => {
	it('refuses new listing create without RPC', async () => {
		const provider = new OneSatBrowserProvider({
			popupUrl: 'https://example.com',
		})
		await expect(
			provider.createListing({ outpoints: ['x.0'], priceSatoshis: 1 }),
		).rejects.toThrow(
			'OrdLock listing create is disabled. Buy and cancel of existing listings remain available.',
		)
	})
})
