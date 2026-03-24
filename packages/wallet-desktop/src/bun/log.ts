/**
 * Logging wrapper that feeds evlog events into the MCP ring buffer.
 *
 * Use `createLog` and `createReqLog` instead of importing directly from evlog.
 * Events are emitted to evlog AND pushed to the ring buffer for MCP tool access.
 */
import { createLogger, createRequestLogger, type Log, type RequestLogger } from 'evlog'
import { pushLogEvent } from './mcp/tools/logs'

interface ProxiedLog extends Log {
	emit(): void
}

/**
 * Create a logger that pushes to both evlog and the MCP ring buffer.
 */
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
			pushLogEvent({
				timestamp: new Date().toISOString(),
				context: config.context,
				event: (fields.event as string) ?? 'unknown',
				...fields,
			})
			inner.emit()
		},
	} as ProxiedLog
}

/**
 * Create a request logger that also pushes to the ring buffer.
 */
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
					pushLogEvent({
						timestamp: new Date().toISOString(),
						context: (fields.route as string) ?? 'request',
						event: (fields.event as string) ?? (fields.type as string) ?? 'request',
						...fields,
					})
					target.emit()
				}
			}
			return (target as unknown as Record<string, unknown>)[prop as string]
		},
	})
}
