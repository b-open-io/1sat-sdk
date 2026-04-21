import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PrivateKey, ProtoWallet, type WalletInterface } from '@bsv/sdk'
import {
	type WalletServerHandle,
	createWalletServer,
} from '../src/createWalletServer'
import type { WalletStorageProvider } from '../src/types'

const TOKEN = 'test-internal-key'
const PUBKEY = '02'.padEnd(66, 'a')
const SERVER_PRIV = PrivateKey.fromRandom()
const SERVER_IDENTITY = SERVER_PRIV.toPublicKey().toString()
const SERVER_WALLET = new ProtoWallet(
	SERVER_PRIV,
) as unknown as WalletInterface

function makeStorage(): WalletStorageProvider {
	return {
		findOrInsertUser: async (identityKey: string) => ({
			user: {
				userId: 7,
				identityKey,
				created_at: new Date(),
				updated_at: new Date(),
			},
			isNew: false,
		}),
		getSettings: async () => ({ chain: 'test', tag: 'full-server' }),
	} as unknown as WalletStorageProvider
}

describe('createWalletServer — config validation', () => {
	test('throws when both routes disabled', () => {
		expect(() =>
			createWalletServer({
				storage: makeStorage(),
				wallet: SERVER_WALLET,
				serverIdentityKey: SERVER_IDENTITY,
				listen: { port: 0 },
				publicPath: null,
				internalPath: null,
			}),
		).toThrow(/at least one/)
	})

	test('throws when internal route enabled without API key', () => {
		expect(() =>
			createWalletServer({
				storage: makeStorage(),
				wallet: SERVER_WALLET,
				serverIdentityKey: SERVER_IDENTITY,
				listen: { port: 0 },
				publicPath: null,
			}),
		).toThrow(/internalAPIKey/)
	})
})

describe('createWalletServer — internal route', () => {
	let handle: WalletServerHandle
	let port: number

	beforeAll(async () => {
		handle = createWalletServer({
			storage: makeStorage(),
			wallet: SERVER_WALLET,
			serverIdentityKey: SERVER_IDENTITY,
			listen: { port: 0 },
			publicPath: null,
			internalAPIKey: TOKEN,
		})
		port = await handle.start()
	})

	afterAll(async () => {
		await handle.stop()
	})

	test('dispatches via bearer on /internal', async () => {
		const res = await fetch(`http://localhost:${port}/internal`, {
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
				id: 'a',
			}),
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as { result: { tag: string } }
		expect(body.result.tag).toBe('full-server')
	})

	test('returns 401 on /internal without bearer', async () => {
		const res = await fetch(`http://localhost:${port}/internal`, {
			method: 'POST',
			headers: { 'x-identity-key': PUBKEY, 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'getSettings',
				params: [],
				id: 'b',
			}),
		})
		expect(res.status).toBe(401)
	})
})

describe('createWalletServer — public route requires BRC-100 auth', () => {
	let handle: WalletServerHandle
	let port: number

	beforeAll(async () => {
		handle = createWalletServer({
			storage: makeStorage(),
			wallet: SERVER_WALLET,
			serverIdentityKey: SERVER_IDENTITY,
			listen: { port: 0 },
			internalPath: null,
		})
		port = await handle.start()
	})

	afterAll(async () => {
		await handle.stop()
	})

	test('rejects unauthenticated requests on /', async () => {
		const res = await fetch(`http://localhost:${port}/`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'getSettings',
				params: [],
				id: 'c',
			}),
		})
		// auth-express-middleware either rejects outright or returns a challenge;
		// either way, the request must not reach the dispatcher as authenticated.
		expect([400, 401, 403].includes(res.status)).toBe(true)
	})
})
