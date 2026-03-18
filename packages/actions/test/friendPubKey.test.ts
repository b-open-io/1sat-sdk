import { describe, expect, test } from 'bun:test'
import { getFriendPublicKey } from '../src/signing/friendPubKey'
import { createTestContext } from './setup'

describe('getFriendPublicKey', () => {
	test('derives public key for counterparty', async () => {
		const { ctx } = await createTestContext('primary')
		const result = await getFriendPublicKey.execute(ctx, {
			friendIdentityKey: '02' + 'ab'.repeat(32),
			protocolID: [2, 'messaging'],
			keyID: 'dm-0',
		})
		expect(result.error).toBeUndefined()
		expect(result.publicKey).toBeDefined()
		expect(result.publicKey).toMatch(/^0[23][0-9a-f]{64}$/)
	})

	test('returns different keys for different counterparties', async () => {
		const { ctx } = await createTestContext('primary')
		const r1 = await getFriendPublicKey.execute(ctx, {
			friendIdentityKey: '02' + 'ab'.repeat(32),
			protocolID: [2, 'messaging'],
			keyID: 'dm-0',
		})
		const r2 = await getFriendPublicKey.execute(ctx, {
			friendIdentityKey: '02' + 'cd'.repeat(32),
			protocolID: [2, 'messaging'],
			keyID: 'dm-0',
		})
		expect(r1.publicKey).not.toBe(r2.publicKey)
	})
})
