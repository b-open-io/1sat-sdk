import {
	type AuthMessage,
	Peer,
	type RequestedCertificateSet,
	SessionManager,
	type Transport,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import {
	buildRequestPayload,
	buildResponsePayload,
	decodeResponse,
	requestIdOf,
} from './serialize.js'

/** The authenticated context handed to a route handler. */
export interface AuthContext {
	/** The raw incoming request. */
	request: Request
	/** Parsed URL of the request. */
	url: URL
	/** The peer's BRC-103 identity key, or 'unknown' when unauthenticated. */
	identityKey: string
}

/** A route handler: receives the authenticated request, returns a response. */
export type AuthHandler = (ctx: AuthContext) => Promise<Response> | Response

export interface AuthenticatedHandlerOptions {
	/** Server wallet used to run the BRC-103/104 handshake and sign responses. */
	wallet: WalletInterface
	/** The route handler invoked once a request is authenticated. */
	handler: AuthHandler
	/**
	 * When true, requests with no auth headers are passed through with
	 * `identityKey = 'unknown'` (unsigned). When false (default), they get 401.
	 */
	allowUnauthenticated?: boolean
	/** Certificates to request from the peer during the handshake. */
	certificatesToRequest?: RequestedCertificateSet
	/** Reuse an existing session manager (defaults to a fresh one). */
	sessionManager?: SessionManager
}

interface Deferred<T> {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (err: unknown) => void
}

function defer<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (err: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

interface PendingGeneral {
	deferred: Deferred<Response>
	/** Unsigned response headers (e.g. content-type) passed straight through. */
	passthrough: Record<string, string>
}

const AUTH_HEADER_KEYS = [
	'x-bsv-auth-version',
	'x-bsv-auth-identity-key',
	'x-bsv-auth-nonce',
	'x-bsv-auth-your-nonce',
	'x-bsv-auth-signature',
	'x-bsv-auth-request-id',
] as const

/**
 * A BRC-103/104 mutual-auth `Transport` bound to Bun's `Request`/`Response`.
 *
 * Where the Express transport hijacks a mutable `res` and gates on `next()`,
 * this models each request as a promise: it feeds the incoming message to the
 * `Peer`, runs the route handler once the peer confirms the identity, and
 * resolves the request's promise when the peer emits the signed reply through
 * `send`. Wire-identical to the Express middleware.
 */
export class BunTransport implements Transport {
	private peer?: Peer
	private messageCallback?: (message: AuthMessage) => Promise<void>
	private readonly pendingNonGeneral = new Map<string, Deferred<Response>>()
	private readonly pendingGeneral = new Map<string, PendingGeneral>()

	constructor(
		private readonly handler: AuthHandler,
		private readonly allowUnauthenticated: boolean,
	) {}

	setPeer(peer: Peer): void {
		this.peer = peer
	}

	async onData(
		callback: (message: AuthMessage) => Promise<void>,
	): Promise<void> {
		this.messageCallback = callback
	}

	/** Delivers a signed message from the peer back to its pending request. */
	async send(message: AuthMessage): Promise<void> {
		if (message.messageType !== 'general') {
			const deferred = this.pendingNonGeneral.get(message.yourNonce ?? '')
			if (!deferred) throw new Error('No open handshake handle for this peer')
			this.pendingNonGeneral.delete(message.yourNonce ?? '')
			const headers: Record<string, string> = {
				'content-type': 'application/json',
				'x-bsv-auth-version': message.version,
				'x-bsv-auth-message-type': message.messageType,
				'x-bsv-auth-identity-key': message.identityKey,
				'x-bsv-auth-nonce': message.nonce ?? '',
				'x-bsv-auth-your-nonce': message.yourNonce ?? '',
				'x-bsv-auth-signature': Utils.toHex(message.signature ?? []),
			}
			if (message.requestedCertificates) {
				headers['x-bsv-auth-requested-certificates'] = JSON.stringify(
					message.requestedCertificates,
				)
			}
			deferred.resolve(
				new Response(JSON.stringify(message), { status: 200, headers }),
			)
			return
		}

		if (!message.payload) throw new Error('general message has no payload')
		const requestId = requestIdOf(message.payload)
		const pending = this.pendingGeneral.get(requestId)
		if (!pending) throw new Error('No open response handle for this requestId')
		this.pendingGeneral.delete(requestId)

		const decoded = decodeResponse(message.payload)
		const headers: Record<string, string> = { ...pending.passthrough }
		for (const [k, v] of Object.entries(decoded.headers)) headers[k] = v
		headers['x-bsv-auth-version'] = message.version
		headers['x-bsv-auth-identity-key'] = message.identityKey
		headers['x-bsv-auth-nonce'] = message.nonce ?? ''
		headers['x-bsv-auth-your-nonce'] = message.yourNonce ?? ''
		headers['x-bsv-auth-signature'] = Utils.toHex(message.signature ?? [])
		headers['x-bsv-auth-request-id'] = requestId

		const body = decoded.body ? new Uint8Array(decoded.body) : undefined
		pending.deferred.resolve(
			new Response(body, { status: decoded.status, headers }),
		)
	}

	/** Handles one HTTP request end to end, returning the (signed) response. */
	async handleRequest(request: Request): Promise<Response> {
		if (!this.peer || !this.messageCallback) {
			return json(500, {
				status: 'error',
				description: 'auth transport not ready',
			})
		}
		const url = new URL(request.url)

		if (url.pathname === '/.well-known/auth') {
			return this.handleHandshake(request)
		}
		if (request.headers.get('x-bsv-auth-request-id')) {
			return this.handleGeneral(request, url)
		}
		if (this.allowUnauthenticated) {
			return Promise.resolve(
				this.handler({ request, url, identityKey: 'unknown' }),
			)
		}
		return json(401, {
			status: 'error',
			code: 'UNAUTHORIZED',
			message: 'Mutual-authentication failed!',
		})
	}

	private async handleHandshake(request: Request): Promise<Response> {
		const message = (await request.json()) as AuthMessage
		const key = message.initialNonce ?? ''
		const deferred = defer<Response>()
		this.pendingNonGeneral.set(key, deferred)
		try {
			await this.messageCallback?.(message)
		} catch (err) {
			this.pendingNonGeneral.delete(key)
			return authError(err)
		}
		return deferred.promise
	}

	private async handleGeneral(request: Request, url: URL): Promise<Response> {
		// Read a clone for the signed payload so the handler can still read the body.
		const rawBody = await request.clone().arrayBuffer()
		const bodyBytes =
			rawBody.byteLength > 0 ? [...new Uint8Array(rawBody)] : null
		const requestId = request.headers.get('x-bsv-auth-request-id') as string
		const claimedIdentity = request.headers.get('x-bsv-auth-identity-key') ?? ''

		const message: AuthMessage = {
			messageType: 'general',
			version: request.headers.get('x-bsv-auth-version') ?? '',
			identityKey: claimedIdentity,
			nonce: request.headers.get('x-bsv-auth-nonce') ?? undefined,
			yourNonce: request.headers.get('x-bsv-auth-your-nonce') ?? undefined,
			payload: buildRequestPayload(request, bodyBytes),
			signature: hexToBytes(request.headers.get('x-bsv-auth-signature')),
		}

		const deferred = defer<Response>()
		this.pendingGeneral.set(requestId, { deferred, passthrough: {} })

		const peer = this.peer as Peer
		const listenerId = peer.listenForGeneralMessages(
			(senderPublicKey, payload) => {
				if (senderPublicKey !== claimedIdentity) return
				if (requestIdOf(payload) !== requestId) return
				peer.stopListeningForGeneralMessages(listenerId)
				void this.runHandler(
					{ request, url, identityKey: senderPublicKey },
					requestId,
				)
			},
		)

		try {
			await this.messageCallback?.(message)
		} catch (err) {
			peer.stopListeningForGeneralMessages(listenerId)
			this.pendingGeneral.delete(requestId)
			return authError(err)
		}
		return deferred.promise
	}

	/** Runs the route handler and signs its response back to the peer. */
	private async runHandler(ctx: AuthContext, requestId: string): Promise<void> {
		const pending = this.pendingGeneral.get(requestId)
		if (!pending) return
		try {
			const response = await this.handler(ctx)
			const bodyBytes = [...new Uint8Array(await response.arrayBuffer())]
			const headers: Record<string, string> = {}
			response.headers.forEach((value, key) => {
				headers[key] = value
				// Carry non-signed headers (e.g. content-type) through untouched.
				const lk = key.toLowerCase()
				if (!lk.startsWith('x-bsv-') && lk !== 'authorization') {
					pending.passthrough[lk] = value
				}
			})
			const payload = buildResponsePayload(
				requestId,
				response.status,
				headers,
				bodyBytes,
			)
			await (this.peer as Peer).toPeer(payload, ctx.identityKey)
		} catch (err) {
			this.pendingGeneral.delete(requestId)
			pending.deferred.resolve(authError(err))
		}
	}
}

/** Builds the Bun `fetch` handler that authenticates every request. */
export function createAuthenticatedHandler(
	options: AuthenticatedHandlerOptions,
): (request: Request) => Promise<Response> {
	if (!options.wallet)
		throw new Error('createAuthenticatedHandler requires a wallet')
	const transport = new BunTransport(
		options.handler,
		options.allowUnauthenticated ?? false,
	)
	const peer = new Peer(
		options.wallet,
		transport,
		options.certificatesToRequest,
		options.sessionManager ?? new SessionManager(),
	)
	transport.setPeer(peer)
	return (request: Request) => transport.handleRequest(request)
}

function hexToBytes(hex: string | null): number[] {
	return hex ? Utils.toArray(hex, 'hex') : []
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

function authError(err: unknown): Response {
	const msg = err instanceof Error ? err.message : String(err)
	const isAuth = /nonce|signature|session|auth version/i.test(msg)
	return json(isAuth ? 401 : 500, {
		status: 'error',
		code: isAuth ? 'ERR_AUTH_FAILED' : 'ERR_INTERNAL_SERVER_ERROR',
		description: msg,
	})
}

export { AUTH_HEADER_KEYS }
