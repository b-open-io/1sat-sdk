import { afterEach, describe, expect, test } from 'bun:test'
import { createWhatsOnChainProvider } from '../src/repricer/whatsOnChain'

const realFetch = globalThis.fetch

function mockFetch(response: { ok: boolean; status?: number; body: unknown }) {
	globalThis.fetch = (async () => ({
		ok: response.ok,
		status: response.status ?? (response.ok ? 200 : 500),
		json: async () => response.body,
		text: async () => JSON.stringify(response.body),
	})) as unknown as typeof globalThis.fetch
}

describe('createWhatsOnChainProvider', () => {
	afterEach(() => {
		globalThis.fetch = realFetch
	})

	test('parses a valid response', async () => {
		mockFetch({
			ok: true,
			body: { currency: 'USD', rate: 47.12, time: 1715000000 },
		})
		const provider = createWhatsOnChainProvider({ chain: 'main' })
		const q = await provider.getBsvUsd()
		expect(q.source).toBe('whatsonchain')
		expect(q.bsvUsd).toBe(47.12)
	})

	test('throws on non-ok status', async () => {
		mockFetch({ ok: false, status: 503, body: 'down' })
		await expect(
			createWhatsOnChainProvider({ chain: 'main' }).getBsvUsd(),
		).rejects.toThrow(/503/)
	})

	test('throws on malformed payload', async () => {
		mockFetch({ ok: true, body: { currency: 'USD' } })
		await expect(
			createWhatsOnChainProvider({ chain: 'main' }).getBsvUsd(),
		).rejects.toThrow(/rate/)
	})

	test('uses testnet URL when chain=test', async () => {
		let captured = ''
		globalThis.fetch = (async (url: string) => {
			captured = url
			return {
				ok: true,
				status: 200,
				json: async () => ({ currency: 'USD', rate: 1, time: 1 }),
				text: async () => '',
			}
		}) as unknown as typeof globalThis.fetch
		await createWhatsOnChainProvider({ chain: 'test' }).getBsvUsd()
		expect(captured).toContain('/test/')
	})
})
