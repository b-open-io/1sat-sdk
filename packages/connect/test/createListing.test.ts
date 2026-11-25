import { describe, expect, it } from 'bun:test'
import { WalletNotConnectedError } from '../src/errors'
import { OneSatBrowserProvider } from '../src/provider'
import { RpcMethods } from '../src/types'

type ProviderInternals = {
	connection: unknown
	popupManager: {
		openPopup: (method: string, requestId: string, params?: unknown) => unknown
	}
}

function providerWithStub() {
	const provider = new OneSatBrowserProvider({
		popupUrl: 'https://example.com',
	})
	const calls: Array<{ method: string; params?: unknown }> = []
	const internals = provider as unknown as ProviderInternals
	internals.popupManager.openPopup = async (method, _requestId, params) => {
		calls.push({ method, params })
		return { txid: 'listed' }
	}
	return { provider, internals, calls }
}

describe('createListing', () => {
	it('sends the CREATE_LISTING RPC when connected', async () => {
		const { provider, internals, calls } = providerWithStub()
		internals.connection = { identityKey: 'key', connectedAt: Date.now() }
		const request = { outpoints: ['x.0'], priceSatoshis: 1 }
		const result = await provider.createListing(request)
		expect(result).toEqual({ txid: 'listed' })
		expect(calls).toEqual([
			{ method: RpcMethods.CREATE_LISTING, params: request },
		])
	})

	it('requires a connection before sending', async () => {
		const { provider, internals, calls } = providerWithStub()
		internals.connection = null
		await expect(
			provider.createListing({ outpoints: ['x.0'], priceSatoshis: 1 }),
		).rejects.toBeInstanceOf(WalletNotConnectedError)
		expect(calls).toEqual([])
	})
})
