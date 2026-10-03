import { describe, expect, test } from 'bun:test'
import type { Bsv21OutputState } from '@1sat/types'
import type { CreateActionArgs, WalletInterface, WalletOutput } from '@bsv/sdk'
import type { OneSatContext } from '../types.js'
import { fundBsv21Overlay, sendBsv21 } from './index.js'

const TOKEN_ID = `${'a'.repeat(64)}_0`
const DESTINATION = '1LqLsubMQFR8i6rReaGp1rrXLhe7ZkGVtg'

function tokenOutput(n: number, amt: string): WalletOutput {
	return {
		outpoint: `${n.toString(16).padStart(64, '0')}.0`,
		satoshis: 1,
		spendable: true,
		tags: [`bsv21:${TOKEN_ID}`, `amt:${amt}`],
		customInstructions: JSON.stringify({ id: TOKEN_ID, amt, op: 'transfer' }),
	}
}

function sendContext(outputs: WalletOutput[], states: Bsv21OutputState[]) {
	return {
		wallet: {
			listOutputs: async () => ({
				outputs,
				BEEF: [],
				totalOutputs: outputs.length,
			}),
		} as Partial<WalletInterface> as WalletInterface,
		chain: 'main',
		services: {
			bsv21: {
				getTokenDetails: async () => ({
					token: { id: TOKEN_ID, sym: 'TEST', dec: 0 },
					status: { is_active: true, fee_address: '', fee_per_output: 0 },
				}),
				getOutputStatus: async (_tokenId: string, outpoints: string[]) =>
					outpoints.map((outpoint, i) => ({ outpoint, state: states[i] })),
			},
		},
	} as unknown as OneSatContext
}

describe('sendBsv21 overlay states', () => {
	test('reports tokens-queued when queued outputs would cover the amount', async () => {
		const ctx = sendContext(
			[tokenOutput(1, '1'), tokenOutput(2, '5')],
			['valid', 'queued'],
		)
		const res = await sendBsv21.execute(ctx, {
			tokenId: TOKEN_ID,
			recipients: [{ amount: '3', destination: { address: DESTINATION } }],
		})
		expect(res.error).toBe('tokens-queued')
	})

	test('never counts spent or unknown outputs toward the amount', async () => {
		const ctx = sendContext(
			[tokenOutput(1, '5'), tokenOutput(2, '5'), tokenOutput(3, '1')],
			['spent', 'unknown', 'valid'],
		)
		const res = await sendBsv21.execute(ctx, {
			tokenId: TOKEN_ID,
			recipients: [{ amount: '3', destination: { address: DESTINATION } }],
		})
		expect(res.error).toBe('insufficient-valid-tokens')
	})
})

describe('fundBsv21Overlay', () => {
	const template = {
		outputs: [
			{
				lockingScript: '76a914cc5f973def854a5a6015dc619462497473c0b02e88ac',
				satoshis: 10_010_000,
				outputDescription: 'Fund TEST overlay',
			},
		],
	}

	function fundContext(opts: {
		outputs: typeof template.outputs
		submit?: () => Promise<unknown>
	}) {
		let created: CreateActionArgs | undefined
		const submitted: { tokenId: string; beef: number[] }[] = []
		const ctx = {
			wallet: {
				createAction: async (args: CreateActionArgs) => {
					created = args
					return { txid: 'f'.repeat(64), tx: [1, 2, 3] }
				},
			} as Partial<WalletInterface> as WalletInterface,
			chain: 'main',
			services: {
				bsv21: {
					getFundingTemplate: async () => ({ outputs: opts.outputs }),
					submitFunding: async (tokenId: string, beef: number[]) => {
						submitted.push({ tokenId, beef })
						return opts.submit ? opts.submit() : { is_active: true }
					},
				},
			},
		} as unknown as OneSatContext
		return { ctx, created: () => created, submitted }
	}

	test('pays the template outputs and submits the transaction to the overlay', async () => {
		const { ctx, created, submitted } = fundContext({
			outputs: template.outputs,
		})
		const res = await fundBsv21Overlay.execute(ctx, { tokenId: TOKEN_ID })

		expect(res.error).toBeUndefined()
		expect(res.status?.is_active).toBe(true)
		expect(created()?.description).toBe('Fund TEST overlay')
		expect(created()?.outputs).toEqual([{ ...template.outputs[0], tags: [] }])
		expect(created()?.outputs?.[0].basket).toBeUndefined()
		expect(submitted).toEqual([{ tokenId: TOKEN_ID, beef: [1, 2, 3] }])
	})

	test('does not pay when the overlay needs no funding', async () => {
		const { ctx, created } = fundContext({ outputs: [] })
		const res = await fundBsv21Overlay.execute(ctx, { tokenId: TOKEN_ID })
		expect(res.error).toBe('funding-not-needed')
		expect(created()).toBeUndefined()
	})

	test('returns the txid when the payment went out but submission failed', async () => {
		const { ctx } = fundContext({
			outputs: template.outputs,
			submit: async () => {
				throw new Error('502')
			},
		})
		const res = await fundBsv21Overlay.execute(ctx, { tokenId: TOKEN_ID })
		expect(res.txid).toBe('f'.repeat(64))
		expect(res.error).toBe('funding-submit-failed')
	})
})
