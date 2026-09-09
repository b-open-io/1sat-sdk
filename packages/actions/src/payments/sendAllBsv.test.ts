import { describe, expect, test } from 'bun:test'
import type { WalletInterface } from '@bsv/sdk'
import { createContext } from '../types.js'
import { sendAllBsv } from './index.js'

const DEST = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
const TXA = 'aa'.repeat(32)
const TXB = 'bb'.repeat(32)

function mockWallet(overrides: Partial<WalletInterface>): WalletInterface {
	return overrides as WalletInterface
}

describe('sendAllBsv', () => {
	test('lists default basket and createAction uses an exact amount', async () => {
		const listArgs: unknown[] = []
		const createArgs: unknown[] = []
		const wallet = mockWallet({
			listOutputs: async (args) => {
				listArgs.push(args)
				return {
					totalOutputs: 2,
					outputs: [
						{ satoshis: 1000, spendable: true, outpoint: `${TXA}.0` },
						{ satoshis: 500, spendable: true, outpoint: `${TXB}.1` },
					],
				}
			},
			createAction: async (args) => {
				createArgs.push(args)
				return { txid: 'deadbeef', tx: [1, 2, 3] }
			},
		})

		const result = await sendAllBsv.execute(createContext(wallet), {
			destination: DEST,
		})

		expect(listArgs[0]).toMatchObject({ basket: 'default' })
		expect(result.error).toBeUndefined()
		expect(result.txid).toBe('deadbeef')
		const outputs = (createArgs[0] as { outputs: Array<{ satoshis: number }> })
			.outputs
		expect(outputs).toHaveLength(1)
		expect(outputs[0].satoshis).toBeGreaterThan(0)
		expect(outputs[0].satoshis).toBeLessThan(1500)
		expect(outputs[0].satoshis).not.toBe(2099999999999999)
	})

	test('satsPerKb changes the createAction amount', async () => {
		const wallet = () => {
			const createArgs: unknown[] = []
			return {
				createArgs,
				wallet: mockWallet({
					listOutputs: async () => ({
						totalOutputs: 1,
						outputs: [
							{ satoshis: 100_000, spendable: true, outpoint: `${TXA}.0` },
						],
					}),
					createAction: async (args) => {
						createArgs.push(args)
						return { txid: 'deadbeef', tx: [1] }
					},
				}),
			}
		}
		const low = wallet()
		const high = wallet()
		await sendAllBsv.execute(createContext(low.wallet), {
			destination: DEST,
			satsPerKb: 1,
		})
		await sendAllBsv.execute(createContext(high.wallet), {
			destination: DEST,
			satsPerKb: 100,
		})
		const lowOut = (
			low.createArgs[0] as { outputs: Array<{ satoshis: number }> }
		).outputs[0].satoshis
		const highOut = (
			high.createArgs[0] as { outputs: Array<{ satoshis: number }> }
		).outputs[0].satoshis
		expect(lowOut).toBeGreaterThan(highOut)
	})

	test('surfaces default-basket admin-only errors', async () => {
		const wallet = mockWallet({
			listOutputs: async () => {
				throw new Error('Basket “default” is admin-only.')
			},
		})

		const result = await sendAllBsv.execute(createContext(wallet), {
			destination: DEST,
		})

		expect(result.txid).toBeUndefined()
		expect(result.error).toMatch(/admin-only/)
	})

	test('returns insufficient-funds when the default basket is empty', async () => {
		const wallet = mockWallet({
			listOutputs: async () => ({ totalOutputs: 0, outputs: [] }),
		})

		const result = await sendAllBsv.execute(createContext(wallet), {
			destination: DEST,
		})

		expect(result.error).toBe('insufficient-funds')
	})
})
