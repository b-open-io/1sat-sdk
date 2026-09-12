import {
	type Mock,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	spyOn,
} from 'bun:test'
import { sweepBsv, sweepOrdinals } from '@1sat/actions'
import type { IndexedOutput } from '@1sat/types'
import {
	Beef,
	P2PKH,
	PrivateKey,
	Transaction,
	type WalletInterface,
} from '@bsv/sdk'
import { configureServices, getServices } from '../src/lib/services.js'
import { executeSweep } from '../src/lib/sweeper.js'

const wallet = {} as WalletInterface
const ownerKeys = [
	PrivateKey.fromRandom(),
	PrivateKey.fromRandom(),
	PrivateKey.fromRandom(),
]
const keys = new Map(ownerKeys.map((key) => [key.toAddress(), key]))
const transactions = new Map<string, Beef>()
let ordinalSweep: Mock<typeof sweepOrdinals.execute>
let bsvSweep: Mock<typeof sweepBsv.execute>
let getBeef: Mock<ReturnType<typeof getServices>['getBeefForTxid']>
let fetchGuard: Mock<typeof fetch>

function outputs(
	count: number,
	satoshis = 1,
	owners = ownerKeys,
): IndexedOutput[] {
	const tx = new Transaction()
	for (let i = 0; i < count; i++) {
		tx.addOutput({
			satoshis,
			lockingScript: new P2PKH().lock(owners[i % owners.length].toAddress()),
		})
	}
	const txid = tx.id('hex')
	const beef = new Beef()
	beef.mergeTransaction(tx)
	transactions.set(txid, beef)
	return tx.outputs.map((_, index) => ({
		outpoint: `${txid}.${index}`,
		satoshis,
		score: 0,
		events: [`own:${owners[index % owners.length].toAddress()}`],
	}))
}

beforeEach(() => {
	transactions.clear()
	configureServices('http://127.0.0.1:1')
	fetchGuard = spyOn(globalThis, 'fetch').mockRejectedValue(
		new Error('Unexpected network request'),
	)
	getBeef = spyOn(getServices(), 'getBeefForTxid').mockImplementation(
		async (txid) => {
			const beef = transactions.get(txid)
			if (!beef) throw new Error('Unknown synthetic transaction')
			return beef
		},
	)
	ordinalSweep = spyOn(sweepOrdinals, 'execute').mockResolvedValue({
		txid: 'ordinal-tx',
	})
	bsvSweep = spyOn(sweepBsv, 'execute').mockResolvedValue({
		txid: 'funding-tx',
	})
})

afterEach(() => {
	ordinalSweep.mockRestore()
	bsvSweep.mockRestore()
	getBeef.mockRestore()
	getServices().close()
	const networkCalls = fetchGuard.mock.calls.length
	fetchGuard.mockRestore()
	expect(networkCalls).toBe(0)
})

describe('classed sweep matches CLI import order', () => {
	it('sweeps BSV before ordinals, including listed OrdLocks in the ordinal class', async () => {
		const funding = outputs(1, 1000)
		const listed = outputs(1)
		listed[0].events = [...(listed[0].events ?? []), 'ordlock']
		const ordinals = [...listed, ...outputs(26)]
		const order: string[] = []
		const progress: string[] = []
		bsvSweep.mockImplementation(async (ctx, input) => {
			expect(ctx.wallet).toBe(wallet)
			expect(input.amount).toBe(900)
			order.push('funding')
			return { txid: 'funding-tx' }
		})
		ordinalSweep.mockImplementation(async (ctx, input) => {
			expect(ctx.wallet).toBe(wallet)
			order.push(`ordinals:${input.inputs.length}`)
			return { txid: `receipt-${order.length}` }
		})

		const result = await executeSweep({
			wallet,
			keys,
			funding,
			ordinals,
			amount: 900,
			onProgress: (stage) => progress.push(stage),
		})

		expect(order).toEqual(['funding', 'ordinals:25', 'ordinals:2'])
		expect(result.bsvTxid).toBe('funding-tx')
		expect(result.sweptOutpoints).toEqual(ordinals.map((row) => row.outpoint))
		expect(result.ordinalTxids).toEqual(['receipt-2', 'receipt-3'])
		expect(result.errors).toEqual([])
		expect(progress.at(-1)).toBe('Sweep complete')
	})

	it('still sweeps ordinals after a BSV class error', async () => {
		const funding = outputs(1, 1000)
		const ordinals = outputs(1)
		bsvSweep.mockResolvedValue({ error: 'insufficient-funds' })
		const result = await executeSweep({
			wallet,
			keys,
			funding,
			ordinals,
			onProgress: () => {},
		})
		expect(result.bsvTxid).toBeUndefined()
		expect(result.errors).toEqual(['BSV: insufficient-funds'])
		expect(result.sweptOutpoints).toEqual(ordinals.map((row) => row.outpoint))
		expect(ordinalSweep).toHaveBeenCalledTimes(1)
	})

	it('stops remaining ordinal batches after a failure and keeps completed receipts', async () => {
		const ordinals = outputs(51)
		ordinalSweep
			.mockResolvedValueOnce({ txid: 'first-ordinal-tx' })
			.mockResolvedValueOnce({ error: 'Approval declined' })
		const result = await executeSweep({
			wallet,
			keys,
			funding: outputs(1, 1000),
			ordinals,
			onProgress: () => {},
		})
		expect(result.bsvTxid).toBe('funding-tx')
		expect(result.ordinalTxids).toEqual(['first-ordinal-tx'])
		expect(result.sweptOutpoints).toEqual(
			ordinals.slice(0, 25).map((row) => row.outpoint),
		)
		expect(result.errors).toEqual(['Ordinals batch 2/3: Approval declined'])
		expect(ordinalSweep).toHaveBeenCalledTimes(2)
		expect(bsvSweep).toHaveBeenCalledTimes(1)
	})

	it('does not move funding or ordinals when an owner key is missing', async () => {
		const result = await executeSweep({
			wallet,
			keys: new Map(),
			funding: outputs(1, 1000),
			ordinals: outputs(1),
			onProgress: () => {},
		})
		expect(result.errors[0]).toContain('No key for output')
		expect(result.bsvTxid).toBeUndefined()
		expect(ordinalSweep).not.toHaveBeenCalled()
		expect(bsvSweep).not.toHaveBeenCalled()
	})
})

describe('sweep receipts and owner key alignment', () => {
	for (const txid of [undefined, '', ' \t ']) {
		it(`does not report a funding sweep complete without a nonblank txid (${JSON.stringify(txid)})`, async () => {
			bsvSweep.mockResolvedValue({ txid })
			const progress: string[] = []
			const result = await executeSweep({
				wallet,
				keys,
				funding: outputs(1, 1000),
				ordinals: [],
				onProgress: (stage) => progress.push(stage),
			})
			expect(result.bsvTxid).toBeUndefined()
			expect(result.errors).toEqual(['BSV: Sweep returned no transaction ID'])
			expect(progress.at(-1)).toBe('Sweep stopped with errors')
		})

		it(`retains completed ordinal batches and stops after a missing txid (${JSON.stringify(txid)})`, async () => {
			const ordinals = outputs(51)
			ordinalSweep
				.mockResolvedValueOnce({ txid: 'first-ordinal-tx' })
				.mockResolvedValueOnce({ txid })
			const result = await executeSweep({
				wallet,
				keys,
				funding: [],
				ordinals,
				onProgress: () => {},
			})
			expect(result.ordinalTxids).toEqual(['first-ordinal-tx'])
			expect(result.sweptOutpoints).toEqual(
				ordinals.slice(0, 25).map((row) => row.outpoint),
			)
			expect(result.errors).toEqual([
				'Ordinals batch 2/3: Sweep returned no transaction ID',
			])
			expect(ordinalSweep).toHaveBeenCalledTimes(2)
		})
	}

	for (const category of ['funding', 'ordinals'] as const) {
		it(`matches each prepared ${category} input to its owner key after transaction grouping`, async () => {
			const a = outputs(2, category === 'funding' ? 1000 : 1, [
				ownerKeys[0],
				ownerKeys[2],
			])
			const b = outputs(1, category === 'funding' ? 1000 : 1, [ownerKeys[1]])
			const interleaved = [a[0], b[0], a[1]]
			const expectedOutpoints = [a[0].outpoint, a[1].outpoint, b[0].outpoint]
			const expectedKeys = [ownerKeys[0], ownerKeys[2], ownerKeys[1]]
			const action = category === 'funding' ? bsvSweep : ordinalSweep
			action.mockImplementation(async (ctx, input) => {
				expect(ctx.wallet).toBe(wallet)
				expect(input.inputs.map((row) => row.outpoint)).toEqual(
					expectedOutpoints,
				)
				expect(input.keys).toEqual(expectedKeys)
				return { txid: 'owner-aligned-tx' }
			})
			const result = await executeSweep({
				wallet,
				keys,
				funding: [],
				ordinals: [],
				[category]: interleaved,
				onProgress: () => {},
			})
			expect(result.errors).toEqual([])
			expect(action).toHaveBeenCalledTimes(1)
		})
	}
})
