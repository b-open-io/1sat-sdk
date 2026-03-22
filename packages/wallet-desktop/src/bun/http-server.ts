import type { WalletInterface } from '@bsv/sdk'
/**
 * BRC-100 HTTP server for dApp connectivity.
 *
 * Exposes all 28 WalletInterface methods as POST endpoints.
 * - HTTP  on 127.0.0.1:3321
 * - HTTPS on 127.0.0.1:2121 (self-signed cert, trusted on first run)
 *
 * Compatible with `new WalletClient('auto')` from `@bsv/sdk`.
 */
import type { Server } from 'bun'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
	})
}

function parseOrigin(req: Request): string {
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

/**
 * Ensure a self-signed TLS certificate exists in ~/.1sat-wallet/certs/.
 * Generated via openssl on first run.
 */
async function ensureCert(): Promise<{ cert: string; key: string }> {
	if (existsSync(CERT_PATH) && existsSync(KEY_PATH)) {
		return {
			cert: readFileSync(CERT_PATH, 'utf-8'),
			key: readFileSync(KEY_PATH, 'utf-8'),
		}
	}

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

	console.log(
		'[BRC-100] Requesting macOS trust for self-signed certificate...',
	)

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
