/**
 * 1sat mcp-proxy — stdio-to-HTTP bridge for the wallet-desktop MCP server.
 *
 * Performs BRC-31 handshake, then proxies JSON-RPC messages from stdin
 * to the MCP server at :3322 with signed auth headers on each request.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Hash, KeyDeriver, PrivateKey, Signature, Utils } from '@bsv/sdk'
import type { WalletProtocol } from '@bsv/sdk'
import { createLogger, initLogger } from 'evlog'

const { toBase64, toArray } = Utils

initLogger({ env: { service: '1sat-mcp-proxy' } })

const MCP_URL = process.env.ONESAT_MCP_URL ?? 'http://127.0.0.1:3322'
const KEY_DIR = `${process.env.HOME}/.1sat-wallet`
const CLIENT_KEY_PATH = `${KEY_DIR}/mcp-agent.key`
const AUTH_PROTOCOL_ID: WalletProtocol = [2, 'authrite message signature']

function generateNonce(): string {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	return toBase64(Array.from(bytes))
}

function getClientKey(): PrivateKey {
	mkdirSync(KEY_DIR, { recursive: true })
	if (existsSync(CLIENT_KEY_PATH)) {
		return PrivateKey.fromWif(readFileSync(CLIENT_KEY_PATH, 'utf-8').trim())
	}
	const key = PrivateKey.fromRandom()
	writeFileSync(CLIENT_KEY_PATH, key.toWif(), { mode: 0o600 })
	const log = createLogger({ context: 'startup' })
	log.set({ event: 'key_generated', path: CLIENT_KEY_PATH })
	log.emit()
	return key
}

interface Session {
	serverIdentityKey: string
	serverNonce: string
	clientKey: PrivateKey
}

async function handshake(key: PrivateKey): Promise<Session> {
	const pubkey = key.toPublicKey().toString()
	const clientNonce = generateNonce()

	const res = await fetch(`${MCP_URL}/.well-known/auth`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			authrite: '0.1',
			messageType: 'initialRequest',
			identityKey: pubkey,
			nonce: clientNonce,
		}),
	})

	if (!res.ok) throw new Error(`Handshake failed: HTTP ${res.status}`)

	const data = await res.json()
	if (data.messageType !== 'initialResponse')
		throw new Error(`Unexpected: ${data.messageType}`)

	const serverNonce = data.nonce as string
	const deriver = new KeyDeriver(key)
	const serverPub = deriver.derivePublicKey(
		AUTH_PROTOCOL_ID,
		`${serverNonce} ${clientNonce}`,
		data.identityKey as string,
		false,
	)

	const clientNonceBytes = toArray(clientNonce, 'base64')
	const serverNonceBytes = toArray(serverNonce, 'base64')
	const msgHash = Hash.sha256(
		Array.from(new Uint8Array([...clientNonceBytes, ...serverNonceBytes])),
	)

	const sig = Signature.fromDER(data.signature as string, 'hex')
	if (!serverPub.verify(Array.from(msgHash), sig))
		throw new Error('Server signature verification failed')

	const log = createLogger({ context: 'auth' })
	log.set({
		event: 'handshake_complete',
		serverIdentityKey: (data.identityKey as string).slice(0, 16),
	})
	log.emit()

	return {
		serverIdentityKey: data.identityKey as string,
		serverNonce,
		clientKey: key,
	}
}

function signHeaders(
	session: Session,
	pathname: string,
): Record<string, string> {
	const { serverIdentityKey, serverNonce, clientKey: key } = session
	const nonce = generateNonce()
	const deriver = new KeyDeriver(key)
	const derivedKey = deriver.derivePrivateKey(
		AUTH_PROTOCOL_ID,
		`${nonce} ${serverNonce}`,
		serverIdentityKey,
	)
	const payload = new TextEncoder().encode(pathname)
	const msgHash = Hash.sha256(Array.from(payload))
	const sig = derivedKey.sign(Array.from(msgHash))

	return {
		'x-bsv-auth-version': '0.1',
		'x-bsv-auth-identity-key': key.toPublicKey().toString(),
		'x-bsv-auth-nonce': nonce,
		'x-bsv-auth-your-nonce': serverNonce,
		'x-bsv-auth-signature': sig.toDER('hex') as string,
	}
}

export async function handleMcpProxyCommand(): Promise<void> {
	const startLog = createLogger({ context: 'startup' })

	try {
		await fetch(MCP_URL, { signal: AbortSignal.timeout(2000) })
	} catch {
		startLog.set({ event: 'server_unreachable', url: MCP_URL })
		startLog.emit()
		process.stderr.write(
			`[1sat mcp-proxy] Server not reachable at ${MCP_URL} — is 1Sat wallet running?\n`,
		)
		process.exit(1)
	}

	startLog.set({ event: 'started', url: MCP_URL })
	startLog.emit()

	const key = getClientKey()
	const session = await handshake(key)

	let mcpSessionId: string | null = null
	let requestCount = 0
	const decoder = new TextDecoder()
	let buffer = ''

	for await (const value of process.stdin) {
		buffer += decoder.decode(value as Uint8Array, { stream: true })

		let newlineIdx: number
		while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, newlineIdx).trim()
			buffer = buffer.slice(newlineIdx + 1)
			if (!line) continue

			requestCount++
			const reqLog = createLogger({ context: 'proxy' })

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				...signHeaders(session, '/mcp'),
			}

			if (mcpSessionId) {
				headers['mcp-session-id'] = mcpSessionId
			}

			try {
				let method: string | undefined
				try {
					method = JSON.parse(line).method
				} catch {}

				const res = await fetch(`${MCP_URL}/mcp`, {
					method: 'POST',
					headers,
					body: line,
				})

				const sessionHeader = res.headers.get('mcp-session-id')
				if (sessionHeader) mcpSessionId = sessionHeader

				const contentType = res.headers.get('content-type') ?? ''

				reqLog.set({
					event: 'request',
					requestNum: requestCount,
					method,
					status: res.status,
					contentType: contentType.split(';')[0],
					sessionId: mcpSessionId?.slice(0, 8),
				})
				reqLog.emit()

				if (contentType.includes('text/event-stream')) {
					// Stream SSE events incrementally — res.text() would hang
					// because SSE connections stay open indefinitely
					const sseReader = res.body!.getReader()
					const sseDecoder = new TextDecoder()
					let sseBuf = ''
					while (true) {
						const { done: sseDone, value: sseValue } = await sseReader.read()
						if (sseDone) break
						sseBuf += sseDecoder.decode(sseValue, { stream: true })
						const sseLines = sseBuf.split('\n')
						sseBuf = sseLines.pop()!
						for (const sseLine of sseLines) {
							if (sseLine.startsWith('data: ')) {
								const data = sseLine.slice(6).trim()
								if (data) process.stdout.write(`${data}\n`)
							}
						}
					}
					if (sseBuf.startsWith('data: ')) {
						const data = sseBuf.slice(6).trim()
						if (data) process.stdout.write(`${data}\n`)
					}
				} else {
					const body = await res.text()
					if (body.trim()) process.stdout.write(`${body.trim()}\n`)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				reqLog.set({
					event: 'request_failed',
					requestNum: requestCount,
					error: msg,
				})
				reqLog.emit()
				process.stdout.write(
					`${JSON.stringify({
						jsonrpc: '2.0',
						error: { code: -32000, message: `MCP proxy error: ${msg}` },
						id: null,
					})}\n`,
				)
			}
		}
	}
}
