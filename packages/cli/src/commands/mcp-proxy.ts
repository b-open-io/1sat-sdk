/**
 * 1sat mcp-proxy — stdio-to-HTTP bridge for the wallet-desktop MCP server.
 *
 * Authenticates with BRC-103/104 via AuthFetch + ProtoWallet and proxies
 * JSON-RPC newline-delimited messages from stdin to the local MCP server
 * at :3322, writing responses to stdout.
 *
 * Used by Claude Code's .mcp.json to connect agents to the running
 * 1Sat desktop wallet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { AuthFetch, PrivateKey, ProtoWallet } from '@bsv/sdk'

const MCP_URL = process.env.ONESAT_MCP_URL ?? 'http://127.0.0.1:3322'
const KEY_DIR = `${process.env.HOME}/.1sat-wallet`
const CLIENT_KEY_PATH = `${KEY_DIR}/mcp-agent.key`

function log(msg: string): void {
	process.stderr.write(`[1sat mcp-proxy] ${msg}\n`)
}

function getClientKey(): PrivateKey {
	mkdirSync(KEY_DIR, { recursive: true })

	if (existsSync(CLIENT_KEY_PATH)) {
		return PrivateKey.fromWif(readFileSync(CLIENT_KEY_PATH, 'utf-8').trim())
	}

	const key = PrivateKey.fromRandom()
	writeFileSync(CLIENT_KEY_PATH, key.toWif(), { mode: 0o600 })
	log('Generated new agent identity key')
	return key
}

export async function handleMcpProxyCommand(): Promise<void> {
	// Health check before doing anything else
	try {
		await fetch(MCP_URL, { signal: AbortSignal.timeout(2000) })
	} catch {
		log(`Server not reachable at ${MCP_URL} — is 1Sat wallet running?`)
		process.exit(1)
	}

	const key = getClientKey()
	const wallet = new ProtoWallet(key)
	const authFetch = new AuthFetch(wallet)

	log(`Connecting to ${MCP_URL}/mcp`)

	let mcpSessionId: string | null = null

	const decoder = new TextDecoder()
	const reader = Bun.stdin.stream().getReader()
	let buffer = ''

	while (true) {
		const { done, value } = await reader.read()
		if (done) break

		buffer += decoder.decode(value, { stream: true })

		let newlineIdx: number
		while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, newlineIdx).trim()
			buffer = buffer.slice(newlineIdx + 1)

			if (!line) continue

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
			}

			if (mcpSessionId) {
				headers['mcp-session-id'] = mcpSessionId
			}

			try {
				const res = await authFetch.fetch(`${MCP_URL}/mcp`, {
					method: 'POST',
					body: line,
					headers,
				})

				const sessionHeader = res.headers.get('mcp-session-id')
				if (sessionHeader) mcpSessionId = sessionHeader

				const contentType = res.headers.get('content-type') ?? ''

				if (contentType.includes('text/event-stream')) {
					const text = await res.text()
					for (const eventLine of text.split('\n')) {
						if (eventLine.startsWith('data: ')) {
							const data = eventLine.slice(6).trim()
							if (data) process.stdout.write(`${data}\n`)
						}
					}
				} else {
					const body = await res.text()
					if (body.trim()) process.stdout.write(`${body.trim()}\n`)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				log(`Request failed: ${msg}`)
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
