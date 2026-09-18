/**
 * BRC-100 application-facing request router.
 *
 * Framework-agnostic fetch handler (`(Request) => Response`) that dispatches
 * `POST /<walletMethod>` to a wallet, applying the sensitive-method approval
 * policy and manifest-based origin trust. This is the shared core of the
 * dApp-connectivity endpoint first implemented in wallet-desktop; the desktop
 * keeps its own HTTP/TLS/permission plumbing and can adopt this core as it
 * evolves. Node/Bun-agnostic: uses only Web-standard Request/Response.
 */

import type { WalletMethod } from './methods.js'
import {
	NO_ARG_METHODS,
	SENSITIVE_METHODS,
	walletMethodSet,
} from './methods.js'

/** Execution surface the router dispatches to. */
export interface BRC100WalletHandle {
	/** Execute a wallet method on behalf of an app origin. */
	call(method: WalletMethod, args: unknown, origin: string): Promise<unknown>
	/** False when the wallet is locked/unavailable → 503. */
	isReady?(): boolean
}

/** Approval request handed to the policy for a sensitive method. */
export interface BRC100ApprovalRequest {
	method: WalletMethod
	origin: string
	args: unknown
}

/**
 * Gate for sensitive methods. Resolve to approve, reject to deny.
 * Trusted origins (manifest trust) skip the policy entirely.
 */
export type BRC100ApprovalPolicy = (req: BRC100ApprovalRequest) => Promise<void>

/** Origin trust check; resolve true to auto-approve sensitive methods. */
export type BRC100TrustCheck = (origin: string) => Promise<boolean>

export interface BRC100RouterConfig {
	wallet: BRC100WalletHandle
	/** Defaults to auto-approve (headless CLI use). */
	approvalPolicy?: BRC100ApprovalPolicy
	/** Defaults to "no origin is trusted". */
	isOriginTrusted?: BRC100TrustCheck
	/** Serves GET /manifest.json when provided (babbage trust manifest). */
	manifest?: unknown
	/** Override the Origin/Originator parsing. */
	parseOrigin?: (req: Request) => string
	/** Extra response headers on every reply (CORS etc.). */
	baseHeaders?: Record<string, string>
	/** Request logger hook. */
	onEvent?: (event: Record<string, unknown>) => void
}

const JSON_HEADERS: Record<string, string> = {
	'Content-Type': 'application/json',
}

/** Default origin parsing: X-1Sat-Origin, then Origin, then Originator. */
export function defaultParseOrigin(req: Request): string {
	const satOrigin = req.headers.get('X-1Sat-Origin')
	if (satOrigin?.startsWith('1sat://')) return satOrigin

	const origin = req.headers.get('Origin')
	if (origin) {
		try {
			return new URL(origin).host
		} catch {
			return origin
		}
	}
	const originator = req.headers.get('Originator')
	if (originator) {
		try {
			const candidate = originator.includes('://')
				? originator
				: `http://${originator}`
			return new URL(candidate).host
		} catch {
			return originator
		}
	}
	return 'unknown'
}

/** Create a fetch handler for the BRC-100 endpoints. */
export function createBRC100Router(
	config: BRC100RouterConfig,
): (req: Request) => Promise<Response> {
	const parseOrigin = config.parseOrigin ?? defaultParseOrigin
	const isTrusted = config.isOriginTrusted ?? (async () => false)

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

		let args: unknown = {}
		if (!NO_ARG_METHODS.has(walletMethod)) {
			try {
				args = await req.json()
			} catch {
				args = {}
			}
		}

		try {
			if (SENSITIVE_METHODS.has(walletMethod)) {
				const trusted = await isTrusted(origin)
				config.onEvent?.({
					event: 'brc100_sensitive',
					method: walletMethod,
					origin,
					trusted,
				})
				if (!trusted) {
					if (config.approvalPolicy) {
						await config.approvalPolicy({
							method: walletMethod,
							origin,
							args,
						})
					}
					// No policy configured → headless auto-approve.
				}
			}

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
			config.onEvent?.({
				event: 'brc100_call',
				method: walletMethod,
				origin,
				status: 400,
				error: message,
			})
			return reply({ error: message }, 400)
		}
	}
}
