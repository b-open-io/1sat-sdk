import { describe, expect, test } from 'bun:test'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import {
	RedisSessionManager,
	type SessionRedis,
	wrapAuthWithSessionHydration,
} from '../src/sessions/redisSessionManager'

/** In-memory stand-in for Redis shared between "instances". */
function fakeRedis(): SessionRedis & {
	store: Map<string, Map<string, string>>
} {
	const store = new Map<string, Map<string, string>>()
	return {
		store,
		async hgetall(key) {
			return Object.fromEntries(store.get(key) ?? new Map())
		},
		async hset(key, field, value) {
			if (!store.has(key)) store.set(key, new Map())
			store.get(key)!.set(field, value)
		},
		async hdel(key, field) {
			store.get(key)?.delete(field)
		},
		async expire() {},
	}
}

const IDENTITY = '02'.padEnd(66, 'b')
const session = () => ({
	isAuthenticated: true,
	sessionNonce: 'server-nonce-1',
	peerNonce: 'peer-nonce-1',
	peerIdentityKey: IDENTITY,
	lastUpdate: 1700000000000,
})

/** Let the fire-and-forget Redis writes settle. */
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('RedisSessionManager', () => {
	test('session added on instance A is visible on instance B after hydrate', async () => {
		const redis = fakeRedis()
		const a = new RedisSessionManager(redis)
		const b = new RedisSessionManager(redis)

		a.addSession(session())
		await tick()

		// B knows nothing locally — the sync lookup misses.
		expect(b.hasSession('server-nonce-1')).toBe(false)

		await b.hydrate(IDENTITY)
		expect(b.hasSession('server-nonce-1')).toBe(true)
		expect(b.hasSession(IDENTITY)).toBe(true)
		expect(b.getSession('server-nonce-1')?.isAuthenticated).toBe(true)
	})

	test('removeSession propagates through Redis', async () => {
		const redis = fakeRedis()
		const a = new RedisSessionManager(redis)
		const b = new RedisSessionManager(redis)

		a.addSession(session())
		await tick()
		a.removeSession(session())
		await tick()

		await b.hydrate(IDENTITY)
		expect(b.hasSession('server-nonce-1')).toBe(false)
	})

	test('mid-handshake sessions (no identity key) stay local', async () => {
		const redis = fakeRedis()
		const a = new RedisSessionManager(redis)
		a.addSession({
			isAuthenticated: false,
			sessionNonce: 'pending-nonce',
			lastUpdate: 1700000000000,
		})
		await tick()
		expect(redis.store.size).toBe(0)
		expect(a.hasSession('pending-nonce')).toBe(true)
	})

	test('hydrate skips sessions already present locally', async () => {
		const redis = fakeRedis()
		const a = new RedisSessionManager(redis)
		a.addSession(session())
		await tick()
		// Hydrating the same instance must not duplicate or throw.
		await a.hydrate(IDENTITY)
		expect(a.getSession(IDENTITY)?.sessionNonce).toBe('server-nonce-1')
	})
})

describe('wrapAuthWithSessionHydration', () => {
	function makeReq(headers: Record<string, string>): Request {
		return { headers } as unknown as Request
	}
	const passThrough: RequestHandler = (req, _res, next) => {
		;(req as Request & { reached?: boolean }).reached = true
		next()
	}

	test('hydrates a foreign session before delegating', async () => {
		const redis = fakeRedis()
		const a = new RedisSessionManager(redis)
		const b = new RedisSessionManager(redis)
		a.addSession(session())
		await tick()

		const wrapped = wrapAuthWithSessionHydration(passThrough, b)
		const req = makeReq({
			'x-bsv-auth-identity-key': IDENTITY,
			'x-bsv-auth-your-nonce': 'server-nonce-1',
		})
		let nexted = false
		await wrapped(
			req,
			{} as Response,
			(() => {
				nexted = true
			}) as NextFunction,
		)

		expect(nexted).toBe(true)
		expect(b.hasSession('server-nonce-1')).toBe(true)
	})

	test('requests without auth headers skip Redis entirely', async () => {
		const redis = fakeRedis()
		let reads = 0
		const counting: SessionRedis = {
			...redis,
			async hgetall(key) {
				reads++
				return redis.hgetall(key)
			},
		}
		const b = new RedisSessionManager(counting)
		const wrapped = wrapAuthWithSessionHydration(passThrough, b)
		let nexted = false
		await wrapped(
			makeReq({}),
			{} as Response,
			(() => {
				nexted = true
			}) as NextFunction,
		)
		expect(nexted).toBe(true)
		expect(reads).toBe(0)
	})

	test('hydrate failure still lets the request through', async () => {
		const failing: SessionRedis = {
			async hgetall() {
				throw new Error('redis down')
			},
			async hset() {},
			async hdel() {},
			async expire() {},
		}
		const b = new RedisSessionManager(failing)
		const errors: Error[] = []
		const wrapped = wrapAuthWithSessionHydration(passThrough, b, (e) =>
			errors.push(e),
		)
		let nexted = false
		await wrapped(
			makeReq({ 'x-bsv-auth-identity-key': IDENTITY }),
			{} as Response,
			(() => {
				nexted = true
			}) as NextFunction,
		)
		expect(nexted).toBe(true)
		expect(errors.length).toBe(1)
	})
})
