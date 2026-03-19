/**
 * Sigma OAuth — PKCE flow helpers for Sigma Identity provider.
 *
 * These are standard OAuth 2.0 + PKCE utilities. No dependency on
 * @sigma-auth/better-auth-plugin — the consuming app's server-side
 * callback route handles the token exchange.
 */

/** Sigma Identity server URL */
export const SIGMA_URL = 'https://auth.sigmaidentity.com'

/** Standard Sigma authorize endpoint (custom gate that checks wallet status first) */
const SIGMA_AUTHORIZE_PATH = '/oauth2/authorize'

export interface SigmaOAuthConfig {
	/** OAuth client ID registered with Sigma */
	clientId: string
	/** Local callback URL path (default: /auth/sigma/callback) */
	callbackURL?: string
	/** Scopes to request (default: ['openid', 'profile']) */
	scopes?: string[]
}

export interface SigmaOAuthResult {
	/** BAP ID returned from the callback */
	bapId: string
	/** Public key hex */
	pubkey: string
	/** Full user object from the server callback */
	user: Record<string, unknown>
	/** Access token */
	accessToken: string
}

const STORAGE_PREFIX = 'sigma_oauth_'
const STATE_KEY = `${STORAGE_PREFIX}state`
const VERIFIER_KEY = `${STORAGE_PREFIX}verifier`

// --- PKCE helpers ---

function randomBytes(length: number): Uint8Array {
	const buf = new Uint8Array(length)
	crypto.getRandomValues(buf)
	return buf
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generateVerifier(): string {
	return base64UrlEncode(randomBytes(32))
}

function generateState(): string {
	return base64UrlEncode(randomBytes(16))
}

async function computeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(verifier)
	const hash = await crypto.subtle.digest('SHA-256', data)
	return base64UrlEncode(new Uint8Array(hash))
}

// --- Public API ---

/**
 * Initiate Sigma OAuth by redirecting the browser to the authorize endpoint.
 *
 * Generates PKCE verifier/challenge, stores state in sessionStorage,
 * and navigates the browser away. Returns a never-resolving Promise
 * since the page navigates.
 */
export async function initiateSigmaOAuth(
	config: SigmaOAuthConfig,
): Promise<never> {
	const callbackURL = config.callbackURL ?? '/auth/sigma/callback'
	const scopes = config.scopes ?? ['openid', 'profile']

	const verifier = generateVerifier()
	const challenge = await computeChallenge(verifier)
	const state = generateState()

	sessionStorage.setItem(VERIFIER_KEY, verifier)
	sessionStorage.setItem(STATE_KEY, state)

	const redirectUri = new URL(callbackURL, window.location.origin).toString()

	const params = new URLSearchParams({
		response_type: 'code',
		client_id: config.clientId,
		redirect_uri: redirectUri,
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		scope: scopes.join(' '),
	})

	const authorizeUrl = `${SIGMA_URL}${SIGMA_AUTHORIZE_PATH}?${params.toString()}`
	window.location.href = authorizeUrl

	// Page navigates away — return a never-resolving promise
	return new Promise<never>(() => {})
}

/**
 * Check if the current URL has Sigma OAuth callback parameters
 * that match a pending OAuth flow.
 */
export function isSigmaCallback(searchParams: URLSearchParams): boolean {
	const code = searchParams.get('code')
	const state = searchParams.get('state')
	const storedState = sessionStorage.getItem(STATE_KEY)
	return !!(code && state && storedState && state === storedState)
}

/**
 * Complete Sigma OAuth by exchanging the authorization code.
 *
 * Validates state from sessionStorage, POSTs the code + verifier to the
 * app's server-side callback route, and returns the user info.
 *
 * @param searchParams - URL search params from the callback
 * @param serverCallbackUrl - Server-side route that exchanges code for tokens
 *   (default: /api/auth/sigma/callback)
 */
export async function completeSigmaOAuth(
	searchParams: URLSearchParams,
	serverCallbackUrl = '/api/auth/sigma/callback',
): Promise<SigmaOAuthResult> {
	const code = searchParams.get('code')
	const state = searchParams.get('state')
	const storedState = sessionStorage.getItem(STATE_KEY)
	const verifier = sessionStorage.getItem(VERIFIER_KEY)

	if (!code || !state) {
		throw new Error('Missing OAuth callback parameters (code or state)')
	}

	if (!storedState || state !== storedState) {
		throw new Error('OAuth state mismatch — possible CSRF attack')
	}

	if (!verifier) {
		throw new Error('Missing PKCE verifier — OAuth flow was not initiated')
	}

	// Clean up session storage
	sessionStorage.removeItem(STATE_KEY)
	sessionStorage.removeItem(VERIFIER_KEY)

	const response = await fetch(serverCallbackUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code, state, code_verifier: verifier }),
	})

	if (!response.ok) {
		const text = await response.text().catch(() => '')
		throw new Error(
			`Sigma OAuth token exchange failed (${response.status}): ${text}`,
		)
	}

	const result = await response.json()

	const bapId = result.user?.bap_id
	if (!bapId) {
		throw new Error('Sigma callback response missing bap_id')
	}

	const pubkey = result.user?.pubkey
	if (!pubkey) {
		throw new Error('Sigma callback response missing pubkey')
	}

	return {
		bapId,
		pubkey,
		user: result.user,
		accessToken: result.access_token ?? '',
	}
}
