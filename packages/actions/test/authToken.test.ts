import { describe, expect, test } from 'bun:test'
import { getAuthToken } from '../src/signing/authToken'
import { createTestContext } from './setup'

describe('getAuthToken', () => {
	test('produces valid BRC-77 auth token', async () => {
		const { ctx } = await createTestContext('primary')
		const result = await getAuthToken.execute(ctx, {
			requestPath: '/api/v1/test',
			body: '{"hello":"world"}',
		})
		expect(result.error).toBeUndefined()
		expect(result.authToken).toBeDefined()
		const parts = result.authToken!.split('|')
		expect(parts).toHaveLength(5)
		expect(parts[1]).toBe('brc77')
		expect(parts[3]).toBe('/api/v1/test')
	})

	test('produces valid BSM auth token', async () => {
		const { ctx } = await createTestContext('primary')
		const result = await getAuthToken.execute(ctx, {
			requestPath: '/api/v1/test',
			scheme: 'bsm',
		})
		expect(result.error).toBeUndefined()
		const parts = result.authToken!.split('|')
		expect(parts[1]).toBe('bsm')
	})

	test('works without body', async () => {
		const { ctx } = await createTestContext('primary')
		const result = await getAuthToken.execute(ctx, {
			requestPath: '/api/v1/test',
		})
		expect(result.error).toBeUndefined()
		expect(result.authToken).toBeDefined()
	})
})
