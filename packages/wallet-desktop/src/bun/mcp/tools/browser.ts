import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
	closeWindow,
	executeJs,
	getPageText,
	goBack,
	goForward,
	listWindows,
	navigate,
	openWindow,
} from '../browser-pool'

export function registerBrowserTools(server: McpServer): void {
	server.tool(
		'browser_open',
		'Open a URL in a new browser window. Supports https://, 1sat://, ordfs://, and bare outpoints.',
		{
			url: z.string().describe('URL, 1sat:// address, or outpoint to open'),
			title: z.string().optional().describe('Window title'),
		},
		async ({ url, title }) => {
			const id = openWindow(url, title)
			return {
				content: [{ type: 'text', text: JSON.stringify({ windowId: id }) }],
			}
		},
	)

	server.tool(
		'browser_close',
		'Close a browser window by ID.',
		{ windowId: z.string().describe('Window ID from browser_open or browser_list_windows') },
		async ({ windowId }) => {
			const closed = closeWindow(windowId)
			if (!closed)
				return {
					content: [{ type: 'text', text: 'Window not found' }],
					isError: true,
				}
			return { content: [{ type: 'text', text: 'Window closed' }] }
		},
	)

	server.tool(
		'browser_list_windows',
		'List all open MCP-managed browser windows with their IDs, URLs, and titles.',
		{},
		async () => {
			const wins = listWindows()
			return {
				content: [{ type: 'text', text: JSON.stringify(wins, null, 2) }],
			}
		},
	)

	server.tool(
		'browser_navigate',
		'Navigate an existing browser window to a new URL.',
		{ windowId: z.string().describe('Window ID from browser_open or browser_list_windows'), url: z.string() },
		async ({ windowId, url }) => {
			const ok = navigate(windowId, url)
			if (!ok)
				return {
					content: [{ type: 'text', text: 'Window not found' }],
					isError: true,
				}
			return {
				content: [{ type: 'text', text: `Navigated to ${url}` }],
			}
		},
	)

	server.tool(
		'browser_go_back',
		'Navigate back in browser history.',
		{ windowId: z.string().describe('Window ID from browser_open or browser_list_windows') },
		async ({ windowId }) => {
			const ok = goBack(windowId)
			if (!ok)
				return {
					content: [{ type: 'text', text: 'Window not found' }],
					isError: true,
				}
			return { content: [{ type: 'text', text: 'Navigated back' }] }
		},
	)

	server.tool(
		'browser_go_forward',
		'Navigate forward in browser history.',
		{ windowId: z.string().describe('Window ID from browser_open or browser_list_windows') },
		async ({ windowId }) => {
			const ok = goForward(windowId)
			if (!ok)
				return {
					content: [{ type: 'text', text: 'Window not found' }],
					isError: true,
				}
			return { content: [{ type: 'text', text: 'Navigated forward' }] }
		},
	)

	server.tool(
		'browser_execute_js',
		'Execute JavaScript in a browser window and return the result. The code is wrapped in a function; use `return` for the result.',
		{
			windowId: z.string().describe('Window ID from browser_open or browser_list_windows'),
			code: z
				.string()
				.describe(
					'JavaScript code to execute. Use `return` to send a value back.',
				),
			timeoutMs: z.number().optional().describe('Timeout in ms (default 10000)'),
		},
		async ({ windowId, code, timeoutMs }) => {
			try {
				const result = await executeJs(windowId, code, timeoutMs)
				return { content: [{ type: 'text', text: result }] }
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
		'browser_get_page_text',
		'Get the visible text content of a page in a browser window.',
		{ windowId: z.string().describe('Window ID from browser_open or browser_list_windows') },
		async ({ windowId }) => {
			try {
				const text = await getPageText(windowId)
				return { content: [{ type: 'text', text }] }
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
