import {
	type Mock,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	spyOn,
} from 'bun:test'
import { sweepBsv, sweepBsv20, sweepBsv21, sweepOrdinals } from '@1sat/actions'
import type { IndexedOutput } from '@1sat/types'
import {
	Beef,
	P2PKH,
	PrivateKey,
	Transaction,
	type WalletInterface,
} from '@bsv/sdk'
import type { ScannedAssets } from '../src/lib/scanner.js'
import { configureServices, getServices } from '../src/lib/services.js'
import {
	executeSweep,
	selectAllSweepClasses,
	sweepAllClasses,
} from '../src/lib/sweeper.js'

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
let bsv20Sweep: Mock<typeof sweepBsv20.execute>
let bsv21Sweep: Mock<typeof sweepBsv21.execute>
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
	bsv20Sweep = spyOn(sweepBsv20, 'execute').mockResolvedValue({
		txid: 'bsv20-tx',
	})
	bsv21Sweep = spyOn(sweepBsv21, 'execute').mockResolvedValue({
		txid: 'bsv21-tx',
	})
})

afterEach(() => {
	ordinalSweep.mockRestore()
	bsvSweep.mockRestore()
	bsv20Sweep.mockRestore()
	bsv21Sweep.mockRestore()
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

function emptyAssets(overrides: Partial<ScannedAssets> = {}): ScannedAssets {
	return {
		funding: [],
		ordinals: [],
		opnsNames: [],
		bsv21Tokens: [],
		bsv20Tokens: [],
		locked: [],
		run: [],
		totalFundingSats: 0,
		totalBsv: 0,
		...overrides,
	}
}

function tokenOutput(
	row: IndexedOutput,
	tick: string,
	amt: string,
	listed: boolean,
): IndexedOutput {
	return {
		...row,
		events: [
			...(row.events ?? []),
			...(listed ? ['ordlock'] : []),
			`tick:${tick}`,
			`amt:${amt}`,
		],
	}
}

describe('sweepAllClasses selection, retry, and abort', () => {
	it('sweeps only selected classes and items', async () => {
		const funding = outputs(1, 1000)
		const ordinals = outputs(2)
		const tick = tokenOutput(outputs(1)[0], 'SHUA', '10', false)
		const results: { sweepClass: string; txid?: string; error?: string }[] = []
		const result = await sweepAllClasses({
			wallet,
			keys,
			assets: emptyAssets({ funding, ordinals, bsv20Tokens: [tick] }),
			onProgress: () => {},
			selection: {
				sweepBsv: false,
				ordinalOutpoints: new Set([ordinals[0].outpoint]),
				opnsOutpoints: new Set(),
				bsv20Ticks: new Set(),
				bsv21TokenIds: new Set(),
			},
			onResult: (r) => results.push(r),
		})
		expect(bsvSweep).not.toHaveBeenCalled()
		expect(bsv20Sweep).not.toHaveBeenCalled()
		expect(ordinalSweep).toHaveBeenCalledTimes(1)
		expect(result.ordinalTxids).toEqual(['ordinal-tx'])
		expect(result.sweptOutpoints).toEqual([ordinals[0].outpoint])
		expect(result.errors).toEqual([])
		expect(results).toEqual([
			{ sweepClass: 'ordinals', label: 'Ordinals', txid: 'ordinal-tx' },
		])
	})

	it('selectAllSweepClasses selects every scanned asset', async () => {
		const funding = outputs(1, 1000)
		const ordinals = outputs(1)
		const assets = emptyAssets({ funding, ordinals })
		const selection = selectAllSweepClasses(assets)
		expect(selection.sweepBsv).toBe(true)
		expect(selection.ordinalOutpoints).toEqual(
			new Set(ordinals.map((o) => o.outpoint)),
		)
		const result = await sweepAllClasses({
			wallet,
			keys,
			assets,
			onProgress: () => {},
			selection,
		})
		expect(result.bsvTxid).toBe('funding-tx')
		expect(result.ordinalTxids).toEqual(['ordinal-tx'])
		expect(result.errors).toEqual([])
	})

	it('skips completed outpoints and records new successes for retry', async () => {
		const ordinals = outputs(2)
		const completed = new Set([ordinals[0].outpoint])
		const result = await sweepAllClasses({
			wallet,
			keys,
			assets: emptyAssets({ ordinals }),
			onProgress: () => {},
			completed,
		})
		expect(ordinalSweep).toHaveBeenCalledTimes(1)
		expect(result.sweptOutpoints).toEqual([ordinals[1].outpoint])
		expect(completed.has(ordinals[0].outpoint)).toBe(true)
		expect(completed.has(ordinals[1].outpoint)).toBe(true)
	})

	it('matches completed outpoints across `.` and `_` forms', async () => {
		const rows = outputs(1)
		const underscored = {
			...rows[0],
			outpoint: rows[0].outpoint.replace('.', '_'),
		}
		const completed = new Set([rows[0].outpoint])
		const result = await sweepAllClasses({
			wallet,
			keys,
			assets: emptyAssets({ ordinals: [underscored] }),
			onProgress: () => {},
			completed,
		})
		expect(ordinalSweep).not.toHaveBeenCalled()
		expect(result.ordinalTxids).toEqual([])
		expect(result.errors).toEqual([])
	})

	it('aborts before later classes and keeps the emitted BSV receipt', async () => {
		const controller = new AbortController()
		bsvSweep.mockImplementation(async () => {
			controller.abort()
			return { txid: 'funding-tx' }
		})
		const results: { sweepClass: string; txid?: string }[] = []
		await expect(
			sweepAllClasses({
				wallet,
				keys,
				assets: emptyAssets({
					funding: outputs(1, 1000),
					ordinals: outputs(1),
				}),
				onProgress: () => {},
				signal: controller.signal,
				onResult: (r) => results.push(r),
			}),
		).rejects.toThrow()
		expect(results).toEqual([
			{ sweepClass: 'bsv', label: 'BSV', txid: 'funding-tx' },
		])
		expect(ordinalSweep).not.toHaveBeenCalled()
	})

	it('fails closed on ambiguous owner matches', async () => {
		const rows = outputs(1)
		rows[0].events = [
			`own:${ownerKeys[0].toAddress()}`,
			`own:${ownerKeys[1].toAddress()}`,
		]
		const result = await sweepAllClasses({
			wallet,
			keys,
			assets: emptyAssets({ ordinals: rows }),
			onProgress: () => {},
		})
		expect(ordinalSweep).not.toHaveBeenCalled()
		expect(result.ordinalTxids).toEqual([])
		expect(result.errors[0]).toContain('No key for output')
	})

	it('batches a whole BSV-20 tick in one transaction by default', async () => {
		const rows = outputs(3).map((row, i) =>
			tokenOutput(row, 'SHUA', `${i + 1}`, i < 2),
		)
		const result = await sweepAllClasses({
			wallet,
			keys,
			assets: emptyAssets({ bsv20Tokens: rows }),
			onProgress: () => {},
		})
		expect(bsv20Sweep).toHaveBeenCalledTimes(1)
		expect(result.bsv20Txids).toEqual(['bsv20-tx'])
		expect(result.errors).toEqual([])
	})

	it('splitListedBsv20 sweeps each listed output alone', async () => {
		const rows = outputs(3).map((row, i) =>
			tokenOutput(row, 'SHUA', `${i + 1}`, i < 2),
		)
		bsv20Sweep.mockImplementation(async (_ctx, input) => {
			return {
				txid: `bsv20-${input.inputs.length}-${input.inputs[0].outpoint}`,
			}
		})
		const result = await sweepAllClasses({
			wallet,
			keys,
			assets: emptyAssets({ bsv20Tokens: rows }),
			onProgress: () => {},
			splitListedBsv20: true,
		})
		expect(bsv20Sweep).toHaveBeenCalledTimes(3)
		expect(
			bsv20Sweep.mock.calls.map(([, input]) => input.inputs.length),
		).toEqual([1, 1, 1])
		expect(result.bsv20Txids).toHaveLength(3)
		expect(result.errors).toEqual([])
	})

	it('reports swept listings canceled into the wallet', async () => {
		const [listed, plain] = outputs(2)
		listed.events = [...(listed.events ?? []), 'ordlock']
		const tick = tokenOutput(
			outputs(1, 1, [ownerKeys[1]])[0],
			'SHUA',
			'10',
			true,
		)
		const result = await sweepAllClasses({
			wallet,
			keys,
			assets: emptyAssets({ ordinals: [listed, plain], bsv20Tokens: [tick] }),
			onProgress: () => {},
		})
		expect(result.errors).toEqual([])
		expect(result.cancelledListings).toEqual(
			expect.arrayContaining([listed.outpoint, tick.outpoint]),
		)
		expect(result.cancelledListings).not.toContain(plain.outpoint)
		expect(result.cancelledListings).toHaveLength(2)
	})

	it('reports no canceled listings when nothing listed swept', async () => {
		const result = await sweepAllClasses({
			wallet,
			keys,
			assets: emptyAssets({
				funding: outputs(1, 1000),
				ordinals: outputs(1),
			}),
			onProgress: () => {},
		})
		expect(result.errors).toEqual([])
		expect(result.cancelledListings).toEqual([])
	})
})
