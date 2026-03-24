/**
 * MCP client for the AI chat handler.
 *
 * Connects to the local MCP server on :3322 with BRC-31 authentication.
 * Provides tools for use with the AI SDK's streamText().
 */
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import {
	clearSession,
	ensureSession,
	getClientPrivateKey,
	signRequest,
} from './client-auth'

const MCP_URL = 'http://127.0.0.1:3322'

let mcpClient: MCPClient | undefined

export async function getMcpClient(): Promise<MCPClient> {
	if (mcpClient) return mcpClient

	const clientKey = getClientPrivateKey()
	const session = await ensureSession(MCP_URL, clientKey)

	// Initial handshake headers for the first request (session initialization)
	const initialHeaders = signRequest(session, 'POST', '/mcp')

	mcpClient = await createMCPClient({
		transport: {
			type: 'http',
			url: `${MCP_URL}/mcp`,
			headers: initialHeaders,
		},
	})

	return mcpClient
}

/**
 * Get MCP tools ready for use with streamText().
 * Returns an empty object if the MCP server is unavailable.
 */
export async function getMcpTools() {
	try {
		const client = await getMcpClient()
		const tools = await client.tools()
		const toolNames = Object.keys(tools)
		console.log(`[MCP Client] Got ${toolNames.length} tools: ${toolNames.slice(0, 5).join(', ')}${toolNames.length > 5 ? '...' : ''}`)
		return tools
	} catch (err) {
		console.error(
			'[MCP Client] Failed to get tools:',
			err instanceof Error ? err.message : String(err),
		)
		clearSession()
		mcpClient = undefined
		return {}
	}
}

export async function closeMcpClient(): Promise<void> {
	if (mcpClient) {
		try {
			await mcpClient.close()
		} catch {
			// Ignore close errors
		}
		mcpClient = undefined
	}
	clearSession()
}
