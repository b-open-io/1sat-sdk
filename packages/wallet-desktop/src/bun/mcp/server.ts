/**
 * MCP server for wallet-desktop.
 *
 * Exposes browser automation, blockchain data, and wallet tools
 * over HTTP Streamable transport with BRC-31 authentication.
 */
type HttpServer = ReturnType<typeof Bun.serve>
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createLogger, createRequestLogger } from 'evlog'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { BrowserWindow } from 'electrobun/bun'
import {
	handleAuthDiscovery,
	handleHandshake,
	stopSessionCleanup,
	verifyRequest,
} from './auth'
import { closeAll } from './browser-pool'
import { registerAllMcpTools } from './tools/index'

const MCP_PORT = 3322
const HOST = '127.0.0.1'

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': '*',
}

// Per-session MCP server instances (keyed by mcp-session-id)
const mcpSessions = new Map<
	string,
	{
		server: McpServer
		transport: WebStandardStreamableHTTPServerTransport
	}
>()

let mainWindowRef: BrowserWindow | undefined

function createMcpServer(): McpServer {
	const srv = new McpServer(
		{ name: '1sat-browser', version: '0.0.1' },
		{
			capabilities: { tools: {} },
			instructions:
				'This server controls the 1Sat desktop browser. ' +
				'It can open pages (including 1sat:// inscriptions), interact with tabs, ' +
				'execute JS, query blockchain data, and manage wallet operations.',
		},
	)

	registerAllMcpTools(srv, () => {
		if (!mainWindowRef) throw new Error('Main window not available')
		return mainWindowRef
	})
	return srv
}

let httpServer: HttpServer | undefined

export function startMcpServer(mainWindow: BrowserWindow): void {
	mainWindowRef = mainWindow
	if (httpServer) return

	httpServer = Bun.serve({
		hostname: HOST,
		port: MCP_PORT,
		async fetch(req: Request): Promise<Response> {
			const url = new URL(req.url)
			const log = createRequestLogger(req)
			log.set({ route: url.pathname, method: req.method })

			// CORS preflight
			if (req.method === 'OPTIONS') {
				log.set({ status: 204, type: 'preflight' })
				log.emit()
				return new Response(null, { status: 204, headers: CORS_HEADERS })
			}

			// Health check
			if (url.pathname === '/' && req.method === 'GET') {
				log.set({ status: 200, type: 'health' })
				log.emit()
				return Response.json({
					name: '1sat-browser',
					version: '0.0.1',
					transport: 'streamable-http',
					auth: 'brc-31',
				}, { headers: CORS_HEADERS })
			}

			// BRC-31 auth discovery
			if (url.pathname === '/.well-known/auth' && req.method === 'GET') {
				log.set({ status: 200, type: 'auth_discovery' })
				log.emit()
				return handleAuthDiscovery()
			}

			// BRC-31 handshake
			if (url.pathname === '/.well-known/auth' && req.method === 'POST') {
				const response = await handleHandshake(req)
				log.set({ status: response.status, type: 'auth_handshake' })
				log.emit()
				return response
			}

			// MCP endpoint — requires BRC-31 auth on session creation,
			// then trusts the mcp-session-id for subsequent requests.
			if (url.pathname === '/mcp') {
				// Session termination
				if (req.method === 'DELETE') {
					const sessionId = req.headers.get('mcp-session-id')
					if (sessionId && mcpSessions.has(sessionId)) {
						const session = mcpSessions.get(sessionId)!
						session.server.close()
						mcpSessions.delete(sessionId)
						log.set({ status: 204, type: 'session_delete', sessionId })
						log.emit()
						return new Response(null, { status: 204, headers: CORS_HEADERS })
					}
					log.set({ status: 404, error: 'session_not_found' })
					log.emit()
					return Response.json({ error: 'Session not found' }, { status: 404, headers: CORS_HEADERS })
				}

				// Existing session — already authenticated at creation time
				const sessionId = req.headers.get('mcp-session-id')
				if (sessionId && mcpSessions.has(sessionId)) {
					const session = mcpSessions.get(sessionId)!
					const response = await session.transport.handleRequest(req)
					log.set({ status: response.status, type: 'mcp_request', sessionId })
					log.emit()
					return addCorsHeaders(response)
				}

				// New session — requires BRC-31 auth
				const auth = await verifyRequest(req)
				if (!auth) {
					log.set({ status: 401, error: 'auth_required' })
					log.emit()
					return Response.json(
						{ error: 'Unauthorized — BRC-31 auth required' },
						{ status: 401, headers: CORS_HEADERS },
					)
				}

				// New MCP session — create server before transport to avoid TDZ
				const mcpServer = createMcpServer()

				const transport = new WebStandardStreamableHTTPServerTransport({
					sessionIdGenerator: () => crypto.randomUUID(),
					onsessioninitialized: (id: string) => {
						mcpSessions.set(id, { server: mcpServer, transport })
						const sessionLog = createLogger({ context: 'mcp' })
						sessionLog.set({ event: 'session_created', sessionId: id })
						sessionLog.emit()
					},
				})

				await mcpServer.connect(transport)
				const response = await transport.handleRequest(req)
				log.set({ status: response.status, type: 'mcp_new_session' })
				log.emit()
				return addCorsHeaders(response)
			}

			log.set({ status: 404, error: 'not_found' })
			log.emit()
			return Response.json(
				{ error: `Not found: ${url.pathname}` },
				{ status: 404, headers: CORS_HEADERS },
			)
		},
	})

	const startLog = createLogger({ context: 'startup' })
	startLog.set({ event: 'mcp_listening', host: HOST, port: MCP_PORT })
	startLog.emit()
}

export function stopMcpServer(): void {
	if (httpServer) {
		httpServer.stop()
		httpServer = undefined
	}
	stopSessionCleanup()
	closeAll()

	// Close all MCP sessions
	for (const [id, session] of mcpSessions) {
		session.server.close()
		mcpSessions.delete(id)
	}

	const stopLog = createLogger({ context: 'shutdown' })
	stopLog.set({ event: 'mcp_stopped' })
	stopLog.emit()
}

function addCorsHeaders(response: Response): Response {
	const headers = new Headers(response.headers)
	for (const [key, value] of Object.entries(CORS_HEADERS)) {
		headers.set(key, value)
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}
