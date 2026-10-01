import { describe, expect, test } from 'bun:test'
import {
	RedisSessionManager,
	type SessionRedis,
} from '../src/sessions/redisSessionManager'

/** In-memory stand-in for Redis shared between "instances". TTLs are ignored. */
function fakeRedis(): SessionRedis & {
	strings: Map<string, string>
	sets: Map<string, Set<string>>
} {
	const strings = new Map<string, string>()
	const sets = new Map<string, Set<string>>()
	const set = async (
		key: string,
		value: string,
		_mode: 'EX',
		_seconds: number,
		flag?: 'NX',
	): Promise<'OK' | null> => {
		if (flag === 'NX' && strings.has(key)) return null
		strings.set(key, value)
		return 'OK'
	}
	return {
		strings,
		sets,
		async get(key) {
			return strings.get(key) ?? null
		},
		async mget(...keys) {
			return keys.map((key) => strings.get(key) ?? null)
		},
		set,
		async del(...keys) {
			let removed = 0
			for (const key of keys) {
				if (strings.delete(key) || sets.delete(key)) removed++
			}
			return removed
		},
		async sadd(key, member) {
			if (!sets.has(key)) sets.set(key, new Set())
			const members = sets.get(key) as Set<string>
			if (members.has(member)) return 0
			members.add(member)
			return 1
		},
		async srem(key, member) {
			return sets.get(key)?.delete(member) ? 1 : 0
		},
		async smembers(key) {
			return [...(sets.get(key) ?? [])]
		},
		async expire() {
			return 1
		},
	}
}

const IDENTITY = '02'.padEnd(66, 'b')
const session = (overrides = {}) => ({
	isAuthenticated: true,
	sessionNonce: 'server-nonce-1',
	peerNonce: 'peer-nonce-1',
	peerIdentityKey: IDENTITY,
	lastUpdate: Date.now(),
	...overrides,
})

describe('RedisSessionManager', () => {
	test('a session added on instance A is found on instance B', async () => {
		const redis = fakeRedis()
		const a = new RedisSessionManager(redis)
		const b = new RedisSessionManager(redis)

		await a.addSession(session())

		expect(await b.hasSession('server-nonce-1')).toBe(true)
		expect(await b.hasSession(IDENTITY)).toBe(true)
		expect((await b.getSession('server-nonce-1'))?.isAuthenticated).toBe(true)
	})

	test('updates on one instance are what the other reads', async () => {
		const redis = fakeRedis()
		const a = new RedisSessionManager(redis)
		const b = new RedisSessionManager(redis)

		await a.addSession(session({ isAuthenticated: false }))
		await b.updateSession(session({ isAuthenticated: true }))

		expect((await a.getSession('server-nonce-1'))?.isAuthenticated).toBe(true)
	})

	test('removeSession clears the session, its index entry and its nonce claims', async () => {
		const redis = fakeRedis()
		const a = new RedisSessionManager(redis)
		const b = new RedisSessionManager(redis)

		await a.addSession(session())
		await a.claimMessageNonce('server-nonce-1', 'm1')
		await a.removeSession(session())

		expect(await b.hasSession('server-nonce-1')).toBe(false)
		expect(await b.hasSession(IDENTITY)).toBe(false)
		expect(redis.strings.size).toBe(0)
		expect(redis.sets.get(`authsess:i:${IDENTITY}`)?.size ?? 0).toBe(0)
		expect(redis.sets.has('authsess:m:server-nonce-1')).toBe(false)
	})

	test('lookup by identity prefers authenticated, then most recent', async () => {
		const redis = fakeRedis()
		const m = new RedisSessionManager(redis)
		const now = Date.now()

		await m.addSession(
			session({
				sessionNonce: 'old',
				isAuthenticated: true,
				lastUpdate: now - 10,
			}),
		)
		await m.addSession(
			session({
				sessionNonce: 'pending',
				isAuthenticated: false,
				lastUpdate: now,
			}),
		)
		expect((await m.getSession(IDENTITY))?.sessionNonce).toBe('old')

		await m.addSession(
			session({
				sessionNonce: 'new',
				isAuthenticated: true,
				lastUpdate: now - 5,
			}),
		)
		expect((await m.getSession(IDENTITY))?.sessionNonce).toBe('new')
	})

	test('lookup by identity drops index entries whose session expired', async () => {
		const redis = fakeRedis()
		const m = new RedisSessionManager(redis)

		await m.addSession(session())
		redis.strings.delete('authsess:n:server-nonce-1')

		expect(await m.getSession(IDENTITY)).toBeUndefined()
		expect(redis.sets.get(`authsess:i:${IDENTITY}`)?.size).toBe(0)
	})

	test('a message nonce is claimed once across instances', async () => {
		const redis = fakeRedis()
		const a = new RedisSessionManager(redis)
		const b = new RedisSessionManager(redis)

		expect(await a.claimMessageNonce('server-nonce-1', 'm1')).toBe(true)
		expect(await b.claimMessageNonce('server-nonce-1', 'm1')).toBe(false)
		expect(await b.claimMessageNonce('server-nonce-1', 'm2')).toBe(true)
	})

	test('an initial-request nonce is claimed once across instances', async () => {
		const redis = fakeRedis()
		const a = new RedisSessionManager(redis)
		const b = new RedisSessionManager(redis)

		expect(await a.claimInitialRequestNonce(IDENTITY, 'i1')).toBe(true)
		expect(await b.claimInitialRequestNonce(IDENTITY, 'i1')).toBe(false)
	})

	test('a session without a nonce is rejected', async () => {
		const m = new RedisSessionManager(fakeRedis())
		await expect(
			m.addSession({ isAuthenticated: false, lastUpdate: Date.now() }),
		).rejects.toThrow('sessionNonce is required')
	})
})
