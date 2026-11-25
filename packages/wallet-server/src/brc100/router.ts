/**
 * BRC-100 application-facing request router.
 *
 * Framework-agnostic fetch handler (`(Request) => Response`) that dispatches
 * `POST /<walletMethod>` to a wallet. The router does not decide what an app
 * may do: it derives the caller's origin, hands `(method, args, origin)` to
 * the wallet and relays the result. Permissions are the wallet's job — serve
 * a `WalletPermissionsManager` (or `LocalWalletPermissionsManager` from
 * `@1sat/wallet`) so every call is checked against the originator's grants.
 * What happens when a grant is missing is that wallet's business — the CLI's
 * endpoint denies and says which command would allow the call. A permission
 * denial surfaces like any other wallet error: 400 with `{ error }`, with the
 * wallet's message relayed unchanged so the app can print it verbatim.
 *
 * Node/Bun-agnostic: uses only Web-standard Request/Response.
 */

import { normalizeOriginator } from '@1sat/wallet'
import type { WalletMethod } from './methods.js'
import { NO_ARG_METHODS, walletMethodSet } from './methods.js'

/** Execution surface the router dispatches to. */
export interface BRC100WalletHandle {
	/** Execute a wallet method on behalf of an app origin. */
	call(method: WalletMethod, args: unknown, origin: string): Promise<unknown>
	/** False when the wallet is locked/unavailable → 503. */
	isReady?(): boolean
}

export interface BRC100RouterConfig {
	wallet: BRC100WalletHandle
	/**
	 * The wallet's admin originator. A request whose derived origin matches
	 * it (after the permissions manager's originator normalization) is
	 * rejected with 400 before it reaches the wallet, so the originator
	 * that bypasses permission checks can never be claimed over HTTP.
	 */
	adminOriginator?: string
	/** Serves GET /manifest.json when provided (babbage trust manifest). */
	manifest?: unknown
	/** Override how the caller's origin is derived; '' rejects the request. */
	parseOrigin?: (req: Request) => string
	/** Extra response headers on every reply (CORS etc.). */
	baseHeaders?: Record<string, string>
	/** Request logger hook. */
	onEvent?: (event: Record<string, unknown>) => void
}

const JSON_HEADERS: Record<string, string> = {
	'Content-Type': 'application/json',
}

/**
 * Default origin parsing: the `Origin` header only.
 *
 * Browsers set `Origin` themselves and page scripts cannot change it, so it
 * is the one caller identity the server can rely on. Node clients using the
 * SDK's HTTPWalletJSON send `Origin: http://<originator>`; other local apps
 * set it the same way. `Originator` and `X-1Sat-Origin` are ordinary headers
 * any page can forge and are ignored. Returns '' when the header is absent
 * or the opaque `null`, which the router rejects.
 */
export function defaultParseOrigin(req: Request): string {
	const origin = req.headers.get('Origin')?.trim()
	if (!origin || origin === 'null') return ''
	try {
		return new URL(origin).host || origin
	} catch {
		return origin
	}
}

/** Create a fetch handler for the BRC-100 endpoints. */
export function createBRC100Router(
	config: BRC100RouterConfig,
): (req: Request) => Promise<Response> {
	const parseOrigin = config.parseOrigin ?? defaultParseOrigin
	const adminOriginator = config.adminOriginator
		? normalizeOriginator(config.adminOriginator)
		: ''

	const reply = (
		body: unknown,
		status = 200,
		extra?: Record<string, string>,
	): Response =>
		new Response(JSON.stringify(body), {
			status,
			headers: {
				...(config.baseHeaders ?? {}),
				...JSON_HEADERS,
				...(extra ?? {}),
			},
		})

	const rejectCall = (
		method: WalletMethod,
		origin: string,
		status: number,
		error: string,
	): Response => {
		config.onEvent?.({
			event: 'brc100_call',
			method,
			origin,
			status,
			error,
		})
		return reply({ error }, status)
	}

	return async (req: Request): Promise<Response> => {
		const url = new URL(req.url)

		if (req.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: config.baseHeaders ?? {},
			})
		}

		if (
			config.manifest !== undefined &&
			req.method === 'GET' &&
			url.pathname === '/manifest.json'
		) {
			return reply(config.manifest)
		}

		if (req.method !== 'POST') {
			return reply({ error: `Not found: ${url.pathname}` }, 404)
		}

		const method = url.pathname.slice(1)
		if (!walletMethodSet.has(method)) {
			return reply({ error: `Unknown endpoint: ${url.pathname}` }, 404)
		}
		const walletMethod = method as WalletMethod

		if (config.wallet.isReady && !config.wallet.isReady()) {
			return reply({ error: 'Wallet is locked' }, 503)
		}

		const origin = parseOrigin(req)
		if (!origin) {
			return rejectCall(walletMethod, '', 400, 'Origin header required')
		}
		if (adminOriginator && normalizeOriginator(origin) === adminOriginator) {
			return rejectCall(
				walletMethod,
				origin,
				400,
				'Origin is reserved for the wallet itself',
			)
		}

		let args: unknown = {}
		if (!NO_ARG_METHODS.has(walletMethod)) {
			try {
				args = await req.json()
			} catch {
				args = {}
			}
		}

		try {
			const result = await config.wallet.call(walletMethod, args, origin)
			config.onEvent?.({
				event: 'brc100_call',
				method: walletMethod,
				origin,
				status: 200,
			})
			return reply(result)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			const code = (err as { code?: unknown })?.code
			config.onEvent?.({
				event: 'brc100_call',
				method: walletMethod,
				origin,
				status: 400,
				error: message,
				...(typeof code === 'string' ? { code } : {}),
			})
			return reply({ error: message }, 400)
		}
	}
}
