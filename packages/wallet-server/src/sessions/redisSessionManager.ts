/**
 * Redis-mirrored BRC-104 session store for multi-instance deployments.
 *
 * The SDK's SessionManager interface is synchronous, so Redis cannot sit on
 * the read path directly. Instead this subclass keeps the normal in-memory
 * maps for sync reads and mirrors every write to Redis; the express wrapper
 * (`wrapAuthWithSessionHydration`) async-loads a peer's sessions from Redis
 * into local memory before the auth middleware's sync lookups run.
 */

import { createAuthMiddleware } from '@bsv/auth-express-middleware'
import { SessionManager, type WalletInterface } from '@bsv/sdk'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { Redis } from 'ioredis'

/** Peer session shape from @bsv/sdk (not exported by the package root). */
interface PeerSession {
	isAuthenticated: boolean
	sessionNonce?: string
	peerNonce?: string
	peerIdentityKey?: string
	lastUpdate: number
	certificatesRequired?: boolean
	certificatesValidated?: boolean
}

/** Minimal Redis surface used — lets tests substitute an in-memory fake. */
export interface SessionRedis {
	hgetall(key: string): Promise<Record<string, string>>
	hset(key: string, field: string, value: string): Promise<unknown>
	hdel(key: string, field: string): Promise<unknown>
	expire(key: string, seconds: number): Promise<unknown>
}

export interface RedisSessionManagerOptions {
	/** Redis TTL per identity's session set, refreshed on every write. Default 24h. */
	ttlSeconds?: number
	keyPrefix?: string
	/** Called when a background Redis write fails. Defaults to console.error. */
	onError?: (err: Error) => void
}

const DEFAULT_TTL_SECONDS = 86_400

export class RedisSessionManager extends SessionManager {
	private readonly redis: SessionRedis
	private readonly ttlSeconds: number
	private readonly keyPrefix: string
	private readonly onError: (err: Error) => void

	constructor(redis: SessionRedis, options: RedisSessionManagerOptions = {}) {
		super()
		this.redis = redis
		this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS
		this.keyPrefix = options.keyPrefix ?? 'authsess:'
		this.onError =
			options.onError ??
			((err) => console.error('[session-store] redis write failed', err))
	}

	private key(identityKey: string): string {
		return `${this.keyPrefix}${identityKey}`
	}

	addSession(session: PeerSession): void {
		super.addSession(session)
		// Sessions without an identity key are mid-handshake and only
		// meaningful on the instance running that handshake.
		if (!session.peerIdentityKey || !session.sessionNonce) return
		const key = this.key(session.peerIdentityKey)
		this.redis
			.hset(key, session.sessionNonce, JSON.stringify(session))
			.then(() => this.redis.expire(key, this.ttlSeconds))
			.catch((err) => this.onError(err as Error))
	}

	removeSession(session: PeerSession): void {
		super.removeSession(session)
		if (!session.peerIdentityKey || !session.sessionNonce) return
		this.redis
			.hdel(this.key(session.peerIdentityKey), session.sessionNonce)
			.catch((err) => this.onError(err as Error))
	}

	/**
	 * Load every Redis-stored session for this identity into local memory so
	 * subsequent synchronous lookups (by identity key or session nonce) hit.
	 */
	async hydrate(identityKey: string): Promise<void> {
		const stored = await this.redis.hgetall(this.key(identityKey))
		for (const json of Object.values(stored)) {
			try {
				const session = JSON.parse(json) as PeerSession
				if (session.sessionNonce && !this.hasSession(session.sessionNonce)) {
					super.addSession(session)
				}
			} catch {
				// Skip unparseable entries; they age out via TTL.
			}
		}
	}
}

/**
 * Wrap the BRC-104 auth middleware so that a request referencing a session
 * created on another instance is hydrated from Redis before the middleware's
 * synchronous session lookups run. Requests without auth headers (handshake,
 * public routes) pass straight through.
 */
export function wrapAuthWithSessionHydration(
	authMiddleware: RequestHandler,
	sessions: RedisSessionManager,
	onError: (err: Error) => void = (err) =>
		console.error('[session-store] hydrate failed', err),
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
	return async (req: Request, res: Response, next: NextFunction) => {
		const identityKey = req.headers['x-bsv-auth-identity-key']
		const nonce = req.headers['x-bsv-auth-your-nonce']
		if (typeof identityKey === 'string' && identityKey !== '') {
			// General messages are looked up by the server session nonce the
			// client echoes back; fall back to identity key when absent.
			const missing =
				typeof nonce === 'string' && nonce !== ''
					? !sessions.hasSession(nonce)
					: !sessions.hasSession(identityKey)
			if (missing) {
				try {
					await sessions.hydrate(identityKey)
				} catch (err) {
					// Auth still works for sessions this instance already
					// holds; a failed hydrate just means a possible re-auth.
					onError(err as Error)
				}
			}
		}
		authMiddleware(req, res, next)
	}
}

/** ioredis client for the session store. Connects on first command. */
export function createSessionRedis(url: string): SessionRedis {
	return new Redis(url, { maxRetriesPerRequest: 2 })
}

export interface SessionStoreConfig {
	redisUrl: string
	ttlSeconds?: number
}

/**
 * BRC-104 auth middleware with optional Redis-shared sessions. Without a
 * store config this is exactly `createAuthMiddleware({ wallet })`.
 */
export function buildAuthMiddleware(
	wallet: WalletInterface,
	sessionStore?: SessionStoreConfig,
): RequestHandler {
	if (!sessionStore) {
		return createAuthMiddleware({ wallet }) as RequestHandler
	}
	const sessions = new RedisSessionManager(
		createSessionRedis(sessionStore.redisUrl),
		{ ttlSeconds: sessionStore.ttlSeconds },
	)
	return wrapAuthWithSessionHydration(
		createAuthMiddleware({
			wallet,
			sessionManager: sessions,
		}) as RequestHandler,
		sessions,
	) as RequestHandler
}
