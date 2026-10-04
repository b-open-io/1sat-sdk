import { describe, expect, test } from 'bun:test'
import { domainOffersHandles, parseHandle, resolveHandle } from './handles.js'

const IDENTITY =
	'0359c5f3bfe249f6c0ca99d0e9cc1517da51a511f3d04f18e47a5d7ae55f04008c'

const RESOLUTION = {
	metanetHandles: '1.0',
	handle: 'deggen',
	domain: 'lkup.net',
	identityKey: IDENTITY,
	certificate: { subject: IDENTITY, certifier: '03ab' },
	messagebox: 'https://messagebox.lkup.net',
	ttl: 3600,
	revoked: false,
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

/** Fake fetch serving a route table; records every requested URL. */
function fakeFetch(routes: Record<string, () => Response>) {
	const calls: string[] = []
	const fn = (async (input: RequestInfo | URL) => {
		const url = String(input)
		calls.push(url)
		const route = routes[url]
		return route ? route() : new Response('not found', { status: 404 })
	}) as typeof fetch
	return { fn, calls }
}

describe('parseHandle', () => {
	test('normalizes case, leading @, and strips +tag', () => {
		expect(parseHandle('@Deggen+Conf2036@LkUp.net')).toEqual({
			handle: 'deggen',
			tag: 'conf2036',
			domain: 'lkup.net',
		})
		expect(parseHandle('deggen@lkup.net')).toEqual({
			handle: 'deggen',
			domain: 'lkup.net',
		})
	})
})

describe('resolveHandle', () => {
	test('uses metanet.handles.resolve from the manifest', async () => {
		const { fn, calls } = fakeFetch({
			'https://lkup.net/manifest.json': () =>
				json({
					metanet: {
						handles: {
							version: '1.0',
							resolve: 'https://resolver.lkup.net/r',
						},
					},
				}),
			'https://resolver.lkup.net/r?handle=deggen': () => json(RESOLUTION),
		})
		const res = await resolveHandle('@deggen+conf2036@lkup.net', { fetch: fn })
		expect(res.identityKey).toBe(IDENTITY)
		expect(res.messagebox).toBe('https://messagebox.lkup.net')
		expect(res.ttl).toBe(3600)
		expect(res.revoked).toBe(false)
		expect(res.tag).toBe('conf2036')
		expect(calls).toEqual([
			'https://lkup.net/manifest.json',
			'https://resolver.lkup.net/r?handle=deggen',
		])
	})

	test('falls back to the well-known resolve path when resolve is absent', async () => {
		const { fn, calls } = fakeFetch({
			'https://lkup.net/manifest.json': () =>
				json({ metanet: { handles: { version: '1.0' } } }),
			'https://lkup.net/.well-known/metanet-handles/resolve?handle=deggen':
				() => json(RESOLUTION),
		})
		const res = await resolveHandle('deggen@lkup.net', { fetch: fn })
		expect(res.identityKey).toBe(IDENTITY)
		expect(calls[1]).toBe(
			'https://lkup.net/.well-known/metanet-handles/resolve?handle=deggen',
		)
	})

	test('treats a manifest without metanet.handles as unresolvable', async () => {
		const { fn, calls } = fakeFetch({
			'https://lkup.net/manifest.json': () =>
				json({ metanet: { trust: { publicKey: '03ab' } } }),
		})
		await expect(
			resolveHandle('deggen@lkup.net', { fetch: fn }),
		).rejects.toThrow('does not offer handle resolution')
		// §5.1: no probe of the well-known path
		expect(calls).toEqual(['https://lkup.net/manifest.json'])
	})

	test('rejects a certificate whose subject is not the identity key', async () => {
		const { fn } = fakeFetch({
			'https://lkup.net/manifest.json': () =>
				json({ metanet: { handles: { version: '1.0' } } }),
			'https://lkup.net/.well-known/metanet-handles/resolve?handle=deggen':
				() =>
					json({
						...RESOLUTION,
						certificate: { subject: `02${'11'.repeat(32)}` },
					}),
		})
		await expect(
			resolveHandle('deggen@lkup.net', { fetch: fn }),
		).rejects.toThrow('certificate subject does not match')
	})

	test('surfaces the endpoint error status and code', async () => {
		const { fn } = fakeFetch({
			'https://lkup.net/manifest.json': () =>
				json({ metanet: { handles: { version: '1.0' } } }),
			'https://lkup.net/.well-known/metanet-handles/resolve?handle=nobody':
				() =>
					json(
						{
							metanetHandles: '1.0',
							error: { code: 'handle-not-found', message: 'x' },
						},
						404,
					),
		})
		await expect(
			resolveHandle('nobody@lkup.net', { fetch: fn }),
		).rejects.toThrow('404 handle-not-found')
	})
})

describe('domainOffersHandles', () => {
	test('true when the manifest carries metanet.handles', async () => {
		const { fn } = fakeFetch({
			'https://lkup.net/manifest.json': () =>
				json({ metanet: { handles: { version: '1.0' } } }),
		})
		expect(await domainOffersHandles('lkup.net', { fetch: fn })).toBe(true)
	})

	test('false when the manifest is absent, not JSON, or has no metanet.handles', async () => {
		const missing = fakeFetch({})
		expect(
			await domainOffersHandles('example.com', { fetch: missing.fn }),
		).toBe(false)
		const plain = fakeFetch({
			'https://example.com/manifest.json': () => json({ name: 'x' }),
		})
		expect(await domainOffersHandles('example.com', { fetch: plain.fn })).toBe(
			false,
		)
		const html = fakeFetch({
			'https://example.com/manifest.json': () => new Response('<html></html>'),
		})
		expect(await domainOffersHandles('example.com', { fetch: html.fn })).toBe(
			false,
		)
	})

	test('throws on any other error status', async () => {
		const { fn } = fakeFetch({
			'https://lkup.net/manifest.json': () => json({}, 500),
		})
		await expect(
			domainOffersHandles('lkup.net', { fetch: fn }),
		).rejects.toThrow('500')
	})
})
