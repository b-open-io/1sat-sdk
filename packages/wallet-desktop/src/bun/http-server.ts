import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import type { WalletInterface } from '@bsv/sdk'
/**
 * BRC-100 HTTP server for dApp connectivity.
 *
 * Exposes all 28 WalletInterface methods as POST endpoints.
 * - HTTP  on 127.0.0.1:3321
 * - HTTPS on 127.0.0.1:2121 (self-signed cert, trusted on first run)
 *
 * Sensitive methods route through the WebView for user approval.
 * Compatible with `new WalletClient('auto')` from `@bsv/sdk`.
 */
import type { Server } from 'bun'
import type { PermissionRequest } from '../shared/types'
import { getWallet } from './wallet-manager'

const HTTP_PORT = 3321
const HTTPS_PORT = 2121
const HOST = '127.0.0.1'

const CERT_DIR = `${process.env.HOME}/.1sat-wallet/certs`
const CERT_PATH = `${CERT_DIR}/server.crt`
const KEY_PATH = `${CERT_DIR}/server.key`
const SSL_PROMPTED_FLAG = `${CERT_DIR}/.ssl-prompted`

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': '*',
	'Access-Control-Allow-Headers': '*',
	'Access-Control-Allow-Private-Network': 'true',
}

const MANIFEST = {
	short_name: '1Sat Wallet',
	name: '1Sat Wallet',
	icons: [
		{
			src: 'favicon.ico',
			sizes: '64x64 32x32 24x24 16x16',
			type: 'image/x-icon',
		},
	],
	start_url: '.',
	display: 'standalone',
	theme_color: '#000000',
	background_color: '#000000',
	babbage: {
		trust: {
			name: '1Sat Wallet',
			note: 'Bitcoin wallet with ordinals, tokens, and identity',
			icon: 'https://1satwallet.com/favicon.ico',
			publicKey:
				'0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
		},
	},
}

/** All 28 BRC-100 WalletInterface method names. */
const WALLET_METHODS = [
	'createAction',
	'signAction',
	'abortAction',
	'listActions',
	'internalizeAction',
	'listOutputs',
	'relinquishOutput',
	'getPublicKey',
	'revealCounterpartyKeyLinkage',
	'revealSpecificKeyLinkage',
	'encrypt',
	'decrypt',
	'createHmac',
	'verifyHmac',
	'createSignature',
	'verifySignature',
	'acquireCertificate',
	'listCertificates',
	'proveCertificate',
	'relinquishCertificate',
	'discoverByIdentityKey',
	'discoverByAttributes',
	'isAuthenticated',
	'waitForAuthentication',
	'getHeight',
	'getHeaderForHeight',
	'getNetwork',
	'getVersion',
] as const

type WalletMethod = (typeof WALLET_METHODS)[number]

/** Methods that take no meaningful args — pass `{}` as the first argument. */
const NO_ARG_METHODS = new Set<WalletMethod>([
	'isAuthenticated',
	'waitForAuthentication',
	'getHeight',
	'getNetwork',
	'getVersion',
])

const walletMethodSet = new Set<string>(WALLET_METHODS)

// ---------------------------------------------------------------------------
// Manifest-based trust
// ---------------------------------------------------------------------------

/** Cache of trusted origins (origin → true/false). TTL: session lifetime. */
const trustedOriginCache = new Map<string, boolean>()

/**
 * Check if an origin has a trusted manifest.
 *
 * Fetches `http(s)://<origin>/manifest.json` and checks for a
 * `babbage.trust` section. Origins with a valid trust manifest are
 * auto-approved for sensitive wallet methods.
 *
 * Our own BRC-100 server also serves a manifest — the 1sat-stack
 * sidecar at 127.0.0.1:8080 has one too. This replaces the old
 * hardcoded localhost exception with proper manifest-based trust.
 */
async function isOriginTrusted(origin: string): Promise<boolean> {
	if (trustedOriginCache.has(origin)) {
		return trustedOriginCache.get(origin)!
	}

	// For 1sat:// origins, check ORDFS metadata for trust declarations
	if (origin.startsWith('1sat://')) {
		const path = origin.slice(7)
		try {
			const res = await fetch(
				`http://127.0.0.1:8080/1sat/ordfs/metadata/${path}`,
				{ signal: AbortSignal.timeout(3000) },
			)
			if (res.ok) {
				const metadata = (await res.json()) as Record<string, unknown>
				const map = metadata.map as Record<string, unknown> | undefined
				const trust = map?.trust as Record<string, unknown> | undefined
				// Check MAP metadata for trust declaration
				if (trust?.publicKey) {
					console.log(`[BRC-100] Trusted 1sat:// origin: ${origin}`)
					trustedOriginCache.set(origin, true)
					return true
				}
			}
		} catch {
			// ORDFS metadata not available — not trusted
		}
		trustedOriginCache.set(origin, false)
		return false
	}

	// Try to fetch the origin's manifest
	const schemes = origin.includes(':') ? [''] : ['https://', 'http://']
	for (const scheme of schemes) {
		const manifestUrl = `${scheme}${origin}/manifest.json`
		try {
			const res = await fetch(manifestUrl, {
				signal: AbortSignal.timeout(3000),
			})
			if (!res.ok) continue

			const manifest = (await res.json()) as Record<string, unknown>
			const babbage = manifest.babbage as Record<string, unknown> | undefined
			const trust = babbage?.trust as Record<string, unknown> | undefined

			if (trust?.name && trust?.publicKey) {
				console.log(`[BRC-100] Trusted origin: ${origin} (${trust.name})`)
				trustedOriginCache.set(origin, true)
				return true
			}
		} catch {
			// Manifest not available or invalid — not trusted
		}
	}

	trustedOriginCache.set(origin, false)
	return false
}

/** Methods that require user approval via the WebView permission dialog. */
const SENSITIVE_METHODS = new Set<WalletMethod>([
	'createAction',
	'signAction',
	'encrypt',
	'decrypt',
	'createSignature',
	'createHmac',
	'acquireCertificate',
])

const PERMISSION_TIMEOUT_MS = 60_000

interface PendingPermission {
	resolve: (result: unknown) => void
	reject: (error: Error) => void
	method: string
	args: unknown
	origin: string
	timer: ReturnType<typeof setTimeout>
}

const pendingPermissions = new Map<string, PendingPermission>()

type PermissionPusher = (request: PermissionRequest) => void
let permissionPusher: PermissionPusher | undefined

/** Set the callback that pushes permission requests to the WebView. */
export function setPermissionPusher(fn: PermissionPusher): void {
	permissionPusher = fn
}

/**
 * Resolve a pending permission request.
 * Called from the RPC handler when the WebView responds.
 */
export function resolvePermission(params: {
	requestId: string
	approved: boolean
	error?: string
}): { success: boolean } {
	const pending = pendingPermissions.get(params.requestId)
	if (!pending) {
		console.warn(
			`[BRC-100] resolvePermission: unknown requestId ${params.requestId}`,
		)
		return { success: false }
	}

	clearTimeout(pending.timer)
	pendingPermissions.delete(params.requestId)

	if (!params.approved) {
		pending.reject(new Error(params.error ?? 'User denied permission'))
		return { success: true }
	}

	// User approved — execute the wallet method
	const wallet: WalletInterface | undefined = getWallet()?.wallet
	if (!wallet) {
		pending.reject(new Error('Wallet is locked'))
		return { success: true }
	}

	const fn = wallet[pending.method as WalletMethod] as (
		args: unknown,
		originator: string,
	) => Promise<unknown>

	fn.call(wallet, pending.args, pending.origin)
		.then((result) => pending.resolve(result))
		.catch((err) =>
			pending.reject(err instanceof Error ? err : new Error(String(err))),
		)

	return { success: true }
}

/**
 * Request user permission for a sensitive wallet method.
 * Returns a Promise that resolves with the wallet method result or rejects on denial/timeout.
 */
function requestPermission(
	requestId: string,
	method: string,
	origin: string,
	args: unknown,
): Promise<unknown> {
	if (!permissionPusher) {
		return Promise.reject(
			new Error('Permission system not initialized — WebView not connected'),
		)
	}

	return new Promise<unknown>((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingPermissions.delete(requestId)
			reject(new Error('Permission request timed out (60s)'))
		}, PERMISSION_TIMEOUT_MS)

		pendingPermissions.set(requestId, {
			resolve,
			reject,
			method,
			args,
			origin,
			timer,
		})

		permissionPusher!({ requestId, method, origin, args })
	})
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
	})
}

function parseOrigin(req: Request): string {
	// Check for 1sat:// origin from CWI preload relay
	const satOrigin = req.headers.get('X-1Sat-Origin')
	if (satOrigin?.startsWith('1sat://')) return satOrigin

	// Standard HTTP origin
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

/** Shared fetch handler for both HTTP and HTTPS servers. */
async function handleRequest(req: Request): Promise<Response> {
	// Handle CORS preflight
	if (req.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: CORS_HEADERS })
	}

	const url = new URL(req.url)
	const pathname = url.pathname

	// GET /manifest.json
	if (req.method === 'GET' && pathname === '/manifest.json') {
		return jsonResponse(MANIFEST)
	}

	// POST /<walletMethod>
	if (req.method === 'POST') {
		const method = pathname.slice(1) // strip leading /

		if (!walletMethodSet.has(method)) {
			return jsonResponse({ error: `Unknown endpoint: ${pathname}` }, 404)
		}

		const wallet: WalletInterface | undefined = getWallet()?.wallet
		if (!wallet) {
			return jsonResponse({ error: 'Wallet is locked' }, 503)
		}

		const origin = parseOrigin(req)
		const methodName = method as WalletMethod

		try {
			const args = NO_ARG_METHODS.has(methodName) ? {} : await req.json()

			// Check if the requesting origin has a trusted manifest
			const trusted = await isOriginTrusted(origin)

			// Sensitive methods require user approval — unless origin is trusted via manifest
			if (SENSITIVE_METHODS.has(methodName) && !trusted) {
				const requestId = crypto.randomUUID()
				const result = await requestPermission(
					requestId,
					methodName,
					origin,
					args,
				)
				return jsonResponse(result)
			}

			// Non-sensitive methods (or trusted origins) execute directly
			const fn = wallet[methodName] as (
				args: unknown,
				originator: string,
			) => Promise<unknown>
			const result = await fn.call(wallet, args, origin)
			return jsonResponse(result)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			console.error(`[BRC-100] ${methodName} error:`, err)
			return jsonResponse({ error: message }, 400)
		}
	}

	return jsonResponse({ error: `Not found: ${pathname}` }, 404)
}

/** Check if the certificate is expired or within 7 days of expiry. */
function isCertExpired(certPath: string): boolean {
	const proc = Bun.spawnSync([
		'openssl',
		'x509',
		'-enddate',
		'-noout',
		'-in',
		certPath,
	])
	if (proc.exitCode !== 0) return true
	const output = new TextDecoder().decode(proc.stdout)
	// output: "notAfter=Mar 22 15:43:16 2027 GMT\n"
	const match = output.match(/notAfter=(.+)/)
	if (!match) return true
	const expiry = new Date(match[1])
	const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
	return expiry < sevenDaysFromNow
}

/** Generate a new self-signed TLS certificate in ~/.1sat-wallet/certs/. */
function generateCert(): void {
	mkdirSync(CERT_DIR, { recursive: true })

	const proc = Bun.spawnSync([
		'openssl',
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-keyout',
		KEY_PATH,
		'-out',
		CERT_PATH,
		'-days',
		'365',
		'-nodes',
		'-subj',
		'/CN=localhost',
		'-addext',
		'subjectAltName=DNS:localhost,IP:127.0.0.1',
	])

	if (proc.exitCode !== 0) {
		throw new Error(
			`Failed to generate SSL cert: ${new TextDecoder().decode(proc.stderr)}`,
		)
	}
}

/**
 * Ensure a valid self-signed TLS certificate exists in ~/.1sat-wallet/certs/.
 * Generates a new cert on first run or when the existing one is expired
 * (or within 7 days of expiry).
 */
async function ensureCert(): Promise<{ cert: string; key: string }> {
	const certExists = existsSync(CERT_PATH) && existsSync(KEY_PATH)

	if (certExists && !isCertExpired(CERT_PATH)) {
		return {
			cert: readFileSync(CERT_PATH, 'utf-8'),
			key: readFileSync(KEY_PATH, 'utf-8'),
		}
	}

	if (certExists) {
		console.log(
			'[BRC-100] Certificate expired or expiring soon, regenerating...',
		)
		// Delete the trust flag so the new cert is re-trusted
		if (existsSync(SSL_PROMPTED_FLAG)) {
			unlinkSync(SSL_PROMPTED_FLAG)
		}
	}

	generateCert()

	return {
		cert: readFileSync(CERT_PATH, 'utf-8'),
		key: readFileSync(KEY_PATH, 'utf-8'),
	}
}

/**
 * Prompt macOS to trust the self-signed certificate (once).
 * Writes a flag file so the user is only prompted on first run.
 */
function promptCertTrust(): void {
	if (existsSync(SSL_PROMPTED_FLAG)) return
	if (process.platform !== 'darwin') {
		// Only macOS uses security CLI; skip on other platforms
		Bun.write(SSL_PROMPTED_FLAG, '')
		return
	}

	console.log('[BRC-100] Requesting macOS trust for self-signed certificate...')

	const proc = Bun.spawnSync([
		'security',
		'add-trusted-cert',
		'-d',
		'-r',
		'trustRoot',
		'-k',
		`${process.env.HOME}/Library/Keychains/login.keychain-db`,
		CERT_PATH,
	])

	if (proc.exitCode !== 0) {
		console.warn(
			`[BRC-100] Could not auto-trust cert (user may have cancelled): ${new TextDecoder().decode(proc.stderr)}`,
		)
	} else {
		console.log('[BRC-100] Certificate trusted successfully')
	}

	// Write flag regardless — don't re-prompt if user cancelled
	Bun.write(SSL_PROMPTED_FLAG, '')
}

let httpServer: Server | undefined
let httpsServer: Server | undefined

export async function startWalletServer(): Promise<void> {
	if (httpServer) return

	// Start HTTP server
	httpServer = Bun.serve({
		hostname: HOST,
		port: HTTP_PORT,
		fetch: handleRequest,
	})
	console.log(`BRC-100 wallet server listening on http://${HOST}:${HTTP_PORT}`)

	// Start HTTPS server
	try {
		const { cert, key } = await ensureCert()
		promptCertTrust()

		httpsServer = Bun.serve({
			hostname: HOST,
			port: HTTPS_PORT,
			tls: { cert, key },
			fetch: handleRequest,
		})
		console.log(
			`BRC-100 wallet server listening on https://${HOST}:${HTTPS_PORT}`,
		)
	} catch (err) {
		console.error(
			'[BRC-100] Failed to start HTTPS server:',
			err instanceof Error ? err.message : err,
		)
	}
}

export function stopWalletServer(): void {
	if (httpServer) {
		httpServer.stop()
		httpServer = undefined
	}
	if (httpsServer) {
		httpsServer.stop()
		httpsServer = undefined
	}
	if (!httpServer && !httpsServer) {
		console.log('BRC-100 wallet server stopped')
	}
}
