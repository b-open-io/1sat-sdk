/**
 * Redis-backed BRC-103/104 session store for multi-instance deployments.
 *
 * Implements the `@bsv/sdk` `AsyncSessionManager` contract. `Peer` (and so
 * `createAuthMiddleware` and the toolbox `StorageServer`) awaits every call,
 * so Redis is the only copy of a session: any instance can continue a
 * handshake another instance started.
 *
 * Keys, all expiring `ttlSeconds` after their last write:
 * - `<prefix>n:<sessionNonce>`        session JSON
 * - `<prefix>i:<identityKey>`         set of that identity's session nonces
 * - `<prefix>m:<sessionNonce>`        set of claimed message nonces
 * - `<prefix>r:<identityKey>:<nonce>` claimed initial-request nonce
 */

import { createAuthMiddleware } from '@bsv/auth-express-middleware'
import type {
	AsyncSessionManager,
	PeerSession,
	WalletInterface,
} from '@bsv/sdk'
import type { RequestHandler } from 'express'
import { Redis } from 'ioredis'

/** Redis commands the session store uses — lets tests substitute a fake. */
export interface SessionRedis {
	get(key: string): Promise<string | null>
	mget(...keys: string[]): Promise<(string | null)[]>
	set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>
	set(
		key: string,
		value: string,
		mode: 'EX',
		seconds: number,
		flag: 'NX',
	): Promise<'OK' | null>
	del(...keys: string[]): Promise<number>
	sadd(key: string, member: string): Promise<number>
	srem(key: string, member: string): Promise<number>
	smembers(key: string): Promise<string[]>
	expire(key: string, seconds: number): Promise<unknown>
}

export interface RedisSessionManagerOptions {
	/** Lifetime of a session and its replay claims since their last write. Default 24h. */
	ttlSeconds?: number
	keyPrefix?: string
}

const DEFAULT_TTL_SECONDS = 86_400

export class RedisSessionManager implements AsyncSessionManager {
	private readonly redis: SessionRedis
	private readonly ttlSeconds: number
	private readonly keyPrefix: string

	constructor(redis: SessionRedis, options: RedisSessionManagerOptions = {}) {
		this.redis = redis
		this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS
		this.keyPrefix = options.keyPrefix ?? 'authsess:'
	}

	private sessionKey(sessionNonce: string): string {
		return `${this.keyPrefix}n:${sessionNonce}`
	}

	private identityKey(identityKey: string): string {
		return `${this.keyPrefix}i:${identityKey}`
	}

	private messageNoncesKey(sessionNonce: string): string {
		return `${this.keyPrefix}m:${sessionNonce}`
	}

	async addSession(session: PeerSession): Promise<void> {
		if (!session.sessionNonce) {
			throw new TypeError(
				'Invalid session: sessionNonce is required to add a session.',
			)
		}
		await this.redis.set(
			this.sessionKey(session.sessionNonce),
			JSON.stringify(session),
			'EX',
			this.ttlSeconds,
		)
		if (session.peerIdentityKey) {
			const key = this.identityKey(session.peerIdentityKey)
			await this.redis.sadd(key, session.sessionNonce)
			await this.redis.expire(key, this.ttlSeconds)
		}
	}

	updateSession(session: PeerSession): Promise<void> {
		return this.addSession(session)
	}

	/**
	 * By session nonce, that session. By identity key, the best of that
	 * identity's sessions, ranked as the sdk's in-memory `SessionManager`
	 * ranks them.
	 */
	async getSession(identifier: string): Promise<PeerSession | undefined> {
		const direct = await this.redis.get(this.sessionKey(identifier))
		if (direct != null) return JSON.parse(direct) as PeerSession

		const nonces = await this.redis.smembers(this.identityKey(identifier))
		if (nonces.length === 0) return undefined
		const stored = await this.redis.mget(
			...nonces.map((nonce) => this.sessionKey(nonce)),
		)
		let best: PeerSession | undefined
		for (let i = 0; i < nonces.length; i++) {
			const json = stored[i]
			if (json == null) {
				await this.redis.srem(this.identityKey(identifier), nonces[i])
				continue
			}
			const session = JSON.parse(json) as PeerSession
			if (best == null || ranksAbove(session, best)) best = session
		}
		return best
	}

	async removeSession(session: PeerSession): Promise<void> {
		if (!session.sessionNonce) return
		await this.redis.del(
			this.sessionKey(session.sessionNonce),
			this.messageNoncesKey(session.sessionNonce),
		)
		if (session.peerIdentityKey) {
			await this.redis.srem(
				this.identityKey(session.peerIdentityKey),
				session.sessionNonce,
			)
		}
	}

	async hasSession(identifier: string): Promise<boolean> {
		return (await this.getSession(identifier)) != null
	}

	/** SADD is atomic: exactly one instance sees the nonce as new. */
	async claimMessageNonce(
		sessionNonce: string,
		messageNonce: string,
	): Promise<boolean> {
		const key = this.messageNoncesKey(sessionNonce)
		const added = await this.redis.sadd(key, messageNonce)
		await this.redis.expire(key, this.ttlSeconds)
		return added === 1
	}

	/** SET NX is atomic: exactly one instance claims the nonce. */
	async claimInitialRequestNonce(
		identityKey: string,
		initialNonce: string,
	): Promise<boolean> {
		const claimed = await this.redis.set(
			`${this.keyPrefix}r:${identityKey}:${initialNonce}`,
			'1',
			'EX',
			this.ttlSeconds,
			'NX',
		)
		return claimed === 'OK'
	}
}

function isAuthorizationReady(session: PeerSession): boolean {
	return (
		session.isAuthenticated === true &&
		(session.certificatesRequired !== true ||
			session.certificatesValidated === true)
	)
}

/** Authenticated first, then authorization-ready, then most recently updated. */
function ranksAbove(session: PeerSession, best: PeerSession): boolean {
	if (session.isAuthenticated !== best.isAuthenticated) {
		return session.isAuthenticated === true
	}
	if (isAuthorizationReady(session) !== isAuthorizationReady(best)) {
		return isAuthorizationReady(session)
	}
	return session.lastUpdate > best.lastUpdate
}

/** ioredis client for the session store. Connects on first command. */
export function createSessionRedis(url: string): SessionRedis {
	return new Redis(url, { maxRetriesPerRequest: 2 })
}

export interface SessionStoreConfig {
	redisUrl: string
	ttlSeconds?: number
}

/** Redis session manager for a configured store; undefined keeps sessions in memory. */
export function createSessionManager(
	sessionStore?: SessionStoreConfig,
): RedisSessionManager | undefined {
	if (!sessionStore) return undefined
	return new RedisSessionManager(createSessionRedis(sessionStore.redisUrl), {
		ttlSeconds: sessionStore.ttlSeconds,
	})
}

/**
 * Response bound matches the toolbox StorageServer default (8 MiB).
 * Requests stay up to the SDK's 16 MiB authenticated-message limit.
 */
const AUTH_TRANSPORT_LIMITS = {
	maxResponseBytes: 8 * 1024 * 1024,
	maxRequestBytes: 16 * 1024 * 1024,
}

/**
 * BRC-104 auth middleware for the host's routes, with Redis-shared sessions
 * when a store is configured and in-memory sessions otherwise.
 */
export function buildAuthMiddleware(
	wallet: WalletInterface,
	sessionStore?: SessionStoreConfig,
): RequestHandler {
	return createAuthMiddleware({
		wallet,
		sessionManager: createSessionManager(sessionStore),
		transportLimits: AUTH_TRANSPORT_LIMITS,
	}) as RequestHandler
}
