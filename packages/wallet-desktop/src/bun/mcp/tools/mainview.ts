import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BrowserWindow } from 'electrobun/bun'
import { z } from 'zod'

// biome-ignore lint/suspicious/noExplicitAny: Electrobun type gap
type RpcRequests = any

function getRpc(getMainWindow: () => BrowserWindow): RpcRequests {
	const win = getMainWindow()
	const rpc = (win.webview as { rpc?: { request?: unknown } }).rpc
	if (!rpc?.request) throw new Error('RPC not available on main window')
	return rpc.request
}

export function registerMainviewTools(
	server: McpServer,
	getMainWindow: () => BrowserWindow,
): void {
	server.tool(
		'mainview_eval',
		'Execute JavaScript in the main wallet WebView and return the result. The code is wrapped in a function; use `return` for the result.',
		{
			code: z
				.string()
				.describe(
					'JavaScript code to execute. Use `return` to send a value back.',
				),
		},
		async ({ code }) => {
			try {
				const req = getRpc(getMainWindow)
				const { result, error } = await req.mainviewEval({ code })
				if (error) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${error}` }],
						isError: true,
					}
				}
				return { content: [{ type: 'text' as const, text: result }] }
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)

	server.tool(
		'mainview_url',
		'Get the current URL loaded in the main WebView.',
		{},
		async () => {
			try {
				const req = getRpc(getMainWindow)
				const { url } = await req.mainviewGetUrl()
				return { content: [{ type: 'text' as const, text: url }] }
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)
}
