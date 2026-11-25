import { describe, expect, test } from 'bun:test'
import type { WalletInterface } from '@bsv/sdk'
import { createContext } from '../types.js'
import { sendAllBsv } from './index.js'

const DEST = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
const MAX_POSSIBLE_SATOSHIS = 2099999999999999

function mockWallet(overrides: Partial<WalletInterface>): WalletInterface {
	return overrides as WalletInterface
}

describe('sendAllBsv', () => {
	test('createAction uses the maxPossibleSatoshis sentinel', async () => {
		const createArgs: unknown[] = []
		const wallet = mockWallet({
			createAction: async (args) => {
				createArgs.push(args)
				return { txid: 'deadbeef', tx: [1, 2, 3] }
			},
		})

		const result = await sendAllBsv.execute(createContext(wallet), {
			destination: DEST,
		})

		expect(result.error).toBeUndefined()
		expect(result.txid).toBe('deadbeef')
		const outputs = (createArgs[0] as { outputs: Array<{ satoshis: number }> })
			.outputs
		expect(outputs).toHaveLength(1)
		expect(outputs[0].satoshis).toBe(MAX_POSSIBLE_SATOSHIS)
	})

	test('rejects paymail destinations', async () => {
		const result = await sendAllBsv.execute(
			createContext(mockWallet({})),
			{ destination: 'alice@example.com' },
		)
		expect(result.txid).toBeUndefined()
		expect(result.error).toMatch(/paymail/)
	})
})
