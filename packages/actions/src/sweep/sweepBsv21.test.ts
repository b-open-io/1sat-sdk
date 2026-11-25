import { describe, expect, test } from 'bun:test'
import type { Bsv21OutputState } from '@1sat/types'
import { PrivateKey } from '@bsv/sdk'
import type { OneSatContext } from '../types.js'
import { sweepBsv21 } from './index.js'

const TOKEN_ID = `${'a'.repeat(64)}_0`
const key = PrivateKey.fromHex('01'.repeat(32))

const inputs = [1, 2].map((n) => ({
	outpoint: `${n.toString(16).padStart(64, '0')}_0`,
	satoshis: 1,
	lockingScript: '51',
	tokenId: TOKEN_ID,
	amount: '5',
}))

function context(statuses: () => Promise<Bsv21OutputState[]>) {
	return {
		wallet: {},
		chain: 'main',
		services: {
			bsv21: {
				getTokenDetails: async () => ({
					token: { id: TOKEN_ID },
					status: { is_active: false, fee_address: '', fee_per_output: 0 },
				}),
				getOutputStatus: async (_tokenId: string, outpoints: string[]) => {
					const states = await statuses()
					return outpoints.map((outpoint, i) => ({
						outpoint,
						state: states[i],
					}))
				},
			},
		},
	} as unknown as OneSatContext
}

describe('sweepBsv21 overlay validation', () => {
	test('refuses when the overlay reports no input valid', async () => {
		const res = await sweepBsv21.execute(
			context(async () => ['queued', 'unknown']),
			{ inputs, keys: [key, key] },
		)
		expect(res.error).toBe('unvalidated-inputs')
	})

	test('refuses when the overlay cannot be reached', async () => {
		const res = await sweepBsv21.execute(
			context(async () => {
				throw new Error('overlay down')
			}),
			{ inputs, keys: [key, key] },
		)
		expect(res.error).toBe('overlay-validation-failed')
	})
})
