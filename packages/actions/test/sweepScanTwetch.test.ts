import { describe, expect, it } from 'bun:test'
import type { OneSatServices } from '@1sat/client'
import type { IndexedOutput } from '@1sat/types'
import { scanAddress } from '../src/sweep/scan'

function servicesReturning(
	outputs: IndexedOutput[],
	keys: (string | string[])[] = [],
): OneSatServices {
	return {
		owner: {
			async *getTxos() {
				yield { type: 'done' }
			},
		},
		txo: {
			search: async (k: string | string[]) => {
				keys.push(k)
				return outputs
			},
		},
	} as unknown as OneSatServices
}

describe('sweep scan', () => {
	it('keeps Twetch NFTs out of funding', async () => {
		const twonk = {
			outpoint: `${'aa'.repeat(32)}_14`,
			satoshis: 2180,
			events: ['twetch'],
		} as IndexedOutput

		const keys: (string | string[])[] = []
		const result = await scanAddress(
			servicesReturning([twonk], keys),
			'15VTjKdVM7Cji1RJBeZ8BcQMtyS8GDHE1D',
		)

		// Twonks are listed under their own key, so the scan must ask for it.
		expect(keys).toEqual([
			[
				'own:15VTjKdVM7Cji1RJBeZ8BcQMtyS8GDHE1D',
				'twetch:15VTjKdVM7Cji1RJBeZ8BcQMtyS8GDHE1D',
			],
		])

		expect(result.twetch).toEqual([twonk])
		expect(result.funding).toEqual([])
		expect(result.totalFundingSats).toBe(0)
	})
})
