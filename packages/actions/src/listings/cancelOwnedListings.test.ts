import {
	type Mock,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	spyOn,
} from 'bun:test'
import { OPNS_BASKET, ORDINALS_BASKET } from '@1sat/types'
import type { ListOutputsResult, WalletInterface, WalletOutput } from '@bsv/sdk'
import { cancelOpnsListing } from '../opns/index.js'
import { cancelOrdinalListing } from '../ordinals/index.js'
import { cancelTokenListing } from '../tokens/index.js'
import { TOKEN_CONTENT_TYPE } from '@1sat/types'
import { createContext } from '../types.js'
import { cancelOwnedListings } from './cancelOwnedListings.js'

const IDENTITY = `02${'11'.repeat(32)}`
const OTHER_IDENTITY = `03${'22'.repeat(32)}`

function listing(id: string): WalletOutput {
	return {
		outpoint: `${id}.0`,
		satoshis: 1,
		spendable: true,
		tags: ['ordlock', `id:${id}`],
	}
}

function context(rows: Record<string, WalletOutput[]> = {}, pageSize = 1000) {
	const wallet: Pick<WalletInterface, 'listOutputs' | 'getPublicKey'> = {
		getPublicKey: async () => ({ publicKey: IDENTITY }),
		listOutputs: async ({ basket, offset = 0, limit = 1000 }) => {
			const outputs = rows[basket] ?? []
			return {
				totalOutputs: outputs.length,
				outputs: outputs.slice(offset, offset + Math.min(limit, pageSize)),
			}
		},
	}
	return createContext(wallet as WalletInterface)
}

let ordinalCancel: Mock<typeof cancelOrdinalListing.execute>
let opnsCancel: Mock<typeof cancelOpnsListing.execute>
let tokenCancel: Mock<typeof cancelTokenListing.execute>
beforeEach(() => {
	ordinalCancel = spyOn(cancelOrdinalListing, 'execute').mockResolvedValue({
		txid: 'ordinal-tx',
	})
	opnsCancel = spyOn(cancelOpnsListing, 'execute').mockResolvedValue({
		txid: 'opns-tx',
	})
	tokenCancel = spyOn(cancelTokenListing, 'execute').mockResolvedValue({
		txid: 'token-tx',
	})
})
afterEach(() => {
	ordinalCancel.mockRestore()
	opnsCancel.mockRestore()
	tokenCancel.mockRestore()
})

function expectNoSpends() {
	expect(ordinalCancel).not.toHaveBeenCalled()
	expect(opnsCancel).not.toHaveBeenCalled()
	expect(tokenCancel).not.toHaveBeenCalled()
}

describe('cancelOwnedListings', () => {
	it('returns an empty result for two empty baskets', async () => {
		expect(await cancelOwnedListings.execute(context(), {})).toEqual({
			cancelled: 0,
			txids: [],
			errors: [],
		})
		expectNoSpends()
	})

	it('does not cancel application/bsv-20 listings through cancelOrdinalListing', async () => {
		const id = 'ab'.repeat(32)
		const tokenListing: WalletOutput = {
			outpoint: `${id}.0`,
			satoshis: 1,
			spendable: true,
			tags: [
				'ordlock',
				`id:${id}`,
				`type:${TOKEN_CONTENT_TYPE}`,
				`bsv21:${id}_0`,
				'amt:1111',
			],
			customInstructions: JSON.stringify({
				id: `${id}_0`,
				amt: '1111',
				op: 'transfer',
			}),
		}
		const result = await cancelOwnedListings.execute(
			context({ [ORDINALS_BASKET]: [tokenListing] }),
			{},
		)
		expect(ordinalCancel).not.toHaveBeenCalled()
		expect(tokenCancel).toHaveBeenCalledTimes(1)
		expect(result.txids).toEqual(['token-tx'])
	})

	it('discovers over 1000 listings in each basket before spending, including short pages', async () => {
		const rows = {
			[ORDINALS_BASKET]: Array.from({ length: 1001 }, (_, i) =>
				listing(`ordinal-${i}`),
			),
			[OPNS_BASKET]: Array.from({ length: 1002 }, (_, i) =>
				listing(`opns-${i}`),
			),
		}
		const ctx = context(rows, 137)
		const listOutputs = ctx.wallet.listOutputs
		const offsets: Record<string, number[]> = {}
		ctx.wallet.listOutputs = async (args) => {
			expectNoSpends()
			expect(args.tags).toEqual(['ordlock'])
			expect(args.includeTags).toBe(true)
			offsets[args.basket] ??= []
			offsets[args.basket].push(args.offset ?? 0)
			return listOutputs(args)
		}
		let active = 0
		for (const [basket, cancel] of [
			[ORDINALS_BASKET, ordinalCancel],
			[OPNS_BASKET, opnsCancel],
		] as const) {
			cancel.mockImplementation(async (captured, input) => {
				expect(captured.wallet).toBe(ctx.wallet)
				expect(input.usePermissionModule).toBe(true)
				expect(++active).toBe(1)
				await Promise.resolve()
				const index = rows[basket].findIndex(
					(row) => row.outpoint === `${input.id}.0`,
				)
				expect(index).toBeGreaterThanOrEqual(0)
				rows[basket].splice(index, 1)
				active--
				return { txid: `tx-${input.id}` }
			})
		}
		const result = await cancelOwnedListings.execute(ctx, {
			usePermissionModule: true,
		})
		expect(result.cancelled).toBe(2003)
		expect(new Set(result.txids).size).toBe(2003)
		expect(result.errors).toEqual([])
		expect(offsets[ORDINALS_BASKET]).toEqual([
			0, 137, 274, 411, 548, 685, 822, 959,
		])
		expect(offsets[OPNS_BASKET]).toEqual(offsets[ORDINALS_BASKET])
		expect(rows[ORDINALS_BASKET]).toEqual([])
		expect(rows[OPNS_BASKET]).toEqual([])
	})

	it('requests only the remaining rows on the final page', async () => {
		const rows = Array.from({ length: 1001 }, (_, i) => listing(`ordinal-${i}`))
		const ctx = context()
		const limits: number[] = []
		ctx.wallet.listOutputs = async ({ basket, offset = 0, limit = 1000 }) => {
			if (basket === OPNS_BASKET) return { totalOutputs: 0, outputs: [] }
			limits.push(limit)
			const outputs = rows.slice(offset, offset + limit)
			// The installed toolbox reports page length for a short page.
			return {
				totalOutputs: outputs.length < limit ? outputs.length : rows.length,
				outputs,
			}
		}
		const result = await cancelOwnedListings.execute(ctx, {})
		expect(result.cancelled).toBe(1001)
		expect(result.errors).toEqual([])
		expect(limits).toEqual([1000, 1])
	})

	it('preserves failures and retries only listings still present on the next invocation', async () => {
		const rows = {
			[ORDINALS_BASKET]: [
				listing('success'),
				listing('returned-error'),
				listing('thrown-error'),
			],
			[OPNS_BASKET]: [listing('opns-success')],
		}
		const ctx = context(rows)
		let retry = false
		for (const [basket, cancel] of [
			[ORDINALS_BASKET, ordinalCancel],
			[OPNS_BASKET, opnsCancel],
		] as const) {
			cancel.mockImplementation(async (_ctx, { id }) => {
				if (!retry && id === 'returned-error') return { error: 'not-ready' }
				if (!retry && id === 'thrown-error') throw new Error('offline')
				rows[basket].splice(
					rows[basket].findIndex((row) => row.outpoint === `${id}.0`),
					1,
				)
				return { txid: `tx-${id}` }
			})
		}
		expect(await cancelOwnedListings.execute(ctx, {})).toEqual({
			cancelled: 2,
			txids: ['tx-success', 'tx-opns-success'],
			errors: ['returned-error.0: not-ready', 'thrown-error.0: offline'],
		})
		retry = true
		expect(await cancelOwnedListings.execute(ctx, {})).toEqual({
			cancelled: 2,
			txids: ['tx-returned-error', 'tx-thrown-error'],
			errors: [],
		})
		expect(ordinalCancel).toHaveBeenCalledTimes(5)
		expect(opnsCancel).toHaveBeenCalledTimes(1)
	})

	it('reports missing ids without stopping other listings', async () => {
		const noId = { ...listing('legacy'), tags: ['ordlock'] }
		const result = await cancelOwnedListings.execute(
			context({
				[ORDINALS_BASKET]: [noId, listing('valid')],
			}),
			{},
		)
		expect(result).toEqual({
			cancelled: 1,
			txids: ['ordinal-tx'],
			errors: ['legacy.0: missing-id'],
		})
		expect(ordinalCancel).toHaveBeenCalledTimes(1)
	})

	it.each([undefined, '', '   '])(
		'does not count an empty txid (%p) as success',
		async (txid) => {
			ordinalCancel.mockResolvedValue({ txid })
			const result = await cancelOwnedListings.execute(
				context({ [ORDINALS_BASKET]: [listing('a')] }),
				{},
			)
			expect(result).toEqual({
				cancelled: 0,
				txids: [],
				errors: ['a.0: missing-txid'],
			})
		},
	)

	it('does not spend either basket when discovery of the second basket fails', async () => {
		const ctx = context({ [ORDINALS_BASKET]: [listing('a')] })
		const listOutputs = ctx.wallet.listOutputs
		ctx.wallet.listOutputs = async (args) => {
			if (args.basket === OPNS_BASKET) throw new Error('discovery-offline')
			return listOutputs(args)
		}
		expect(await cancelOwnedListings.execute(ctx, {})).toEqual({
			cancelled: 0,
			txids: [],
			errors: ['discovery-offline'],
		})
		expectNoSpends()
	})

	it.each([
		['invalid-listing-total', [{ totalOutputs: -1, outputs: [] }]],
		['invalid-listing-total', [{ totalOutputs: 0.5, outputs: [] }]],
		[
			'listing-total-changed',
			[
				{ totalOutputs: 2, outputs: [listing('a')] },
				{ totalOutputs: 1, outputs: [] },
			],
		],
		[
			'listing-discovery-made-no-progress',
			[
				{ totalOutputs: 2, outputs: [listing('a')] },
				{ totalOutputs: 2, outputs: [] },
			],
		],
		[
			'duplicate-listing-output',
			[
				{ totalOutputs: 2, outputs: [listing('a')] },
				{ totalOutputs: 2, outputs: [listing('a')] },
			],
		],
		[
			'duplicate-listing-id',
			[
				{
					totalOutputs: 2,
					outputs: [listing('a'), { ...listing('a'), outpoint: 'other.0' }],
				},
			],
		],
		[
			'inconsistent-listing-total',
			[{ totalOutputs: 1, outputs: [listing('a'), listing('b')] }],
		],
	] satisfies Array<[string, ListOutputsResult[]]>)(
		'rejects %s before spending',
		async (message, pages) => {
			const ctx = context()
			let calls = 0
			ctx.wallet.listOutputs = async () => {
				const page = pages[calls++]
				if (!page) throw new Error('unexpected extra page')
				return page
			}
			const result = await cancelOwnedListings.execute(ctx, {})
			expect(result.cancelled).toBe(0)
			expect(result.errors[0]).toContain(message)
			expect(calls).toBe(pages.length)
			expectNoSpends()
		},
	)

	it('rejects the same outpoint appearing in both baskets', async () => {
		const result = await cancelOwnedListings.execute(
			context({
				[ORDINALS_BASKET]: [listing('a')],
				[OPNS_BASKET]: [listing('a')],
			}),
			{},
		)
		expect(result.errors[0]).toContain('duplicate-listing-output')
		expectNoSpends()
	})

	it.each(['identity', 'wallet'] as const)(
		'stops if the %s changes while discovery is pending',
		async (change) => {
			const ctx = context({ [ORDINALS_BASKET]: [listing('a')] })
			const listOutputs = ctx.wallet.listOutputs
			ctx.wallet.listOutputs = async (args) => {
				const page = await listOutputs(args)
				if (change === 'identity')
					ctx.wallet.getPublicKey = async () => ({ publicKey: OTHER_IDENTITY })
				else ctx.wallet = context().wallet
				return page
			}
			const result = await cancelOwnedListings.execute(ctx, {})
			expect(result.errors).toEqual(['wallet-changed'])
			expectNoSpends()
		},
	)

	it('preserves a completed cancellation and stops scheduling after an account change', async () => {
		const ctx = context({ [ORDINALS_BASKET]: [listing('a'), listing('b')] })
		ordinalCancel.mockImplementation(async () => {
			ctx.wallet.getPublicKey = async () => ({ publicKey: OTHER_IDENTITY })
			return { txid: 'completed-tx' }
		})
		expect(await cancelOwnedListings.execute(ctx, {})).toEqual({
			cancelled: 1,
			txids: ['completed-tx'],
			errors: ['wallet-changed'],
		})
		expect(ordinalCancel).toHaveBeenCalledTimes(1)
	})

	it('honors abort during discovery without spending', async () => {
		const controller = new AbortController()
		const ctx = context()
		ctx.wallet.listOutputs = async () => {
			controller.abort(new Error('wallet-closed'))
			return { totalOutputs: 1, outputs: [listing('a')] }
		}
		const result = await cancelOwnedListings.execute(ctx, {
			signal: controller.signal,
		})
		expect(result.errors).toEqual(['wallet-closed'])
		expectNoSpends()
	})

	it('honors abort after an in-flight cancellation and retains its confirmed txid', async () => {
		const controller = new AbortController()
		ordinalCancel.mockImplementation(async () => {
			controller.abort(new Error('wallet-closed'))
			return { txid: 'completed-tx' }
		})
		const ctx = context({ [ORDINALS_BASKET]: [listing('a'), listing('b')] })
		expect(
			await cancelOwnedListings.execute(ctx, { signal: controller.signal }),
		).toEqual({
			cancelled: 1,
			txids: ['completed-tx'],
			errors: ['wallet-closed'],
		})
		expect(ordinalCancel).toHaveBeenCalledTimes(1)
	})
})
