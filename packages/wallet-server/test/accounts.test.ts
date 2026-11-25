import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'
import { PrivateKey } from '@bsv/sdk'
import express, { type Express } from 'express'
import knexLib from 'knex'
import type { Knex } from 'knex'
import { KnexHandleCertStore } from '../src/accounts/certs'
import {
	DISABLED_REVOCATION_OUTPOINT,
	issueHandleCert,
} from '../src/accounts/issueCert'
import {
	NO_USER_DOMAIN_ERROR,
	mountRegistrationRoutes,
	registrationStatus,
} from '../src/accounts/registrationRoutes'
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
		expect(body.avatar).toBe('https://1sat.app/bsvalias/default-avatar.svg')
	})

	test('default avatar is served as svg', async () => {
		const res = await fetch(`${base}/bsvalias/default-avatar.svg`)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('image/svg+xml')
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

describe('handle certs', () => {
	let db: Knex

	beforeAll(async () => {
		db = memoryKnex()
	})

	afterAll(async () => {
		await db.destroy()
	})

	test('issue and store a 1sat.app handle cert', async () => {
		const store = new KnexHandleCertStore(db)
		await store.init()
		const host = PrivateKey.fromRandom()
		const subject = PrivateKey.fromRandom().toPublicKey().toString()
		const issued = await issueHandleCert({
			store,
			hostPrivateKey: host,
			subject,
			handle: 'alice',
			domain: '1sat.app',
			revocationOutpoint: DISABLED_REVOCATION_OUTPOINT,
		})
		expect(issued.handle).toBe('alice')
		expect(issued.domain).toBe('1sat.app')
		expect(issued.subject).toBe(subject)
		expect(issued.certifier).toBe(host.toPublicKey().toString())
		expect(issued.signature.length).toBeGreaterThan(0)
		const again = await issueHandleCert({
			store,
			hostPrivateKey: host,
			subject,
			handle: 'alice',
			domain: '1sat.app',
			revocationOutpoint: DISABLED_REVOCATION_OUTPOINT,
		})
		expect(again.serialNumber).toBe(issued.serialNumber)
	})

	test('register issues a cert when certs deps are set', async () => {
		const accounts = new KnexAccountStore(db)
		await accounts.init()
		const certs = new KnexHandleCertStore(db)
		await certs.init()
		const host = PrivateKey.fromRandom()
		const subject = PrivateKey.fromRandom().toPublicKey().toString()

		const app = express()
		app.use(express.json())
		app.use('/account', (req, _res, next) => {
			;(req as { auth?: { identityKey: string } }).auth = {
				identityKey: subject,
			}
			next()
		})
		mountRegistrationRoutes(app, '/', {
			store: accounts,
			certs: {
				store: certs,
				hostPrivateKey: host,
				userDomain: '1sat.app',
				stackUrl: 'http://127.0.0.1:1',
			},
		})
		const { server, base } = await listen(app)
		try {
			const res = await fetch(`${base}/account/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username: 'carol' }),
			})
			expect(res.status).toBe(200)
			const body = (await res.json()) as {
				username: string
				certificate?: { type: string; subject: string }
			}
			expect(body.username).toBe('carol')
			expect(body.certificate?.subject).toBe(subject)
			const stored = await certs.get('carol', '1sat.app')
			expect(stored?.subject).toBe(subject)
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})
})

describe('handle certs are never left unissued', () => {
	let db: Knex

	beforeAll(async () => {
		db = memoryKnex()
	})

	afterAll(async () => {
		await db.destroy()
	})

	async function stores() {
		const accounts = new KnexAccountStore(db)
		await accounts.init()
		const certs = new KnexHandleCertStore(db)
		await certs.init()
		return { accounts, certs }
	}

	test('register is refused, and the name left free, without a user domain', async () => {
		const { accounts, certs } = await stores()
		const subject = PrivateKey.fromRandom().toPublicKey().toString()
		const app = express()
		app.use(express.json())
		app.use('/account', (req, _res, next) => {
			;(req as { auth?: { identityKey: string } }).auth = {
				identityKey: subject,
			}
			next()
		})
		mountRegistrationRoutes(app, '/', {
			store: accounts,
			certs: {
				store: certs,
				hostPrivateKey: PrivateKey.fromRandom(),
				stackUrl: 'http://127.0.0.1:1',
			},
		})
		const { server, base } = await listen(app)
		try {
			const res = await fetch(`${base}/account/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username: 'dave' }),
			})
			expect(res.status).toBe(503)
			const body = (await res.json()) as { error: string }
			expect(body.error).toBe(NO_USER_DOMAIN_ERROR)
			expect(await accounts.getByUsername('dave')).toBeNull()
			expect(await accounts.getByIdentity(subject)).toBeNull()
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})

	test('status issues the missing cert of an account registered without one', async () => {
		const { accounts, certs } = await stores()
		const host = PrivateKey.fromRandom()
		const subject = PrivateKey.fromRandom().toPublicKey().toString()
		await accounts.register(subject, 'erin', {})
		expect(await certs.get('erin', '1sat.app')).toBeNull()

		const status = await registrationStatus(accounts, subject, certs, {
			store: certs,
			hostPrivateKey: host,
			userDomain: '1sat.app',
			stackUrl: 'http://127.0.0.1:1',
		})
		expect(status.registrationEnabled).toBe(true)
		expect(status.handles).toEqual([
			{
				handle: 'erin',
				domain: '1sat.app',
				revocationOutpoint: DISABLED_REVOCATION_OUTPOINT,
			},
		])
		const stored = await certs.get('erin', '1sat.app')
		expect(stored?.subject).toBe(subject)
		expect(stored?.certifier).toBe(host.toPublicKey().toString())

		// Registering again returns that same cert.
		const app = express()
		app.use(express.json())
		app.use('/account', (req, _res, next) => {
			;(req as { auth?: { identityKey: string } }).auth = {
				identityKey: subject,
			}
			next()
		})
		mountRegistrationRoutes(app, '/', {
			store: accounts,
			certs: {
				store: certs,
				hostPrivateKey: host,
				userDomain: '1sat.app',
				stackUrl: 'http://127.0.0.1:1',
			},
		})
		const { server, base } = await listen(app)
		try {
			const res = await fetch(`${base}/account/register`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username: 'erin' }),
			})
			expect(res.status).toBe(200)
			const body = (await res.json()) as {
				certificate?: { serialNumber: string }
			}
			expect(body.certificate?.serialNumber).toBe(stored?.serialNumber)
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})

	test('status reports registration off when certs have no user domain', async () => {
		const { accounts, certs } = await stores()
		const status = await registrationStatus(accounts, IDENTITY_B, certs, {
			store: certs,
			hostPrivateKey: PrivateKey.fromRandom(),
			stackUrl: 'http://127.0.0.1:1',
		})
		expect(status.registrationEnabled).toBe(false)
	})

	test('paymail lookup issues the missing cert and resolves the name', async () => {
		const { accounts, certs } = await stores()
		const subject = PrivateKey.fromRandom().toPublicKey().toString()
		await accounts.register(subject, 'frank', {})

		const app = express()
		await mountPaymailRoutes(app, {
			baseUrl: 'https://1sat.app',
			stackUrl: 'http://127.0.0.1:1',
			pendingStore,
			userDomain: '1sat.app',
			accountStore: accounts,
			certStore: certs,
			hostPrivateKey: PrivateKey.fromRandom(),
		})
		const { server, base } = await listen(app)
		try {
			const res = await fetch(`${base}/bsvalias/id/frank@1sat.app`)
			expect(res.status).toBe(200)
			const body = (await res.json()) as { pubkey: string }
			expect(body.pubkey).toBe(subject)
			expect((await certs.get('frank', '1sat.app'))?.subject).toBe(subject)

			const unknown = await fetch(`${base}/bsvalias/id/nobody@1sat.app`)
			expect(unknown.status).toBe(404)
			expect(await certs.get('nobody', '1sat.app')).toBeNull()
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})

	test('a racing issue returns the cert that won the store', async () => {
		const { certs } = await stores()
		const host = PrivateKey.fromRandom()
		const subject = PrivateKey.fromRandom().toPublicKey().toString()
		const winner = await issueHandleCert({
			store: certs,
			hostPrivateKey: host,
			subject,
			handle: 'gina',
			domain: '1sat.app',
			revocationOutpoint: DISABLED_REVOCATION_OUTPOINT,
		})
		// A store that saw no cert on the first read, then loses the insert.
		let reads = 0
		const racing = {
			get: async (handle: string, domain: string) =>
				reads++ === 0 ? null : certs.get(handle, domain),
			listBySubject: (s: string) => certs.listBySubject(s),
			put: async () => {
				throw new Error('UNIQUE constraint failed')
			},
		}
		const issued = await issueHandleCert({
			store: racing,
			hostPrivateKey: host,
			subject,
			handle: 'gina',
			domain: '1sat.app',
			revocationOutpoint: DISABLED_REVOCATION_OUTPOINT,
		})
		expect(issued.serialNumber).toBe(winner.serialNumber)

		const other = PrivateKey.fromRandom().toPublicKey().toString()
		await expect(
			issueHandleCert({
				store: racing,
				hostPrivateKey: host,
				subject: other,
				handle: 'gina',
				domain: '1sat.app',
				revocationOutpoint: DISABLED_REVOCATION_OUTPOINT,
			}),
		).rejects.toThrow('UNIQUE constraint failed')
	})
})
