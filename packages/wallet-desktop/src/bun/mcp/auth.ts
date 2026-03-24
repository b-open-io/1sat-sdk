/**
 * BRC-31 (Authrite) authentication for the MCP server.
 *
 * Ported from ~/code/clawnet/lib/brc31.ts — standalone, no Convex dependency.
 * Server identity key generated on first run, stored in ~/.1sat-wallet/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { WalletProtocol } from '@bsv/sdk'
import { Hash, KeyDeriver, PrivateKey, Signature } from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTH_PROTOCOL_ID: WalletProtocol = [2, 'authrite message signature']

const AUTH_HEADERS = {
	IDENTITY_KEY: 'x-bsv-auth-identity-key',
	NONCE: 'x-bsv-auth-nonce',
	YOUR_NONCE: 'x-bsv-auth-your-nonce',
	SIGNATURE: 'x-bsv-auth-signature',
} as const

const AUTHRITE_HEADERS = {
	IDENTITY_KEY: 'x-authrite-identity-key',
	NONCE: 'x-authrite-nonce',
	YOUR_NONCE: 'x-authrite-yournonce',
	SIGNATURE: 'x-authrite-signature',
} as const

const SESSION_TTL_MS = 3600_000 // 1 hour
const CLEANUP_INTERVAL_MS = 300_000 // 5 minutes
const KEY_DIR = `${process.env.HOME}/.1sat-wallet`
const IDENTITY_KEY_PATH = `${KEY_DIR}/mcp-identity.key`

// ---------------------------------------------------------------------------
// Session store (in-memory, keyed by serverNonce)
// ---------------------------------------------------------------------------

interface AuthSession {
	clientIdentityKey: string
	clientNonce: string
	serverNonce: string
	createdAt: number
	expiresAt: number
}

const sessions = new Map<string, AuthSession>()
let cleanupTimer: ReturnType<typeof setInterval> | undefined

function startSessionCleanup(): void {
	if (cleanupTimer) return
	cleanupTimer = setInterval(() => {
		const now = Date.now()
		for (const [key, session] of sessions) {
			if (session.expiresAt < now) sessions.delete(key)
		}
	}, CLEANUP_INTERVAL_MS)
}

export function stopSessionCleanup(): void {
	if (cleanupTimer) {
		clearInterval(cleanupTimer)
		cleanupTimer = undefined
	}
}

// ---------------------------------------------------------------------------
// Server identity key
// ---------------------------------------------------------------------------

let serverKey: PrivateKey | undefined

export function getServerPrivateKey(): PrivateKey {
	if (serverKey) return serverKey

	mkdirSync(KEY_DIR, { recursive: true })

	if (existsSync(IDENTITY_KEY_PATH)) {
		const wif = readFileSync(IDENTITY_KEY_PATH, 'utf-8').trim()
		serverKey = PrivateKey.fromWif(wif)
	} else {
		serverKey = PrivateKey.fromRandom()
		writeFileSync(IDENTITY_KEY_PATH, serverKey.toWif(), { mode: 0o600 })
		console.log('[MCP] Generated new server identity key')
	}

	return serverKey
}

export function getServerPublicKeyHex(): string {
	return getServerPrivateKey().toPublicKey().toString()
}

// ---------------------------------------------------------------------------
// BRC-31 crypto primitives (from clawnet/lib/brc31.ts)
// ---------------------------------------------------------------------------

function generateNonce(): string {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	return btoa(String.fromCharCode(...Array.from(bytes)))
}

function isValidIdentityKey(key: string): boolean {
	return /^0[23][0-9a-fA-F]{64}$/.test(key)
}

function signWithDerivedKey(
	payload: Uint8Array | number[],
	signerPrivateKey: PrivateKey,
	counterpartyPubkeyHex: string,
	senderNonce: string,
	recipientNonce: string,
): string {
	const deriver = new KeyDeriver(signerPrivateKey)
	const keyId = `${senderNonce} ${recipientNonce}`
	const derivedKey = deriver.derivePrivateKey(
		AUTH_PROTOCOL_ID,
		keyId,
		counterpartyPubkeyHex,
	)
	const msgHash = Hash.sha256(Array.from(payload))
	const sig = derivedKey.sign(Array.from(msgHash))
	return sig.toDER('hex') as string
}

function verifyMessageSignature(
	payload: Uint8Array | number[],
	signatureHex: string,
	senderIdentityKeyHex: string,
	verifierPrivateKey: PrivateKey,
	senderNonce: string,
	verifierNonce: string,
): boolean {
	try {
		const deriver = new KeyDeriver(verifierPrivateKey)
		const keyId = `${senderNonce} ${verifierNonce}`
		const senderDerivedPub = deriver.derivePublicKey(
			AUTH_PROTOCOL_ID,
			keyId,
			senderIdentityKeyHex,
			false,
		)
		const sig = Signature.fromDER(signatureHex, 'hex')
		const msgHash = Hash.sha256(Array.from(payload))
		return senderDerivedPub.verify(Array.from(msgHash), sig)
	} catch {
		return false
	}
}

interface AuthHeaders {
	identityKey: string | null
	nonce: string | null
	yourNonce: string | null
	signature: string | null
}

function extractAuthHeaders(request: Request): AuthHeaders {
	const h = request.headers
	return {
		identityKey:
			h.get(AUTH_HEADERS.IDENTITY_KEY) ?? h.get(AUTHRITE_HEADERS.IDENTITY_KEY),
		nonce: h.get(AUTH_HEADERS.NONCE) ?? h.get(AUTHRITE_HEADERS.NONCE),
		yourNonce:
			h.get(AUTH_HEADERS.YOUR_NONCE) ?? h.get(AUTHRITE_HEADERS.YOUR_NONCE),
		signature:
			h.get(AUTH_HEADERS.SIGNATURE) ?? h.get(AUTHRITE_HEADERS.SIGNATURE),
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AuthContext {
	identityKey: string
}

/**
 * Handle BRC-31 handshake (POST /.well-known/auth).
 * Returns the initialResponse JSON.
 */
export async function handleHandshake(request: Request): Promise<Response> {
	try {
		const body = await request.json()

		if (body.messageType !== 'initialRequest') {
			return Response.json(
				{ error: `Unsupported messageType: ${body.messageType}` },
				{ status: 400 },
			)
		}

		const clientIdentityKey = body.identityKey as string | undefined
		const clientNonce = (body.nonce ?? body.initialNonce) as string | undefined

		if (!clientIdentityKey || !isValidIdentityKey(clientIdentityKey)) {
			return Response.json(
				{ error: 'Missing or invalid identityKey' },
				{ status: 400 },
			)
		}
		if (!clientNonce) {
			return Response.json({ error: 'Missing nonce' }, { status: 400 })
		}

		const serverNonce = generateNonce()

		// Sign (clientNonce || serverNonce) with BRC-43 derived key
		const clientNonceBytes = Uint8Array.from(atob(clientNonce), (c) =>
			c.charCodeAt(0),
		)
		const serverNonceBytes = Uint8Array.from(atob(serverNonce), (c) =>
			c.charCodeAt(0),
		)
		const dataToSign = new Uint8Array([
			...clientNonceBytes,
			...serverNonceBytes,
		])

		const sk = getServerPrivateKey()
		const signatureHex = signWithDerivedKey(
			dataToSign,
			sk,
			clientIdentityKey,
			serverNonce,
			clientNonce,
		)

		// Store session
		const now = Date.now()
		sessions.set(serverNonce, {
			clientIdentityKey,
			clientNonce,
			serverNonce,
			createdAt: now,
			expiresAt: now + SESSION_TTL_MS,
		})

		startSessionCleanup()

		return Response.json({
			authrite: '0.1',
			messageType: 'initialResponse',
			identityKey: getServerPublicKeyHex(),
			nonce: serverNonce,
			initialNonce: serverNonce,
			yourNonce: clientNonce,
			signature: signatureHex,
		})
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		console.error('[MCP] Handshake error:', msg)
		return Response.json({ error: 'Handshake failed' }, { status: 500 })
	}
}

/**
 * Handle GET /.well-known/auth — server identity discovery.
 */
export function handleAuthDiscovery(): Response {
	return Response.json({
		authrite: '0.1',
		identityKey: getServerPublicKeyHex(),
		messageTypes: ['initialRequest', 'initialResponse', 'general'],
	})
}

/**
 * Verify BRC-31 auth headers on an MCP request.
 * Returns the authenticated identity key, or null if verification fails.
 */
export async function verifyRequest(
	request: Request,
): Promise<AuthContext | null> {
	const headers = extractAuthHeaders(request)

	if (!headers.identityKey || !headers.signature || !headers.yourNonce) {
		return null
	}

	if (!isValidIdentityKey(headers.identityKey)) {
		return null
	}

	// Look up session by server nonce (yourNonce = server's nonce echoed back)
	const session = sessions.get(headers.yourNonce)
	if (!session) return null

	// Check expiry
	if (session.expiresAt < Date.now()) {
		sessions.delete(headers.yourNonce)
		return null
	}

	// Verify identity key matches session
	if (session.clientIdentityKey !== headers.identityKey) return null

	// Verify signature against the pathname.
	// MCP clients send static auth headers set at connection time,
	// so the signature is always over the pathname, not the body
	// (the body varies per JSON-RPC message but the auth headers don't).
	const payload = new TextEncoder().encode(new URL(request.url).pathname)

	const clientNonce = headers.nonce ?? session.clientNonce
	const valid = verifyMessageSignature(
		payload,
		headers.signature,
		headers.identityKey,
		getServerPrivateKey(),
		clientNonce,
		session.serverNonce,
	)

	if (!valid) return null

	return { identityKey: headers.identityKey }
}
