import { describe, expect, test } from 'bun:test'
import { BearerAuthError, bearerResolver } from '../src/resolvers/bearer'

const PUBKEY = '03'.padEnd(66, 'a')
const OTHER_PUBKEY = '02'.padEnd(66, 'b')

function makeRequest(headers: Record<string, string>): Request {
	return new Request('http://internal/', { method: 'POST', headers })
}

describe('bearerResolver', () => {
	test('throws if token is empty at construction', () => {
		expect(() => bearerResolver({ token: '' })).toThrow(/non-empty token/)
	})

	test('resolves identity with matching bearer and X-Identity-Key', async () => {
		const resolve = bearerResolver({ token: 'secret' })
		const identity = await resolve(
			makeRequest({ authorization: 'Bearer secret', 'x-identity-key': PUBKEY }),
		)
		expect(identity).toEqual({ identityKey: PUBKEY })
	})

	test('accepts case-insensitive bearer scheme', async () => {
		const resolve = bearerResolver({ token: 'secret' })
		const identity = await resolve(
			makeRequest({ authorization: 'bearer secret', 'x-identity-key': PUBKEY }),
		)
		expect(identity.identityKey).toBe(PUBKEY)
	})

	test('throws on missing authorization header', async () => {
		const resolve = bearerResolver({ token: 'secret' })
		await expect(
			resolve(makeRequest({ 'x-identity-key': PUBKEY })),
		).rejects.toThrow(BearerAuthError)
	})

	test('throws on wrong token', async () => {
		const resolve = bearerResolver({ token: 'secret' })
		await expect(
			resolve(
				makeRequest({ authorization: 'Bearer nope', 'x-identity-key': PUBKEY }),
			),
		).rejects.toThrow(/invalid bearer token/)
	})

	test('throws on wrong scheme', async () => {
		const resolve = bearerResolver({ token: 'secret' })
		await expect(
			resolve(
				makeRequest({
					authorization: 'Basic secret',
					'x-identity-key': PUBKEY,
				}),
			),
		).rejects.toThrow(/missing bearer token/)
	})

	test('throws on missing identity header', async () => {
		const resolve = bearerResolver({ token: 'secret' })
		await expect(
			resolve(makeRequest({ authorization: 'Bearer secret' })),
		).rejects.toThrow(/missing x-identity-key/)
	})

	test('throws on malformed pubkey', async () => {
		const resolve = bearerResolver({ token: 'secret' })
		await expect(
			resolve(
				makeRequest({
					authorization: 'Bearer secret',
					'x-identity-key': 'not-a-pubkey',
				}),
			),
		).rejects.toThrow(/invalid x-identity-key/)
	})

	test('supports custom identity header name', async () => {
		const resolve = bearerResolver({ token: 'secret', identityHeader: 'X-Who' })
		const identity = await resolve(
			makeRequest({ authorization: 'Bearer secret', 'x-who': OTHER_PUBKEY }),
		)
		expect(identity.identityKey).toBe(OTHER_PUBKEY)
	})
})
