import { describe, expect, test } from 'bun:test'
import express from 'express'
import { mountTerminalErrorHandler } from '../src/errorHandler'

describe('mountTerminalErrorHandler', () => {
	test('turns thrown route errors into logged JSON 500s', async () => {
		const app = express()
		app.get('/boom', () => {
			throw new Error('kaboom')
		})
		mountTerminalErrorHandler(app)

		const server = app.listen(0)
		const port = (server.address() as { port: number }).port
		try {
			const res = await fetch(`http://127.0.0.1:${port}/boom`)
			expect(res.status).toBe(500)
			expect(res.headers.get('content-type')).toContain('application/json')
			const body = (await res.json()) as { status: string; description: string }
			expect(body.status).toBe('error')
			expect(body.description).toBe('kaboom')
		} finally {
			server.close()
		}
	})

	test('respects an error status code when present', async () => {
		const app = express()
		app.get('/gone', (_req, _res, next) => {
			const err = new Error('not here') as Error & { statusCode: number }
			err.statusCode = 410
			next(err)
		})
		mountTerminalErrorHandler(app)

		const server = app.listen(0)
		const port = (server.address() as { port: number }).port
		try {
			const res = await fetch(`http://127.0.0.1:${port}/gone`)
			expect(res.status).toBe(410)
			const body = (await res.json()) as { description: string }
			expect(body.description).toBe('not here')
		} finally {
			server.close()
		}
	})
})
