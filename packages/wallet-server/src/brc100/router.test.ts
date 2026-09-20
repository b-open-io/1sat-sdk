import { describe, expect, test } from 'bun:test'
import { createBRC100Router, defaultParseOrigin } from './router.js'

const req = (headers: Record<string, string>, path = '/getPublicKey') =>
	new Request(`http://127.0.0.1:3321${path}`, {
		method: 'POST',
		headers,
		body: '{}',
	})

describe('defaultParseOrigin', () => {
	test('uses the host of a URL Origin', () => {
		expect(defaultParseOrigin(req({ Origin: 'https://bitplan.dev' }))).toBe(
			'bitplan.dev',
		)
		expect(defaultParseOrigin(req({ Origin: 'http://gib' }))).toBe('gib')
	})

	test('keeps a bare Origin value', () => {
		expect(defaultParseOrigin(req({ Origin: 'gib' }))).toBe('gib')
	})

	test('ignores Originator and X-1Sat-Origin', () => {
		expect(
			defaultParseOrigin(
				req({ Originator: 'evil.example', 'X-1Sat-Origin': '1sat://abc_0' }),
			),
		).toBe('')
		expect(
			defaultParseOrigin(
				req({ Origin: 'https://app.example', 'X-1Sat-Origin': '1sat://abc_0' }),
			),
		).toBe('app.example')
	})

	test('treats a missing or null Origin as no origin', () => {
		expect(defaultParseOrigin(req({}))).toBe('')
		expect(defaultParseOrigin(req({ Origin: 'null' }))).toBe('')
	})
})

describe('createBRC100Router', () => {
	const calls: Array<{ method: string; origin: string }> = []
	const handler = createBRC100Router({
		wallet: {
			async call(method, _args, origin) {
				calls.push({ method, origin })
				return { publicKey: '02aa' }
			},
		},
	})

	test('rejects a request with no Origin', async () => {
		const res = await handler(req({ Originator: 'gib' }))
		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({ error: 'Origin header required' })
		expect(calls).toHaveLength(0)
	})

	test('passes the Origin host to the wallet', async () => {
		const res = await handler(req({ Origin: 'http://gib' }))
		expect(res.status).toBe(200)
		expect(calls).toEqual([{ method: 'getPublicKey', origin: 'gib' }])
	})

	test('dispatches every method straight to the wallet', async () => {
		calls.length = 0
		for (const method of ['createAction', 'decrypt', 'createSignature']) {
			const res = await handler(req({ Origin: 'http://gib' }, `/${method}`))
			expect(res.status).toBe(200)
		}
		expect(calls.map((c) => c.method)).toEqual([
			'createAction',
			'decrypt',
			'createSignature',
		])
	})
})

describe('createBRC100Router adminOriginator', () => {
	const calls: string[] = []
	const events: Array<Record<string, unknown>> = []
	const handler = createBRC100Router({
		adminOriginator: '1sat-cli.internal',
		wallet: {
			async call(_method, _args, origin) {
				calls.push(origin)
				return {}
			},
		},
		onEvent: (e) => events.push(e),
	})

	test('rejects the admin originator in every spelling', async () => {
		for (const origin of [
			'http://1sat-cli.internal',
			'https://1SAT-CLI.internal',
			'http://1sat-cli.internal:80',
			'https://1sat-cli.internal:443',
			'1sat-cli.internal',
		]) {
			const res = await handler(req({ Origin: origin }))
			expect(res.status).toBe(400)
			expect(await res.json()).toEqual({
				error: 'Origin is reserved for the wallet itself',
			})
		}
		expect(calls).toHaveLength(0)
		expect(events.every((e) => e.status === 400)).toBe(true)
	})

	test('lets other origins through', async () => {
		const res = await handler(req({ Origin: 'http://1sat-cli.internal:8080' }))
		expect(res.status).toBe(200)
		expect(calls).toEqual(['1sat-cli.internal:8080'])
	})
})

describe('createBRC100Router wallet errors', () => {
	test('relays a permission denial as 400 and logs it', async () => {
		const events: Array<Record<string, unknown>> = []
		const handler = createBRC100Router({
			wallet: {
				async call() {
					const err = new Error('Permission denied.') as Error & {
						code?: string
					}
					err.code = 'ERR_PERMISSION_DENIED'
					throw err
				},
			},
			onEvent: (e) => events.push(e),
		})
		const res = await handler(req({ Origin: 'http://gib' }, '/createAction'))
		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({ error: 'Permission denied.' })
		expect(events).toEqual([
			{
				event: 'brc100_call',
				method: 'createAction',
				origin: 'gib',
				status: 400,
				error: 'Permission denied.',
				code: 'ERR_PERMISSION_DENIED',
			},
		])
	})

	test('returns 503 while the wallet is not ready', async () => {
		const handler = createBRC100Router({
			wallet: {
				async call() {
					return {}
				},
				isReady: () => false,
			},
		})
		const res = await handler(req({ Origin: 'http://gib' }))
		expect(res.status).toBe(503)
	})
})

describe('createBRC100Router plumbing', () => {
	const handler = createBRC100Router({
		wallet: {
			async call() {
				return {}
			},
		},
		manifest: { name: 'cli' },
		baseHeaders: { 'Access-Control-Allow-Origin': '*' },
	})

	test('serves the manifest', async () => {
		const res = await handler(
			new Request('http://127.0.0.1:3321/manifest.json'),
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ name: 'cli' })
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
	})

	test('answers preflight', async () => {
		const res = await handler(
			new Request('http://127.0.0.1:3321/createAction', { method: 'OPTIONS' }),
		)
		expect(res.status).toBe(204)
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
	})

	test('404s unknown endpoints', async () => {
		const res = await handler(req({ Origin: 'http://gib' }, '/notAMethod'))
		expect(res.status).toBe(404)
	})
})
