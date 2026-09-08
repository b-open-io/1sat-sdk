import { describe, expect, test } from 'bun:test'
import { installIfAccountMissing } from './account-install'

describe('desktop duplicate account installation', () => {
	test('a closed duplicate does not open a wallet', async () => {
		let opens = 0
		const result = await installIfAccountMissing({
			existing: { identityKey: 'identity' },
			identityKey: 'identity',
			install: async () => {
				opens++
				return 'opened'
			},
		})

		expect(result.alreadyExists).toBe(true)
		expect(opens).toBe(0)
	})

	test('a running duplicate does not replace callbacks', async () => {
		const originalCallbacks = { owner: 'original window' }
		let runningCallbacks = originalCallbacks
		const result = await installIfAccountMissing({
			existing: { identityKey: 'identity' },
			identityKey: 'identity',
			install: async () => {
				runningCallbacks = { owner: 'duplicate request' }
				return 'reconfigured'
			},
		})

		expect(result.alreadyExists).toBe(true)
		expect(runningCallbacks).toBe(originalCallbacks)
	})
})
