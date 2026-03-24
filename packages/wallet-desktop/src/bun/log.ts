/**
 * evlog initialization for wallet-desktop.
 *
 * Maximum debuggability — ALL output goes through evlog:
 * 1. File (~/.1sat-wallet/logs/*.jsonl) — NDJSON, date-rotated, 7-day retention
 * 2. MCP ring buffer — queryable via wallet_logs tool (last 500 events)
 * 3. Console — pretty in dev, JSON in prod
 *
 * console.log/warn/error are intercepted and routed through evlog
 * so library output (dotenv, electrobun, etc.) is also captured.
 *
 * uncaughtException and unhandledRejection are captured as error events.
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

// -- Intercept console so ALL output goes through evlog --

const originalConsole = {
	log: console.log.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
	info: console.info.bind(console),
	debug: console.debug.bind(console),
}

function interceptConsole(
	level: 'log' | 'warn' | 'error' | 'info' | 'debug',
	context: string,
) {
	console[level] = (...args: unknown[]) => {
		originalConsole[level](...args)
		const log = createLogger({ context })
		log.set({
			event: `console.${level}`,
			message: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
		})
		log.emit()
	}
}

interceptConsole('log', 'console')
interceptConsole('info', 'console')
interceptConsole('warn', 'console')
interceptConsole('error', 'console')
interceptConsole('debug', 'console')

// -- Capture uncaught errors --

process.on('uncaughtException', (err) => {
	const log = createLogger({ context: 'crash' })
	log.set({
		event: 'uncaught_exception',
		error: err.message,
		stack: err.stack,
		name: err.name,
	})
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

// -- Boot event: proves the process is alive --

const bootLog = createLogger({ context: 'boot' })
bootLog.set({
	event: 'process_alive',
	pid: process.pid,
	argv0: process.argv0,
	cwd: process.cwd(),
	platform: process.platform,
	versions: { bun: process.versions.bun },
})
bootLog.emit()
fsDrain.flush()

/** Flush buffered events to disk — call on app shutdown */
export async function flushLogs(): Promise<void> {
	await fsDrain.flush()
}
