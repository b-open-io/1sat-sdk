import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'
import express from 'express'
import knexLib from 'knex'
import type { Knex } from 'knex'
import { createRegistryResolver } from '../src/paymail/resolvers'
import { mountPaymailRoutes } from '../src/paymail/routes'
import type { PendingStore } from '../src/paymail/types'
import {
	KnexUserStore,
	UsernameTakenError,
	normalizeUsername,
} from '../src/paymail/users'

const IDENTITY_A = '02'.padEnd(66, 'a')
const IDENTITY_B = '03'.padEnd(66, 'b')

const pendingStore: PendingStore = {
	async create() {},
	async get() {
		return null
	},
	async update() {},
	async delete() {},
}

describe('normalizeUsername', () => {
	test('lowercases and trims', () => {
		expect(normalizeUsername('  Alice-1 ')).toBe('alice-1')
	})

	test('rejects invalid shapes', () => {
		expect(normalizeUsername('ab')).toBeNull()
		expect(normalizeUsername('-alice')).toBeNull()
		expect(normalizeUsername('alice-')).toBeNull()
		expect(normalizeUsername('al ice')).toBeNull()
		expect(normalizeUsername('a'.repeat(64))).toBeNull()
		expect(normalizeUsername(undefined)).toBeNull()
	})
})

describe('KnexUserStore', () => {
	let db: Knex
	let store: KnexUserStore

	beforeAll(async () => {
		db = (knexLib as unknown as typeof knexLib)({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		})
		store = new KnexUserStore(db)
		await store.init()
	})

	afterAll(async () => {
		await db.destroy()
	})

	test('claim then get by alias and identity', async () => {
		const claimed = await store.claim('alice', IDENTITY_A)
		expect(claimed.username).toBe('alice')
		expect(claimed.identityKey).toBe(IDENTITY_A)

		const byAlias = await store.get('alice')
		expect(byAlias?.identityKey).toBe(IDENTITY_A)
		const byKey = await store.getByIdentity(IDENTITY_A)
		expect(byKey?.username).toBe('alice')
	})

	test('claim is idempotent for the owning identity', async () => {
		const again = await store.claim('alice', IDENTITY_A)
		expect(again.identityKey).toBe(IDENTITY_A)
	})

	test('claim by another identity conflicts', async () => {
		await expect(store.claim('alice', IDENTITY_B)).rejects.toThrow(
			UsernameTakenError,
		)
		expect((await store.get('alice'))?.identityKey).toBe(IDENTITY_A)
	})

	test('unknown lookups return null', async () => {
		expect(await store.get('nobody')).toBeNull()
		expect(await store.getByIdentity('ff'.padEnd(66, 'f'))).toBeNull()
	})

	test('init is idempotent', async () => {
		await store.init()
		expect((await store.get('alice'))?.identityKey).toBe(IDENTITY_A)
	})
})

describe('createRegistryResolver', () => {
	test('maps username to identity key', async () => {
		const store = new KnexUserStore(
			(knexLib as unknown as typeof knexLib)({
				client: 'sqlite3',
				connection: { filename: ':memory:' },
				useNullAsDefault: true,
			}),
		)
		await store.init()
		await store.claim('bob', IDENTITY_A)
		const resolver = createRegistryResolver(store)
		const bind = await resolver.resolve('bob', '1sat.app')
		expect(bind?.identityKey).toBe(IDENTITY_A)
		expect(bind?.profileName).toBe('bob')
		expect(await resolver.resolve('nobody', '1sat.app')).toBeNull()
	})
})

describe('mountPaymailRoutes domain dispatch', () => {
	let server: Server
	let base: string
	let db: Knex

	beforeAll(async () => {
		db = (knexLib as unknown as typeof knexLib)({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		})
		const store = new KnexUserStore(db)
		await store.init()
		await store.claim('alice', IDENTITY_A)

		const app = express()
		await mountPaymailRoutes(app, {
			baseUrl: 'https://1sat.app',
			stackUrl: 'http://127.0.0.1:1',
			pendingStore,
			userDomain: '1sat.app',
			userStore: store,
		})
		server = app.listen(0)
		await new Promise<void>((resolve) => server.once('listening', resolve))
		const addr = server.address()
		base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
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
		const addr = server.address()
		const port = typeof addr === 'object' && addr ? addr.port : 0
		expect(doc.capabilities.pki).toContain(`127.0.0.1:${port}`)

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
