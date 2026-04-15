import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
/**
 * Tab MCP tools — interact with tabs in the main browser view.
 *
 * These tools call mainWindow.webview.rpc.request.tab*() which routes
 * through Electrobun RPC to the React BrowserView component.
 */
import type { BrowserWindow } from 'electrobun/bun'
import { z } from 'zod'

// Electrobun's BrowserView RPC type is incomplete — cast to access
// the request methods that are defined in our WalletDesktopRPC schema.
// biome-ignore lint/suspicious/noExplicitAny: Electrobun type gap
type RpcRequests = any

function getRpc(getMainWindow: () => BrowserWindow): RpcRequests {
	const win = getMainWindow()
	const rpc = (win.webview as { rpc?: { request?: unknown } }).rpc
	if (!rpc?.request) throw new Error('RPC not available on main window')
	return rpc.request
}

export function registerTabTools(
	server: McpServer,
	getMainWindow: () => BrowserWindow,
): void {
	server.tool(
		'tab_list',
		'List all open browser tabs in the main window with their IDs, URLs, and titles.',
		{},
		async () => {
			try {
				const req = getRpc(getMainWindow)
				const result = await req.tabList()
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(result.tabs, null, 2),
						},
					],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)

	server.tool(
		'tab_create',
		'Create a new browser tab. Supports https://, 1sat://, ordfs://, and bare outpoints.',
		{
			url: z
				.string()
				.optional()
				.describe('URL to open. If omitted, opens a new empty tab.'),
		},
		async ({ url }) => {
			try {
				const req = getRpc(getMainWindow)
				const result = await req.tabCreate({ url })
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ tabId: result.tabId }),
						},
					],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)

	server.tool(
		'tab_close',
		'Close a browser tab by ID.',
		{ tabId: z.string().describe('Tab ID from tab_list or tab_create') },
		async ({ tabId }) => {
			try {
				const req = getRpc(getMainWindow)
				const result = await req.tabClose({ tabId })
				if (!result.success)
					return {
						content: [{ type: 'text', text: 'Tab not found' }],
						isError: true,
					}
				return { content: [{ type: 'text', text: 'Tab closed' }] }
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)

	server.tool(
		'tab_navigate',
		'Navigate an existing browser tab to a new URL.',
		{
			tabId: z.string().describe('Tab ID from tab_list or tab_create'),
			url: z.string(),
		},
		async ({ tabId, url }) => {
			try {
				const req = getRpc(getMainWindow)
				const result = await req.tabNavigate({ tabId, url })
				if (!result.success)
					return {
						content: [{ type: 'text', text: 'Tab not found' }],
						isError: true,
					}
				return {
					content: [{ type: 'text', text: `Navigated tab to ${url}` }],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)

	server.tool(
		'tab_activate',
		'Switch to a browser tab by ID (makes it the active/visible tab).',
		{ tabId: z.string().describe('Tab ID from tab_list or tab_create') },
		async ({ tabId }) => {
			try {
				const req = getRpc(getMainWindow)
				const result = await req.tabActivate({ tabId })
				if (!result.success)
					return {
						content: [{ type: 'text', text: 'Tab not found' }],
						isError: true,
					}
				return { content: [{ type: 'text', text: 'Tab activated' }] }
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)

	server.tool(
		'tab_go_back',
		"Navigate back in a tab's browser history.",
		{ tabId: z.string().describe('Tab ID from tab_list or tab_create') },
		async ({ tabId }) => {
			try {
				const req = getRpc(getMainWindow)
				const result = await req.tabGoBack({ tabId })
				if (!result.success)
					return {
						content: [{ type: 'text', text: 'Tab not found' }],
						isError: true,
					}
				return { content: [{ type: 'text', text: 'Navigated back' }] }
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)

	server.tool(
		'tab_reload',
		'Reload a browser tab.',
		{ tabId: z.string().describe('Tab ID from tab_list or tab_create') },
		async ({ tabId }) => {
			try {
				const req = getRpc(getMainWindow)
				const result = await req.tabReload({ tabId })
				if (!result.success)
					return {
						content: [{ type: 'text', text: 'Tab not found' }],
						isError: true,
					}
				return { content: [{ type: 'text', text: 'Tab reloaded' }] }
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)
}
