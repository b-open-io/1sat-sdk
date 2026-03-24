/**
 * BRC-31 client authentication for connecting to the MCP server.
 *
 * Ported from ~/code/clawnet/packages/cli/src/brc31.ts — adapted for
 * wallet-desktop with persistent client identity key storage.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { WalletProtocol } from '@bsv/sdk'
import { Hash, KeyDeriver, PrivateKey, Signature } from '@bsv/sdk'

const AUTH_PROTOCOL_ID: WalletProtocol = [2, 'authrite message signature']
const KEY_DIR = `${process.env.HOME}/.1sat-wallet`
const CLIENT_KEY_PATH = `${KEY_DIR}/mcp-chat-client.key`

// ---------------------------------------------------------------------------
// Client identity key
// ---------------------------------------------------------------------------

let clientKey: PrivateKey | undefined

export function getClientPrivateKey(): PrivateKey {
	if (clientKey) return clientKey

	mkdirSync(KEY_DIR, { recursive: true })

	if (existsSync(CLIENT_KEY_PATH)) {
		const wif = readFileSync(CLIENT_KEY_PATH, 'utf-8').trim()
		clientKey = PrivateKey.fromWif(wif)
	} else {
		clientKey = PrivateKey.fromRandom()
		writeFileSync(CLIENT_KEY_PATH, clientKey.toWif(), { mode: 0o600 })
		console.log('[MCP Client] Generated new chat client identity key')
	}

	return clientKey
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

export interface Brc31Session {
	serverIdentityKey: string
	serverNonce: string
	clientKey: PrivateKey
}

let cachedSession: Brc31Session | null = null

export function clearSession(): void {
	cachedSession = null
}

function generateNonce(): string {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	return btoa(String.fromCharCode(...Array.from(bytes)))
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

export async function performHandshake(
	baseUrl: string,
	key: PrivateKey,
): Promise<Brc31Session> {
	const pubkey = key.toPublicKey().toString()
	const clientNonce = generateNonce()

	const res = await fetch(`${baseUrl}/.well-known/auth`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			authrite: '0.1',
			messageType: 'initialRequest',
			identityKey: pubkey,
			nonce: clientNonce,
		}),
	})

	if (!res.ok) {
		const body = await res.text().catch(() => '')
		throw new Error(`BRC-31 handshake failed: HTTP ${res.status} ${body}`)
	}

	const data = await res.json()

	if (data.messageType !== 'initialResponse') {
		throw new Error(`Unexpected messageType: ${data.messageType}`)
	}

	if (!data.identityKey || !data.nonce || !data.signature) {
		throw new Error('Incomplete handshake response')
	}

	// Verify server signature
	const serverNonce = data.nonce as string
	const deriver = new KeyDeriver(key)
	const keyId = `${serverNonce} ${clientNonce}`
	const serverSigningPub = deriver.derivePublicKey(
		AUTH_PROTOCOL_ID,
		keyId,
		data.identityKey as string,
		false,
	)

	const clientNonceBytes = Uint8Array.from(atob(clientNonce), (c) =>
		c.charCodeAt(0),
	)
	const serverNonceBytes = Uint8Array.from(atob(serverNonce), (c) =>
		c.charCodeAt(0),
	)
	const signedData = new Uint8Array([...clientNonceBytes, ...serverNonceBytes])
	const msgHash = Hash.sha256(Array.from(signedData))

	const sig = Signature.fromDER(data.signature as string, 'hex')
	if (!serverSigningPub.verify(Array.from(msgHash), sig)) {
		throw new Error('Server signature verification failed')
	}

	return {
		serverIdentityKey: data.identityKey as string,
		serverNonce,
		clientKey: key,
	}
}

export async function ensureSession(
	baseUrl: string,
	key: PrivateKey,
): Promise<Brc31Session> {
	if (!cachedSession) {
		cachedSession = await performHandshake(baseUrl, key)
	}
	return cachedSession
}

// ---------------------------------------------------------------------------
// Request signing
// ---------------------------------------------------------------------------

export function signRequest(
	session: Brc31Session,
	method: string,
	pathname: string,
	body?: string,
): Record<string, string> {
	const { serverIdentityKey, serverNonce, clientKey: key } = session
	const pubkey = key.toPublicKey().toString()
	const perMessageNonce = generateNonce()

	const deriver = new KeyDeriver(key)
	const keyId = `${perMessageNonce} ${serverNonce}`
	const derivedPrivKey = deriver.derivePrivateKey(
		AUTH_PROTOCOL_ID,
		keyId,
		serverIdentityKey,
	)

	const upperMethod = method.toUpperCase()
	const payload =
		body && upperMethod !== 'GET' && upperMethod !== 'DELETE'
			? new TextEncoder().encode(body)
			: new TextEncoder().encode(pathname)

	const msgHash = Hash.sha256(Array.from(payload))
	const sig = derivedPrivKey.sign(Array.from(msgHash))

	return {
		'x-bsv-auth-version': '0.1',
		'x-bsv-auth-identity-key': pubkey,
		'x-bsv-auth-nonce': perMessageNonce,
		'x-bsv-auth-your-nonce': serverNonce,
		'x-bsv-auth-signature': sig.toDER('hex') as string,
	}
}
