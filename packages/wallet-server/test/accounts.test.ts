import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'
import express, { type Express } from 'express'
import knexLib from 'knex'
import type { Knex } from 'knex'
import { mountRegistrationRoutes } from '../src/accounts/registrationRoutes'
import {
	AlreadyRegisteredError,
	KnexAccountStore,
	NotRegisteredError,
	UsernameTakenError,
	normalizeAvatarOrigin,
	normalizeDisplayName,
	normalizeUsername,
} from '../src/accounts/store'
import { createAccountResolver } from '../src/paymail/resolvers'
import { mountPaymailRoutes } from '../src/paymail/routes'
import type { PendingStore } from '../src/paymail/types'

const IDENTITY_A = '02'.padEnd(66, 'a')
const IDENTITY_B = '03'.padEnd(66, 'b')
const ORIGIN = `${'ab'.repeat(32)}_0`

const pendingStore: PendingStore = {
	async create() {},
	async get() {
		return null
	},
	async update() {},
	async delete() {},
}

function memoryKnex(): Knex {
	return (knexLib as unknown as typeof knexLib)({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	})
}

async function listen(app: Express): Promise<{ server: Server; base: string }> {
	const server = app.listen(0)
	await new Promise<void>((resolve) => server.once('listening', resolve))
	const addr = server.address()
	const port = typeof addr === 'object' && addr ? addr.port : 0
	return { server, base: `http://127.0.0.1:${port}` }
}

describe('normalizers', () => {
	test('username lowercases, trims, and validates shape', () => {
		expect(normalizeUsername('  Alice-1 ')).toBe('alice-1')
		expect(normalizeUsername('ab')).toBeNull()
		expect(normalizeUsername('-alice')).toBeNull()
		expect(normalizeUsername('alice-')).toBeNull()
		expect(normalizeUsername('al ice')).toBeNull()
		expect(normalizeUsername('a'.repeat(64))).toBeNull()
		expect(normalizeUsername(undefined)).toBeNull()
	})

	test('display name: trim, empty clears, over-long invalid', () => {
		expect(normalizeDisplayName('  Alice ')).toBe('Alice')
		expect(normalizeDisplayName('')).toBeNull()
		expect(normalizeDisplayName(null)).toBeNull()
		expect(normalizeDisplayName('x'.repeat(65))).toBeUndefined()
		expect(normalizeDisplayName(42)).toBeUndefined()
	})

	test('avatar origin must be txid_vout', () => {
		expect(normalizeAvatarOrigin(ORIGIN.toUpperCase())).toBe(ORIGIN)
		expect(normalizeAvatarOrigin('')).toBeNull()
		expect(normalizeAvatarOrigin('not-an-outpoint')).toBeUndefined()
		expect(normalizeAvatarOrigin(`${'ab'.repeat(32)}`)).toBeUndefined()
	})
})

describe('KnexAccountStore', () => {
	let db: Knex
	let store: KnexAccountStore

	beforeAll(async () => {
		db = memoryKnex()
		store = new KnexAccountStore(db)
		await store.init()
	})

	afterAll(async () => {
		await db.destroy()
	})

	test('register then look up by username and identity', async () => {
		const created = await store.register(IDENTITY_A, 'Alice', {
			displayName: 'Alice A.',
		})
		expect(created.username).toBe('alice')
		expect(created.displayName).toBe('Alice A.')
		expect(created.avatarOrigin).toBeUndefined()

		expect((await store.getByUsername('ALICE'))?.identityKey).toBe(IDENTITY_A)
		expect((await store.getByIdentity(IDENTITY_A))?.username).toBe('alice')
	})

	test('re-registering the same username is idempotent', async () => {
		const again = await store.register(IDENTITY_A, 'alice')
		expect(again.username).toBe('alice')
		expect(again.displayName).toBe('Alice A.')
	})

	test('an identity cannot take a second username', async () => {
		await expect(store.register(IDENTITY_A, 'alice2')).rejects.toThrow(
			AlreadyRegisteredError,
		)
		expect(await store.getByUsername('alice2')).toBeNull()
	})

	test('a username cannot be taken by a second identity', async () => {
		await expect(store.register(IDENTITY_B, 'alice')).rejects.toThrow(
			UsernameTakenError,
		)
		expect((await store.getByUsername('alice'))?.identityKey).toBe(IDENTITY_A)
	})

	test('profile updates: set, leave unchanged, clear', async () => {
		const withAvatar = await store.updateProfile(IDENTITY_A, {
			avatarOrigin: ORIGIN,
		})
		expect(withAvatar.avatarOrigin).toBe(ORIGIN)
		expect(withAvatar.displayName).toBe('Alice A.')

		const cleared = await store.updateProfile(IDENTITY_A, {
			displayName: null,
		})
		expect(cleared.displayName).toBeUndefined()
		expect(cleared.avatarOrigin).toBe(ORIGIN)
	})

	test('profile update on an unregistered identity throws', async () => {
		await expect(
			store.updateProfile(IDENTITY_B, { displayName: 'Bob' }),
		).rejects.toThrow(NotRegisteredError)
	})

	test('init is idempotent', async () => {
		await store.init()
		expect((await store.getByUsername('alice'))?.identityKey).toBe(IDENTITY_A)
	})
})

describe('createAccountResolver', () => {
	test('maps username to identity with profile', async () => {
		const db = memoryKnex()
		const store = new KnexAccountStore(db)
		await store.init()
		await store.register(IDENTITY_A, 'bob')
		const resolver = createAccountResolver(store)

		const plain = await resolver.resolve('bob', '1sat.app')
		expect(plain?.identityKey).toBe(IDENTITY_A)
		expect(plain?.profileName).toBe('bob')
		expect(plain?.avatarOrigin).toBeUndefined()

		await store.updateProfile(IDENTITY_A, {
			displayName: 'Bob B.',
			avatarOrigin: ORIGIN,
		})
		const withProfile = await resolver.resolve('bob', '1sat.app')
		expect(withProfile?.profileName).toBe('Bob B.')
		expect(withProfile?.avatarOrigin).toBe(ORIGIN)

		expect(await resolver.resolve('nobody', '1sat.app')).toBeNull()
		await db.destroy()
	})
})

describe('registration routes', () => {
	let db: Knex
	let server: Server
	let base: string
	let identity = IDENTITY_A

	beforeAll(async () => {
		db = memoryKnex()
		const store = new KnexAccountStore(db)
		await store.init()

		const app = express()
		app.use(express.json())
		// Stand-in for the BRC-104 middleware: stamps whichever identity the
		// test currently selects.
		app.use('/account', (req, _res, next) => {
			;(req as { auth?: { identityKey: string } }).auth = {
				identityKey: identity,
			}
			next()
		})
		mountRegistrationRoutes(app, '/', { store })
		;({ server, base } = await listen(app))
	})

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()))
		await db.destroy()
	})

	async function post(path: string, body: unknown, method = 'POST') {
		return fetch(`${base}${path}`, {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		})
	}

	test('rejects a malformed username', async () => {
		const res = await post('/account/register', { username: 'A' })
		expect(res.status).toBe(400)
	})

	test('rejects a malformed profile field before claiming', async () => {
		const res = await post('/account/register', {
			username: 'alice',
			avatarOrigin: 'nope',
		})
		expect(res.status).toBe(400)
		expect(
			(await post('/account/register', { username: 'alice' })).status,
		).toBe(200)
	})

	test('registers with profile and echoes the account', async () => {
		identity = IDENTITY_B
		const res = await post('/account/register', {
			username: 'Bob',
			displayName: 'Bob B.',
			avatarOrigin: ORIGIN,
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, unknown>
		expect(body.identityKey).toBe(IDENTITY_B)
		expect(body.username).toBe('bob')
		expect(body.displayName).toBe('Bob B.')
		expect(body.avatarOrigin).toBe(ORIGIN)
		expect(typeof body.createdAt).toBe('string')
	})

	test('409 when the username is held or the identity already registered', async () => {
		identity = IDENTITY_B
		expect(
			(await post('/account/register', { username: 'alice' })).status,
		).toBe(409)
		expect((await post('/account/register', { username: 'bob2' })).status).toBe(
			409,
		)
	})

	test('profile edits merge and clear', async () => {
		identity = IDENTITY_B
		const res = await post('/account/profile', { displayName: null }, 'PUT')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, unknown>
		expect(body.displayName).toBeUndefined()
		expect(body.avatarOrigin).toBe(ORIGIN)
	})

	test('profile edit without an account is 404', async () => {
		identity = '04'.padEnd(66, 'c')
		const res = await post('/account/profile', { displayName: 'x' }, 'PUT')
		expect(res.status).toBe(404)
	})
})

describe('mountPaymailRoutes domain dispatch', () => {
	let server: Server
	let base: string
	let db: Knex

	beforeAll(async () => {
		db = memoryKnex()
		const store = new KnexAccountStore(db)
		await store.init()
		await store.register(IDENTITY_A, 'alice', { displayName: 'Alice A.' })

		const app = express()
		await mountPaymailRoutes(app, {
			baseUrl: 'https://1sat.app',
			stackUrl: 'http://127.0.0.1:1',
			pendingStore,
			userDomain: '1sat.app',
			accountStore: store,
		})
		;({ server, base } = await listen(app))
	})

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()))
		await db.destroy()
	})

	test('resolves registered alias on userDomain', async () => {
		const res = await fetch(`${base}/bsvalias/id/alice@1sat.app`)
		expect(res.status).toBe(200)
		const body = (await res.json()) as { handle: string; pubkey: string }
		expect(body.handle).toBe('alice@1sat.app')
		expect(body.pubkey).toBe(IDENTITY_A)
	})

	test('public profile serves the stored display name', async () => {
		const res = await fetch(`${base}/bsvalias/public-profile/alice@1sat.app`)
		expect(res.status).toBe(200)
		const body = (await res.json()) as { name: string; avatar: string }
		expect(body.name).toBe('Alice A.')
		expect(body.avatar).toBe('')
	})

	test('unknown alias on userDomain is 404', async () => {
		const res = await fetch(`${base}/bsvalias/id/nobody@1sat.app`)
		expect(res.status).toBe(404)
	})

	test('capability document follows the request Host', async () => {
		const direct = await fetch(`${base}/.well-known/bsvalias`)
		expect(direct.status).toBe(200)
		const doc = (await direct.json()) as {
			bsvalias: string
			capabilities: Record<string, string>
		}
		expect(doc.bsvalias).toBe('1.0')
		expect(doc.capabilities.pki).toContain(base.replace('http://', ''))

		const proxied = await fetch(`${base}/.well-known/bsvalias`, {
			headers: {
				'x-forwarded-host': '1sat.app',
				'x-forwarded-proto': 'https',
			},
		})
		const proxiedDoc = (await proxied.json()) as {
			capabilities: Record<string, string>
		}
		expect(proxiedDoc.capabilities.pki).toBe(
			'https://1sat.app/bsvalias/id/{alias}@{domain.tld}',
		)
	})
})
