import { describe, expect, test } from 'bun:test'
import { createBRC100Router, defaultParseOrigin } from './router.js'

const req = (headers: Record<string, string>) =>
	new Request('http://127.0.0.1:3321/getPublicKey', {
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
})
