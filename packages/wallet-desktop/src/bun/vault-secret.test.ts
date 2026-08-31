import { describe, expect, test } from 'bun:test'
import { protectRootKeyOnce } from './vault-secret'

const base = {
	accountId: '0123abcd',
	identityKey: 'wallet-identity',
	label: '1sat-wallet-0123abcd-dev',
	rootIdentityKey: 'root-identity',
	rootKeyHex: 'secret-root',
}

describe('desktop root-key vault protection', () => {
	test('an identical protected key is idempotent and never rotates its label', async () => {
		let protects = 0
		await protectRootKeyOnce({
			...base,
			existing: {
				label: base.label,
				metadata: {
					accountId: base.accountId,
					identityKey: base.identityKey,
					rootIdentityKey: base.rootIdentityKey,
				},
			},
			unlock: async () => ({ plaintext: base.rootKeyHex }),
			protect: async () => {
				protects++
			},
		})

		expect(protects).toBe(0)
	})

	test('an occupied label rejects a different root key', async () => {
		let protects = 0
		await expect(
			protectRootKeyOnce({
				...base,
				existing: { label: base.label },
				unlock: async () => ({ plaintext: 'different-root' }),
				protect: async () => {
					protects++
				},
			}),
		).rejects.toThrow('different root key')
		expect(protects).toBe(0)
	})

	test('a multi-identity account requires matching relationship metadata', async () => {
		await expect(
			protectRootKeyOnce({
				...base,
				existing: { label: base.label },
				unlock: async () => ({ plaintext: base.rootKeyHex }),
				protect: async () => {},
			}),
		).rejects.toThrow('missing its identity relationship')

		await expect(
			protectRootKeyOnce({
				...base,
				existing: {
					label: base.label,
					metadata: {
						accountId: base.accountId,
						identityKey: 'other-identity',
						rootIdentityKey: base.rootIdentityKey,
					},
				},
				unlock: async () => ({ plaintext: base.rootKeyHex }),
				protect: async () => {},
			}),
		).rejects.toThrow('metadata does not match')
	})

	test('a missing label is protected once with complete relationship metadata', async () => {
		const calls: unknown[][] = []
		await protectRootKeyOnce({
			...base,
			unlock: async () => ({ plaintext: '' }),
			protect: async (...args) => {
				calls.push(args)
			},
		})

		expect(calls).toEqual([
			[
				base.label,
				base.rootKeyHex,
				{
					accountId: base.accountId,
					identityKey: base.identityKey,
					rootIdentityKey: base.rootIdentityKey,
				},
			],
		])
	})
})
