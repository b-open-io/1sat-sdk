import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
	type BearerServerHandle,
	createBearerServer,
} from '../src/createBearerServer'
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
		getSettings: async () => ({ chain: 'test', tag: 'bearer-server' }),
	} as unknown as WalletStorageProvider
}

describe('createBearerServer', () => {
	let handle: BearerServerHandle

	beforeAll(async () => {
		handle = createBearerServer({
			storage: makeStorage(),
			token: TOKEN,
			port: 0,
		})
		await handle.ready
	})

	afterAll(async () => {
		await handle.stop()
	})

	test('dispatches getSettings with valid bearer auth', async () => {
		const res = await fetch(`http://localhost:${handle.port}/`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${TOKEN}`,
				'x-identity-key': PUBKEY,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'getSettings',
				params: [],
				id: 1,
			}),
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as { result: { tag: string } }
		expect(body.result.tag).toBe('bearer-server')
	})

	test('returns 401 without bearer token', async () => {
		const res = await fetch(`http://localhost:${handle.port}/`, {
			method: 'POST',
			headers: { 'x-identity-key': PUBKEY, 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'getSettings',
				params: [],
				id: 2,
			}),
		})
		expect(res.status).toBe(401)
	})
})
