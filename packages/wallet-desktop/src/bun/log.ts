/**
 * evlog initialization for wallet-desktop.
 *
 * Every evlog event goes to four destinations via the drain:
 * 1. File (~/.1sat-wallet/logs/*.jsonl) — NDJSON, date-rotated, 7-day retention
 * 2. MCP ring buffer — queryable via wallet_logs tool (last 500 events)
 * 3. Sync terminal — piped to webview via syncEvent RPC for live display
 * 4. Console — evlog's built-in pretty/JSON output
 *
 * All bun-side modules use createLogger/createRequestLogger from evlog.
 * This file is imported as a side effect in index.ts before anything else.
 */
import { createLogger, initLogger } from 'evlog'
import { createFsDrain } from 'evlog/fs'
import { createDrainPipeline } from 'evlog/pipeline'
import type { SyncEvent } from '../shared/types'
import { pushLogEvent } from './mcp/tools/logs'

const LOG_DIR = `${process.env.HOME}/.1sat-wallet/logs`

const pipeline = createDrainPipeline({
	batch: { size: 25, intervalMs: 2000 },
})

const fsDrain = pipeline(createFsDrain({
	dir: LOG_DIR,
	maxFiles: 7,
	pretty: false,
}))

// Mutable callback — set after wallet-manager wires up the sync terminal.
// This breaks the import-order chicken-and-egg: log.ts loads before wallet-manager,
// but the callback gets set once the webview is ready.
let syncCallback: ((event: SyncEvent) => void) | undefined

export function setSyncDrainCallback(cb: (event: SyncEvent) => void): void {
	syncCallback = cb
}

function formatSyncMessage(ctx: Record<string, unknown>): string {
	const event = ctx.event as string ?? ''
	const context = ctx.context as string ?? ''
	const method = ctx.method as string ?? ''
	const route = ctx.route as string ?? ''
	const status = ctx.status as number | undefined
	const duration = ctx.duration as string ?? ''
	const error = ctx.error as string ?? ''

	// Build a readable one-line message from the evlog fields
	const parts: string[] = []
	if (context) parts.push(`[${context}]`)
	if (event && event !== 'unknown') parts.push(event)
	if (method && route) parts.push(`${method} ${route}`)
	if (status) parts.push(`${status}`)
	if (duration) parts.push(duration)
	if (error) parts.push(`error: ${error}`)

	return parts.join(' ') || 'event'
}

function evlogLevelToSync(ctx: Record<string, unknown>): SyncEvent['level'] {
	const error = ctx.error as string | undefined
	const status = ctx.status as number | undefined
	if (error) return 'error'
	if (status && status >= 400) return 'warning'
	return 'log'
}

initLogger({
	env: { service: '1sat-wallet' },
	drain: (ctx) => {
		const flat = ctx.event as Record<string, unknown>

		// 1. MCP ring buffer
		pushLogEvent({
			timestamp: new Date().toISOString(),
			context: flat.context as string ?? 'app',
			event: flat.event as string ?? 'unknown',
			...flat,
		})

		// 2. File drain
		fsDrain(ctx)

		// 3. Sync terminal (webview)
		if (syncCallback) {
			syncCallback({
				timestamp: Date.now(),
				source: flat.context as string ?? 'app',
				level: evlogLevelToSync(flat),
				message: formatSyncMessage(flat),
			})
		}
	},
})

// Capture uncaught errors as evlog events
process.on('uncaughtException', (err) => {
	const log = createLogger({ context: 'crash' })
	log.set({ event: 'uncaught_exception', error: err.message, stack: err.stack, name: err.name })
	log.emit()
	fsDrain.flush()
})

process.on('unhandledRejection', (reason) => {
	const log = createLogger({ context: 'crash' })
	log.set({
		event: 'unhandled_rejection',
		reason: reason instanceof Error ? reason.message : String(reason),
		stack: reason instanceof Error ? reason.stack : undefined,
	})
	log.emit()
	fsDrain.flush()
})

// Boot event — proves the process is alive
const bootLog = createLogger({ context: 'boot' })
bootLog.set({ event: 'process_alive', pid: process.pid, argv0: process.argv0 })
bootLog.emit()
fsDrain.flush()

/** Flush buffered events to disk — call on app shutdown */
export async function flushLogs(): Promise<void> {
	await fsDrain.flush()
}
