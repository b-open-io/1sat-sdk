/**
 * MCP tool for querying recent application log events.
 *
 * Maintains an in-memory ring buffer of structured log entries.
 * Other modules call `pushLogEvent()` to record events.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export interface LogEntry {
	timestamp: string
	context: string
	event: string
	[key: string]: unknown
}

const MAX_ENTRIES = 500
const buffer: LogEntry[] = []

/** Record a structured log event into the ring buffer. */
export function pushLogEvent(entry: LogEntry): void {
	if (buffer.length >= MAX_ENTRIES) buffer.shift()
	buffer.push(entry)
}

export function registerLogTools(server: McpServer): void {
	server.tool(
		'wallet_logs',
		'Query recent application log events. Filter by context (startup, auth, mcp, rpc, stack, tls, shutdown) or event name. Returns newest first.',
		{
			context: z
				.string()
				.optional()
				.describe('Filter by log context (e.g. startup, auth, mcp)'),
			event: z.string().optional().describe('Filter by event name'),
			limit: z
				.number()
				.optional()
				.describe('Max entries to return (default 50)'),
		},
		async ({ context, event, limit }) => {
			const max = limit ?? 50
			let results = [...buffer].reverse()

			if (context) {
				results = results.filter((e) => e.context === context)
			}
			if (event) {
				results = results.filter((e) => e.event === event)
			}

			results = results.slice(0, max)

			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(results, null, 2),
					},
				],
			}
		},
	)
}
