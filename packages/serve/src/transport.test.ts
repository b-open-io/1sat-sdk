import { afterAll, expect, test } from 'bun:test'
import { AuthFetch, PrivateKey, ProtoWallet } from '@bsv/sdk'
import { createAuthenticatedHandler } from './index.js'

const serverWallet = new ProtoWallet(PrivateKey.fromRandom())
const clientWallet = new ProtoWallet(PrivateKey.fromRandom())

const fetchHandler = createAuthenticatedHandler({
	wallet: serverWallet,
	handler: async (ctx) => {
		const body = (await ctx.request.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		return new Response(
			JSON.stringify({
				identityKey: ctx.identityKey,
				echo: body,
				path: ctx.url.pathname,
			}),
			{ headers: { 'content-type': 'application/json', 'x-bsv-echo': 'ok' } },
		)
	},
})

const server = Bun.serve({ port: 0, fetch: fetchHandler })
afterAll(() => server.stop(true))

test('round-trips an authenticated request through a real AuthFetch client', async () => {
	const client = new AuthFetch(clientWallet)
	const res = await client.fetch(`${server.url}api/echo`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ hi: 'there' }),
	})

	expect(res.status).toBe(200)
	const json = (await res.json()) as {
		identityKey: string
		echo: unknown
		path: string
	}

	const { publicKey } = await clientWallet.getPublicKey({ identityKey: true })
	// The server saw the client's real BRC-103 identity.
	expect(json.identityKey).toBe(publicKey)
	// The signed request body arrived intact.
	expect(json.echo).toEqual({ hi: 'there' })
	expect(json.path).toBe('/api/echo')
	// A signed custom response header survived the round trip.
	expect(res.headers.get('x-bsv-echo')).toBe('ok')
})

test('rejects an unauthenticated request with 401', async () => {
	const res = await fetch(`${server.url}api/echo`, { method: 'GET' })
	expect(res.status).toBe(401)
})
