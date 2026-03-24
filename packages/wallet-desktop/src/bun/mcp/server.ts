/**
 * MCP server for wallet-desktop.
 *
 * Exposes browser automation, blockchain data, and wallet tools
 * over HTTP Streamable transport with BRC-31 authentication.
 */
type HttpServer = ReturnType<typeof Bun.serve>
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
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
				'This server controls the 1Sat Wallet desktop browser. ' +
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

			// CORS preflight
			if (req.method === 'OPTIONS') {
				return new Response(null, { status: 204, headers: CORS_HEADERS })
			}

			// Health check
			if (url.pathname === '/' && req.method === 'GET') {
				return Response.json({
					name: '1sat-browser',
					version: '0.0.1',
					transport: 'streamable-http',
					auth: 'brc-31',
				}, { headers: CORS_HEADERS })
			}

			// BRC-31 auth discovery
			if (url.pathname === '/.well-known/auth' && req.method === 'GET') {
				return handleAuthDiscovery()
			}

			// BRC-31 handshake
			if (url.pathname === '/.well-known/auth' && req.method === 'POST') {
				return handleHandshake(req)
			}

			// MCP endpoint — requires BRC-31 auth
			if (url.pathname === '/mcp') {
				// Verify auth
				const auth = await verifyRequest(req)
				if (!auth) {
					return Response.json(
						{ error: 'Unauthorized — BRC-31 auth required' },
						{ status: 401, headers: CORS_HEADERS },
					)
				}

				// Session termination
				if (req.method === 'DELETE') {
					const sessionId = req.headers.get('mcp-session-id')
					if (sessionId && mcpSessions.has(sessionId)) {
						const session = mcpSessions.get(sessionId)!
						session.server.close()
						mcpSessions.delete(sessionId)
						return new Response(null, { status: 204, headers: CORS_HEADERS })
					}
					return Response.json({ error: 'Session not found' }, { status: 404, headers: CORS_HEADERS })
				}

				// Check for existing MCP session
				const sessionId = req.headers.get('mcp-session-id')
				if (sessionId && mcpSessions.has(sessionId)) {
					const session = mcpSessions.get(sessionId)!
					const response = await session.transport.handleRequest(req)
					return addCorsHeaders(response)
				}

				// New MCP session — create server before transport to avoid TDZ
				const mcpServer = createMcpServer()

				const transport = new WebStandardStreamableHTTPServerTransport({
					sessionIdGenerator: () => crypto.randomUUID(),
					onsessioninitialized: (id: string) => {
						mcpSessions.set(id, { server: mcpServer, transport })
					},
				})

				await mcpServer.connect(transport)
				const response = await transport.handleRequest(req)
				return addCorsHeaders(response)
			}

			return Response.json(
				{ error: `Not found: ${url.pathname}` },
				{ status: 404, headers: CORS_HEADERS },
			)
		},
	})

	console.log(
		`[MCP] Browser MCP server listening on http://${HOST}:${MCP_PORT}`,
	)
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

	console.log('[MCP] Browser MCP server stopped')
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
