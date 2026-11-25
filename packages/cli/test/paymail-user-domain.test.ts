import { describe, expect, test } from 'bun:test'
import { resolvePaymailUserDomain } from '../src/config'

describe('resolvePaymailUserDomain', () => {
	test('an explicit userDomain wins', () => {
		expect(
			resolvePaymailUserDomain({
				userDomain: ' 1Sat.App ',
				baseUrl: 'https://other.example',
			}),
		).toEqual({ domain: '1sat.app', source: 'userDomain' })
	})

	test('defaults to the host of an https baseUrl', () => {
		expect(resolvePaymailUserDomain({ baseUrl: 'https://1sat.app' })).toEqual({
			domain: '1sat.app',
			source: 'baseUrl',
		})
		expect(
			resolvePaymailUserDomain({ baseUrl: 'https://1sat.app:443/x/' }),
		).toEqual({ domain: '1sat.app', source: 'baseUrl' })
	})

	test('no domain from a local, plain-http, or missing baseUrl', () => {
		expect(resolvePaymailUserDomain(undefined)).toBeUndefined()
		expect(resolvePaymailUserDomain({})).toBeUndefined()
		expect(
			resolvePaymailUserDomain({ baseUrl: 'http://1sat.app' }),
		).toBeUndefined()
		expect(
			resolvePaymailUserDomain({ baseUrl: 'https://localhost:8100' }),
		).toBeUndefined()
		expect(
			resolvePaymailUserDomain({ baseUrl: 'https://127.0.0.1' }),
		).toBeUndefined()
		expect(resolvePaymailUserDomain({ baseUrl: 'not a url' })).toBeUndefined()
	})
})

describe('resolvePaymailUserDomain trailing dot', () => {
	test('a fully qualified name loses its trailing dot', () => {
		expect(resolvePaymailUserDomain({ baseUrl: 'https://1sat.app./' })).toEqual(
			{ domain: '1sat.app', source: 'baseUrl' },
		)
		expect(resolvePaymailUserDomain({ userDomain: '1sat.app.' })).toEqual({
			domain: '1sat.app',
			source: 'userDomain',
		})
	})
})
