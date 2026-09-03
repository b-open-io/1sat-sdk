import { describe, expect, test } from 'bun:test'
import express, { Router } from 'express'
import { buildOpenApiSpec, mountOpenApiRoutes } from '../src/openapi'

const IDENTITY = '02'.padEnd(66, 'a')

describe('buildOpenApiSpec', () => {
	test('includes only enabled surfaces', () => {
		const spec = buildOpenApiSpec({
			serverIdentityKey: IDENTITY,
			surfaces: { storage: true, accounts: false, messagebox: true },
		}) as { paths: Record<string, unknown> }

		expect(spec.paths['/']).toBeDefined()
		expect(spec.paths['/storage/v1/settings']).toBeDefined()
		expect(spec.paths['/storage/v1/users']).toBeDefined()
		expect(spec.paths['/.well-known/auth']).toBeDefined()
		expect(spec.paths['/messagebox/sendMessage']).toBeDefined()
		expect(spec.paths['/account/status']).toBeUndefined()
		expect(spec.paths['/account/register']).toBeUndefined()
		// Legacy root messagebox aliases stay undocumented.
		expect(spec.paths['/sendMessage']).toBeUndefined()
	})

	test('registration surface adds the account routes', () => {
		const spec = buildOpenApiSpec({
			serverIdentityKey: IDENTITY,
			surfaces: { registration: true },
		}) as { paths: Record<string, unknown>; tags: Array<{ name: string }> }
		expect(spec.paths['/account/status']).toBeDefined()
		expect(spec.paths['/account/register']).toBeDefined()
		expect(spec.paths['/account/profile']).toBeDefined()
		expect(spec.paths['/account/payment']).toBeDefined()
		expect(spec.tags.map((t) => t.name)).toContain('account')
	})

	test('carries the server identity key', () => {
		const spec = buildOpenApiSpec({
			serverIdentityKey: IDENTITY,
			surfaces: {},
		}) as Record<string, unknown>
		expect(spec['x-server-identity-key']).toBe(IDENTITY)
	})
})

describe('mountOpenApiRoutes', () => {
	test('serves the spec and the docs page', async () => {
		const app = express()
		mountOpenApiRoutes(app, {
			serverIdentityKey: IDENTITY,
			surfaces: { storage: true },
		})
		const server = app.listen(0)
		const port = (server.address() as { port: number }).port
		try {
			const spec = await fetch(`http://127.0.0.1:${port}/openapi.json`)
			expect(spec.status).toBe(200)
			const body = (await spec.json()) as { openapi: string }
			expect(body.openapi).toBe('3.0.3')

			const docs = await fetch(`http://127.0.0.1:${port}/`)
			expect(docs.status).toBe(200)
			expect(docs.headers.get('content-type')).toContain('text/html')
			expect(await docs.text()).toContain('/openapi.json')
		} finally {
			server.close()
		}
	})
})

describe('messagebox dual mount', () => {
	test('same router answers on /messagebox and the legacy root', async () => {
		const app = express()
		const router = Router()
		router.post('/sendMessage', (_req, res) => res.json({ ok: true }))
		app.use('/messagebox', router)
		app.use(router)

		const server = app.listen(0)
		const port = (server.address() as { port: number }).port
		try {
			for (const path of ['/messagebox/sendMessage', '/sendMessage']) {
				const res = await fetch(`http://127.0.0.1:${port}${path}`, {
					method: 'POST',
				})
				expect(res.status).toBe(200)
				expect(await res.json()).toEqual({ ok: true })
			}
		} finally {
			server.close()
		}
	})
})
