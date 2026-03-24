import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BrowserWindow } from 'electrobun/bun'
import { registerBrowserTools } from './browser'
import { registerDataTools } from './data'
import { registerTabTools } from './tabs'
import { registerWalletTools } from './wallet'

export function registerAllMcpTools(
	server: McpServer,
	getMainWindow: () => BrowserWindow,
): void {
	registerBrowserTools(server, getMainWindow)
	registerTabTools(server, getMainWindow)
	registerDataTools(server)
	registerWalletTools(server)
}
