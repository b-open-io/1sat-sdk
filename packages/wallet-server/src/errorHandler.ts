/**
 * Terminal Express error middleware. Without this, any `next(err)` falls
 * through to Express's default handler, which responds with an HTML 500 and
 * logs nothing in production. Mount LAST, after every route.
 */

import { createLogger } from 'evlog'
import { useLogger } from 'evlog/express'
import type { Express, NextFunction, Request, Response } from 'express'

export function mountTerminalErrorHandler(app: Express): void {
	app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
		const message = err instanceof Error ? err.message : String(err)
		const stack = err instanceof Error ? err.stack : undefined
		try {
			// Inside the evlog request context this attaches to the
			// request's wide event (method/path/requestId/status included).
			const log = useLogger()
			log.set({ event: 'http_error', error: message, stack })
		} catch {
			const log = createLogger({ context: 'wallet-server' })
			log.set({
				event: 'http_error',
				method: req.method,
				path: req.path,
				error: message,
				stack,
			})
			log.emit()
		}

		if (res.headersSent) return next(err)
		const status =
			(err as { statusCode?: number; status?: number })?.statusCode ??
			(err as { status?: number })?.status ??
			500
		res.status(status).json({
			status: 'error',
			code: 'ERR_INTERNAL',
			description: message,
		})
	})
}
