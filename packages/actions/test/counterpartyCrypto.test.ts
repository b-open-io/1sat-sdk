import { describe, expect, test } from 'bun:test'
import {
	decryptFromCounterparty,
	encryptForCounterparty,
} from '../src/signing/counterpartyCrypto'
import { createTestContext } from './setup'

describe('counterparty crypto', () => {
	test('encrypt then decrypt roundtrip with self as counterparty', async () => {
		const { ctx } = await createTestContext('primary')
		const plaintext = 'hello, world'
		const plaintextBytes = Array.from(new TextEncoder().encode(plaintext))

		const encrypted = await encryptForCounterparty.execute(ctx, {
			plaintext: plaintextBytes,
			protocolID: [2, 'messaging'],
			keyID: 'dm-0',
			counterparty: 'self',
		})
		expect(encrypted.error).toBeUndefined()
		expect(encrypted.ciphertext).toBeDefined()
		expect(encrypted.ciphertext).not.toEqual(plaintextBytes)

		const decrypted = await decryptFromCounterparty.execute(ctx, {
			ciphertext: encrypted.ciphertext!,
			protocolID: [2, 'messaging'],
			keyID: 'dm-0',
			counterparty: 'self',
		})
		expect(decrypted.error).toBeUndefined()
		expect(decrypted.plaintext).toEqual(plaintextBytes)
	})
})
