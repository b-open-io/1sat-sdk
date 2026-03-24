/**
 * Logging wrapper — feeds evlog events to:
 * 1. evlog (stdout/adapters)
 * 2. MCP ring buffer (wallet_logs tool)
 * 3. File (~/.1sat-wallet/app.log) — survives crashes, readable from installed app
 *
 * Use `createLog` and `createReqLog` instead of importing directly from evlog.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { createLogger, createRequestLogger, type Log, type RequestLogger } from 'evlog'
import { pushLogEvent, type LogEntry } from './mcp/tools/logs'

const LOG_DIR = `${process.env.HOME}/.1sat-wallet`
const LOG_PATH = `${LOG_DIR}/app.log`

// Ensure log directory exists on module load
try {
	mkdirSync(LOG_DIR, { recursive: true })
} catch {}

function writeToFile(entry: LogEntry): void {
	try {
		appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`)
	} catch {}
}

interface ProxiedLog extends Log {
	emit(): void
}

export function createLog(config: { context: string }): ProxiedLog {
	const inner = createLogger(config)
	const fields: Record<string, unknown> = { context: config.context }

	return {
		...inner,
		set(data: Record<string, unknown>) {
			Object.assign(fields, data)
			inner.set(data)
			return this
		},
		emit() {
			const entry: LogEntry = {
				timestamp: new Date().toISOString(),
				context: config.context,
				event: (fields.event as string) ?? 'unknown',
				...fields,
			}
			pushLogEvent(entry)
			writeToFile(entry)
			inner.emit()
		},
	} as ProxiedLog
}

export function createReqLog(req: Request): RequestLogger {
	const inner = createRequestLogger(req)
	const fields: Record<string, unknown> = {}

	return new Proxy(inner, {
		get(target, prop) {
			if (prop === 'set') {
				return (data: Record<string, unknown>) => {
					Object.assign(fields, data)
					target.set(data)
					return inner
				}
			}
			if (prop === 'emit') {
				return () => {
					const entry: LogEntry = {
						timestamp: new Date().toISOString(),
						context: (fields.route as string) ?? 'request',
						event: (fields.event as string) ?? (fields.type as string) ?? 'request',
						...fields,
					}
					pushLogEvent(entry)
					writeToFile(entry)
					target.emit()
				}
			}
			return (target as unknown as Record<string, unknown>)[prop as string]
		},
	})
}
