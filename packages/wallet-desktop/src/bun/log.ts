/**
 * evlog initialization for wallet-desktop.
 *
 * Events go to three destinations:
 * 1. Console (pretty in dev, JSON in prod)
 * 2. File (~/.1sat-wallet/logs/*.jsonl) — NDJSON with date rotation, survives crashes
 * 3. MCP ring buffer — queryable via wallet_logs tool
 *
 * All modules import createLogger/createRequestLogger from evlog directly.
 * The drain callback handles routing — no wrapper needed.
 */
import { initLogger } from 'evlog'
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
	env: {
		service: '1sat-wallet',
	},
	drain: (ctx) => {
		// Ring buffer: synchronous, for MCP wallet_logs tool
		pushLogEvent({
			timestamp: new Date().toISOString(),
			context: (ctx.event as Record<string, unknown>).context as string ?? 'app',
			event: (ctx.event as Record<string, unknown>).event as string ?? 'unknown',
			...(ctx.event as Record<string, unknown>),
		})
		// File: async, batched via pipeline
		fsDrain(ctx)
	},
})

// Emit immediately so the file drain creates the log file on startup
import { createLogger } from 'evlog'
const bootLog = createLogger({ context: 'boot' })
bootLog.set({ event: 'process_alive', pid: process.pid, argv0: process.argv0 })
bootLog.emit()
// Force immediate flush so the log file exists even if the process crashes next
fsDrain.flush()

/** Call on app shutdown to flush buffered events to disk */
export async function flushLogs(): Promise<void> {
	await fsDrain.flush()
}
