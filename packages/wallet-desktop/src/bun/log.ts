/**
 * evlog initialization for wallet-desktop.
 *
 * Every evlog event goes to three destinations via the drain:
 * 1. File (~/.1sat-wallet/logs/*.jsonl) — NDJSON, date-rotated, 7-day retention
 * 2. MCP ring buffer — queryable via wallet_logs tool (last 500 events)
 * 3. Console — evlog's built-in pretty/JSON output
 *
 * All bun-side modules use createLogger/createRequestLogger from evlog.
 * This file is imported as a side effect in index.ts before anything else.
 */
import { createLogger, initLogger } from 'evlog'
import { createFsDrain } from 'evlog/fs'
import { createDrainPipeline } from 'evlog/pipeline'
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

initLogger({
	env: { service: '1sat-wallet' },
	drain: (ctx) => {
		pushLogEvent({
			timestamp: new Date().toISOString(),
			context: (ctx.event as Record<string, unknown>).context as string ?? 'app',
			event: (ctx.event as Record<string, unknown>).event as string ?? 'unknown',
			...(ctx.event as Record<string, unknown>),
		})
		fsDrain(ctx)
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
