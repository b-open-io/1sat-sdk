import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PrivateKey, ProtoWallet, type WalletInterface } from '@bsv/sdk'
import express from 'express'
import { createHostServer } from '../src/createHostServer'
import {
	type WalletServerHandle,
	createWalletServer,
} from '../src/createWalletServer'
import type { WalletStorageProvider } from '../src/types'
import { mountStorageV1 } from '../src/v1'

const IDENTITY = '02'.padEnd(66, 'a')
const SERVER_PRIV = PrivateKey.fromRandom()
const SERVER_IDENTITY = SERVER_PRIV.toPublicKey().toString()
const SERVER_WALLET = new ProtoWallet(SERVER_PRIV) as unknown as WalletInterface

const SETTINGS = {
	storageIdentityKey: '03'.padEnd(66, 'b'),
	storageName: 'test-storage',
	chain: 'test',
	dbtype: 'SQLite',
	maxOutputScript: 1024,
	created_at: new Date('2026-01-01T00:00:00.000Z'),
	updated_at: new Date('2026-01-01T00:00:00.000Z'),
}

function makeStorage(
	overrides: Record<string, (...args: unknown[]) => unknown> = {},
): WalletStorageProvider {
	return {
		makeAvailable: async () => SETTINGS,
		getSettings: async () => ({ chain: 'test', tag: 'rpc' }),
		findOrInsertUser: async (identityKey: string) => ({
			user: {
				userId: 7,
				identityKey,
				created_at: new Date(),
				updated_at: new Date(),
			},
			isNew: false,
		}),
		listOutputs: async () => ({ totalOutputs: 0, outputs: [] }),
		createAction: async () => ({ inputBeef: new Uint8Array([1, 2, 3]) }),
		...overrides,
	} as unknown as WalletStorageProvider
}

async function listen(
	app: express.Express,
): Promise<{ port: number; close: () => Promise<void> }> {
	const server = app.listen(0)
	const address = server.address()
	const port = typeof address === 'object' && address ? address.port : 0
	return {
		port,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()))
			}),
	}
}

function stubAuth(identity = IDENTITY) {
	return (
		req: express.Request,
		_res: express.Response,
		next: express.NextFunction,
	) => {
		;(req as { auth?: { identityKey: string } }).auth = {
			identityKey: identity,
		}
		next()
	}
}

describe('storage v1 adapter', () => {
	let port: number
	let close: () => Promise<void>
	let lastCreateArgs: unknown[] | undefined

	beforeAll(async () => {
		const app = express()
		app.use(express.json())
		mountStorageV1(
			app,
			{
				storage: makeStorage({
					createAction: (...args) => {
						lastCreateArgs = args
						return { inputBeef: new Uint8Array([1, 2, 3]) }
					},
				}),
			},
			{ authMiddleware: stubAuth() },
		)
		;({ port, close } = await listen(app))
	})

	afterAll(async () => {
		await close()
	})

	test('authenticated GET /storage/v1/settings returns TableSettings', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/storage/v1/settings`)
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, unknown>
		expect(body.storageIdentityKey).toBe(SETTINGS.storageIdentityKey)
		expect(body.storageName).toBe('test-storage')
		expect(body.chain).toBe('test')
		expect(body.dbtype).toBe('SQLite')
		expect(body.maxOutputScript).toBe(1024)
		expect(body.error).toBeUndefined()
		expect(body.status).toBeUndefined()
	})

	test('POST /storage/v1/users finds the authenticated identity', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/storage/v1/users`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ identityKey: IDENTITY }),
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as { user: { userId: number } }
		expect(body.user.userId).toBe(7)
	})

	test('POST /storage/v1/users rejects a mismatched identityKey', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/storage/v1/users`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ identityKey: '03'.padEnd(66, 'c') }),
		})
		expect(res.status).toBe(401)
		expect(await res.json()).toEqual({
			error: 'identityKey does not match authentication',
		})
	})

	test('POST /storage/v1/actions requires args', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/storage/v1/actions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({}),
		})
		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({ error: 'args is required' })
	})

	test('POST /storage/v1/actions dispatches createAction and encodes bytes', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/storage/v1/actions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ args: { description: 'pay' } }),
		})
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ inputBeef: [1, 2, 3] })
		expect(lastCreateArgs?.[1]).toEqual({ description: 'pay' })
	})

	test('POST /storage/v1/list/outputs unwraps args', async () => {
		const res = await fetch(
			`http://127.0.0.1:${port}/storage/v1/list/outputs`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ args: { basket: 'default' } }),
			},
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ totalOutputs: 0, outputs: [] })
	})

	test('POST /storage/v1/migrate is 400 when the provider has no migrate', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/storage/v1/migrate`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				storageName: 'x',
				storageIdentityKey: 'y',
			}),
		})
		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({ error: 'Method not found: migrate' })
	})

	test('unknown v1 path is { error } 404, not ERR_INTERNAL', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/storage/v1/nope`, {
			method: 'POST',
		})
		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string; code?: string }
		expect(body.error).toMatch(/not found/)
		expect(body.code).toBeUndefined()
	})
})

describe('storage v1 — unauthenticated handler', () => {
	test('GET /storage/v1/settings without identity is 401 { error }', async () => {
		const app = express()
		app.use(express.json())
		mountStorageV1(app, { storage: makeStorage() })
		const { port, close } = await listen(app)
		try {
			const res = await fetch(`http://127.0.0.1:${port}/storage/v1/settings`)
			expect(res.status).toBe(401)
			expect(await res.json()).toEqual({ error: 'Authentication required' })
		} finally {
			await close()
		}
	})

	test('falls back to getSettings when makeAvailable is absent', async () => {
		const app = express()
		app.use(express.json())
		const storage = {
			getSettings: async () => SETTINGS,
			findOrInsertUser: async (identityKey: string) => ({
				user: { userId: 1, identityKey },
				isNew: false,
			}),
		} as unknown as WalletStorageProvider
		mountStorageV1(app, { storage }, { authMiddleware: stubAuth() })
		const { port, close } = await listen(app)
		try {
			const res = await fetch(`http://127.0.0.1:${port}/storage/v1/settings`)
			expect(res.status).toBe(200)
			expect(((await res.json()) as { storageName: string }).storageName).toBe(
				'test-storage',
			)
		} finally {
			await close()
		}
	})
})

describe('createWalletServer — v1 behind BRC-104', () => {
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

	test('unauthenticated GET /storage/v1/settings is rejected', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/storage/v1/settings`)
		expect([400, 401, 403].includes(res.status)).toBe(true)
		expect(res.status).not.toBe(200)
	})

	test('unauthenticated POST / JSON-RPC is still rejected', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'getSettings',
				params: [],
				id: 'rpc',
			}),
		})
		expect([400, 401, 403].includes(res.status)).toBe(true)
	})
})

describe('createHostServer — v1 behind BRC-104', () => {
	let port: number
	let stop: () => Promise<void>

	beforeAll(async () => {
		const handle = await createHostServer({
			wallet: SERVER_WALLET,
			storage: makeStorage(),
			serverIdentityKey: SERVER_IDENTITY,
			listen: { port: 0, host: '127.0.0.1' },
		})
		port = await handle.start()
		stop = () => handle.stop()
	})

	afterAll(async () => {
		await stop()
	})

	test('unauthenticated GET /storage/v1/settings is rejected', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/storage/v1/settings`)
		expect([400, 401, 403].includes(res.status)).toBe(true)
		expect(res.status).not.toBe(200)
	})

	test('GET / OpenAPI docs stay public', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/`)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/html')
	})
})
