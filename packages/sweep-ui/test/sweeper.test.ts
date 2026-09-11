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

describe('listing cancellation gates the remaining sweep', () => {
	for (const failure of [
		'error',
		'throw',
		'missing txid',
		'empty txid',
		'blank txid',
	]) {
		it(`keeps completed receipts and stops all later batches/funding after ${failure}`, async () => {
			const listings = outputs(51)
			const funding = outputs(1, 1000)
			const ordinals = outputs(1)
			const progress: string[] = []
			ordinalSweep.mockResolvedValueOnce({ txid: 'cancel-first' })
			if (failure === 'throw')
				ordinalSweep.mockRejectedValueOnce(new Error('Approval declined'))
			else
				ordinalSweep.mockResolvedValueOnce(
					failure === 'error'
						? { error: 'Approval declined' }
						: failure === 'missing txid'
							? {}
							: { txid: failure === 'empty txid' ? '' : ' \t ' },
				)

			const result = await executeSweep({
				wallet,
				keys,
				listings,
				funding,
				ordinals,
				onProgress: (stage) => progress.push(stage),
			})

			expect(result.listingTxids).toEqual(['cancel-first'])
			expect(result.cancelledListings).toEqual(
				listings.slice(0, 25).map((row) => row.outpoint),
			)
			expect(result.errors).toHaveLength(1)
			expect(result.errors[0]).toContain('Listings batch 2:')
			expect(result.errors[0]).toContain(
				failure === 'error' || failure === 'throw'
					? 'Approval declined'
					: 'no transaction ID',
			)
			expect(result.bsvTxid).toBeUndefined()
			expect(result.ordinalTxids).toEqual([])
			expect(result.sweptOutpoints).toEqual([])
			expect(ordinalSweep).toHaveBeenCalledTimes(2)
			expect(
				ordinalSweep.mock.calls.map(([, input]) => input.inputs.length),
			).toEqual([25, 25])
			expect(bsvSweep).not.toHaveBeenCalled()
			expect(getBeef).toHaveBeenCalledTimes(2)
			expect(progress.at(-1)).toBe('Sweep stopped with errors')
			expect(progress).not.toContain('Sweep complete')
		})
	}

	it('retries remaining listings and moves funding only after every retry batch succeeds', async () => {
		const listings = outputs(51)
		const funding = outputs(1, 1000)
		const ordinals = outputs(1)
		ordinalSweep
			.mockResolvedValueOnce({ txid: 'cancel-first' })
			.mockResolvedValueOnce({ error: 'Retry approval' })
		const partial = await executeSweep({
			wallet,
			keys,
			listings,
			funding,
			ordinals,
			onProgress: () => {},
		})
		const completed = new Set(partial.cancelledListings)
		const remaining = listings.filter((row) => !completed.has(row.outpoint))
		const order: string[] = []
		ordinalSweep.mockImplementation(async (_, input) => {
			const isListing = remaining.some(
				(row) => row.outpoint === input.inputs[0].outpoint,
			)
			for (const inputRow of input.inputs)
				expect(completed.has(inputRow.outpoint)).toBe(false)
			order.push(isListing ? `cancel:${input.inputs.length}` : 'ordinals')
			return { txid: `retry-${order.length}` }
		})
		bsvSweep.mockImplementation(async () => {
			expect(order).toEqual(['cancel:25', 'cancel:1'])
			order.push('funding')
			return { txid: 'funding-retry' }
		})

		const retry = await executeSweep({
			wallet,
			keys,
			listings: remaining,
			funding,
			ordinals,
			onProgress: () => {},
		})

		expect(order).toEqual(['cancel:25', 'cancel:1', 'funding', 'ordinals'])
		expect(retry.errors).toEqual([])
		expect(retry.cancelledListings).toEqual(
			remaining.map((row) => row.outpoint),
		)
		expect(retry.listingTxids).toEqual(['retry-1', 'retry-2'])
		expect(retry.bsvTxid).toBe('funding-retry')
		expect(retry.sweptOutpoints).toEqual(ordinals.map((row) => row.outpoint))
	})

	it('completes every listing batch before funding and ordinary ordinal batches', async () => {
		const listings = outputs(51)
		const funding = outputs(1, 1000)
		const ordinals = outputs(26)
		const listingOutpoints = new Set(listings.map((row) => row.outpoint))
		const order: string[] = []
		const progress: string[] = []
		ordinalSweep.mockImplementation(async (ctx, input) => {
			expect(ctx.wallet).toBe(wallet)
			order.push(
				`${listingOutpoints.has(input.inputs[0].outpoint) ? 'cancel' : 'ordinals'}:${input.inputs.length}`,
			)
			return { txid: `receipt-${order.length}` }
		})
		bsvSweep.mockImplementation(async (ctx, input) => {
			expect(ctx.wallet).toBe(wallet)
			expect(input.amount).toBe(900)
			order.push('funding')
			return { txid: 'funding-tx' }
		})

		const result = await executeSweep({
			wallet,
			keys,
			listings,
			funding,
			ordinals,
			amount: 900,
			onProgress: (stage) => progress.push(stage),
		})

		expect(order).toEqual([
			'cancel:25',
			'cancel:25',
			'cancel:1',
			'funding',
			'ordinals:25',
			'ordinals:1',
		])
		expect(result.cancelledListings).toEqual(
			listings.map((row) => row.outpoint),
		)
		expect(result.listingTxids).toEqual(['receipt-1', 'receipt-2', 'receipt-3'])
		expect(result.bsvTxid).toBe('funding-tx')
		expect(result.sweptOutpoints).toEqual(ordinals.map((row) => row.outpoint))
		expect(result.ordinalTxids).toEqual(['receipt-5', 'receipt-6'])
		expect(result.errors).toEqual([])
		expect(progress.at(-1)).toBe('Sweep complete')
	})

	it('allows a listing-only operation to complete across multiple batches', async () => {
		const listings = outputs(26)
		ordinalSweep
			.mockResolvedValueOnce({ txid: 'cancel-first' })
			.mockResolvedValueOnce({ txid: 'cancel-last' })
		const result = await executeSweep({
			wallet,
			keys,
			listings,
			funding: [],
			ordinals: [],
			onProgress: () => {},
		})
		expect(result.errors).toEqual([])
		expect(result.listingTxids).toEqual(['cancel-first', 'cancel-last'])
		expect(result.cancelledListings).toEqual(
			listings.map((row) => row.outpoint),
		)
		expect(ordinalSweep).toHaveBeenCalledTimes(2)
		expect(bsvSweep).not.toHaveBeenCalled()
	})

	it('keeps completed receipts when preparing the next listing batch fails', async () => {
		const listings = outputs(26)
		getBeef
			.mockResolvedValueOnce(transactions.values().next().value as Beef)
			.mockRejectedValueOnce(new Error('Transaction unavailable'))
		const result = await executeSweep({
			wallet,
			keys,
			listings,
			funding: outputs(1, 1000),
			ordinals: outputs(1),
			onProgress: () => {},
		})
		expect(result.cancelledListings).toHaveLength(25)
		expect(result.listingTxids).toEqual(['ordinal-tx'])
		expect(result.errors).toEqual(['Listings batch 2: Transaction unavailable'])
		expect(ordinalSweep).toHaveBeenCalledTimes(1)
		expect(bsvSweep).not.toHaveBeenCalled()
	})

	it('does not attempt cancellation or move funding when an owner key is missing', async () => {
		const result = await executeSweep({
			wallet,
			keys: new Map(),
			listings: outputs(1),
			funding: outputs(1, 1000),
			ordinals: outputs(1),
			onProgress: () => {},
		})
		expect(result.errors[0]).toContain('No key for output')
		expect(result.cancelledListings).toEqual([])
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

	for (const category of ['listings', 'funding', 'ordinals'] as const) {
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
