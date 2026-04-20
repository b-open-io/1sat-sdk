import { describe, expect, test } from 'bun:test'
import { createWalletRpcHandler } from '../src/createWalletRpcHandler'
import { bearerResolver } from '../src/resolvers/bearer'
import type { WalletStorageProvider } from '../src/types'

const PUBKEY = '02'.padEnd(66, 'a')
const TOKEN = 'test-token'

function makeStorage(): WalletStorageProvider {
	return {
		findOrInsertUser: async (identityKey: string) => ({
			user: {
				userId: 1,
				identityKey,
				created_at: new Date(),
				updated_at: new Date(),
			},
			isNew: false,
		}),
		getSettings: async () => ({ chain: 'test' }),
	} as unknown as WalletStorageProvider
}

function rpcRequest(
	body: unknown,
	headers: Record<string, string> = {},
): Request {
	return new Request('http://internal/', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${TOKEN}`,
			'x-identity-key': PUBKEY,
			'content-type': 'application/json',
			...headers,
		},
		body: JSON.stringify(body),
	})
}

describe('createWalletRpcHandler', () => {
	test('dispatches a valid JSON-RPC request', async () => {
		const handler = createWalletRpcHandler({
			storage: makeStorage(),
			resolveIdentity: bearerResolver({ token: TOKEN }),
		})
		const res = await handler(
			rpcRequest({ jsonrpc: '2.0', method: 'getSettings', params: [], id: 1 }),
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			result?: { chain: string }
			id: number
		}
		expect(body.id).toBe(1)
		expect(body.result?.chain).toBe('test')
	})

	test('rejects non-POST methods', async () => {
		const handler = createWalletRpcHandler({
			storage: makeStorage(),
			resolveIdentity: bearerResolver({ token: TOKEN }),
		})
		const res = await handler(
			new Request('http://internal/', { method: 'GET' }),
		)
		expect(res.status).toBe(405)
	})

	test('returns 401 on bearer auth failure', async () => {
		const handler = createWalletRpcHandler({
			storage: makeStorage(),
			resolveIdentity: bearerResolver({ token: TOKEN }),
		})
		const res = await handler(
			rpcRequest(
				{ jsonrpc: '2.0', method: 'getSettings', params: [], id: 2 },
				{ authorization: 'Bearer wrong' },
			),
		)
		expect(res.status).toBe(401)
	})

	test('returns invalid-request for malformed JSON-RPC envelope', async () => {
		const handler = createWalletRpcHandler({
			storage: makeStorage(),
			resolveIdentity: bearerResolver({ token: TOKEN }),
		})
		const res = await handler(rpcRequest({ not: 'jsonrpc' }))
		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: { code: number } }
		expect(body.error.code).toBe(-32600)
	})

	test('returns invalid-request when body is not JSON', async () => {
		const handler = createWalletRpcHandler({
			storage: makeStorage(),
			resolveIdentity: bearerResolver({ token: TOKEN }),
		})
		const res = await handler(
			new Request('http://internal/', {
				method: 'POST',
				headers: {
					authorization: `Bearer ${TOKEN}`,
					'x-identity-key': PUBKEY,
					'content-type': 'application/json',
				},
				body: 'not-json',
			}),
		)
		expect(res.status).toBe(400)
	})
})
