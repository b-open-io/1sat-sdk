import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Beef, P2PKH, PrivateKey, Transaction } from '@bsv/sdk'
import type { sdk as toolboxSdk } from '@bsv/wallet-toolbox-client'
import { HttpError } from '../src/errors.js'
import { OneSatServices, describePostBeefResult } from '../src/index.js'

type PostBeefResult = toolboxSdk.PostBeefResult
type WalletServices = toolboxSdk.WalletServices

type StackStatus = Awaited<ReturnType<OneSatServices['submitToStack']>>

function signedBeef(): { beef: Beef; txid: string } {
	const key = PrivateKey.fromHex(
		'0000000000000000000000000000000000000000000000000000000000000001',
	)
	const tx = new Transaction()
	tx.addOutput({
		lockingScript: new P2PKH().lock(key.toPublicKey().toAddress()),
		satoshis: 1000,
	})
	const beef = new Beef()
	beef.mergeTransaction(tx)
	return { beef, txid: tx.id('hex') }
}

function services(
	stack: () => Promise<StackStatus>,
	fallback?: (txids: string[]) => Promise<PostBeefResult[]>,
): { svc: OneSatServices; fallbackCalls: string[][] } {
	const fallbackCalls: string[][] = []
	const fallbackServices = fallback
		? ({
				postBeef: async (_beef: Beef, txids: string[]) => {
					fallbackCalls.push(txids)
					return fallback(txids)
				},
			} as unknown as WalletServices)
		: undefined
	const svc = new OneSatServices(
		'main',
		'https://stack.example',
		fallbackServices,
	)
	svc.submitToStack = stack
	return { svc, fallbackCalls }
}

const status = (txid: string, txStatus: string): StackStatus => ({
	txid,
	txStatus,
	timestamp: new Date(0).toISOString(),
})

const accepted = (name: string, txid: string): PostBeefResult => ({
	name,
	status: 'success',
	txidResults: [{ txid, status: 'success' }],
})

const refused = (name: string, txid: string): PostBeefResult => ({
	name,
	status: 'error',
	error: Object.assign(new Error('service unavailable'), { code: 'ERR_503' }),
	txidResults: [{ txid, status: 'error', serviceError: true }],
})

describe('OneSatServices.postBeef failover', () => {
	const quiet: Array<ReturnType<typeof spyOn>> = []
	beforeEach(() => {
		for (const m of ['log', 'warn', 'error'] as const)
			quiet.push(spyOn(console, m).mockImplementation(() => {}))
	})
	afterEach(() => {
		for (const s of quiet.splice(0)) s.mockRestore()
	})

	test('stack accepts: no failover', async () => {
		const { beef, txid } = signedBeef()
		const { svc, fallbackCalls } = services(
			async () => status(txid, 'SEEN_ON_NETWORK'),
			async (t) => [accepted('GorillaPoolArcBeef', t[0])],
		)
		const results = await svc.postBeef(beef, [txid])
		expect(fallbackCalls).toHaveLength(0)
		expect(results.map((r) => r.name)).toEqual(['1sat-api'])
		expect(results[0].status).toBe('success')
	})

	test('stack unreachable: fails over and returns every result', async () => {
		const { beef, txid } = signedBeef()
		const { svc, fallbackCalls } = services(
			async () => {
				throw new Error('connect ECONNREFUSED')
			},
			async (t) => [
				refused('GorillaPoolArcBeef', t[0]),
				accepted('TaalArcBeef', t[0]),
			],
		)
		const results = await svc.postBeef(beef, [txid])
		expect(fallbackCalls).toEqual([[txid]])
		expect(results.map((r) => r.name)).toEqual([
			'1sat-api',
			'GorillaPoolArcBeef',
			'TaalArcBeef',
		])
		expect(results[0].txidResults[0].serviceError).toBe(true)
		expect(results.some((r) => r.status === 'success')).toBe(true)
	})

	test('stack has no status yet: fails over', async () => {
		const { beef, txid } = signedBeef()
		const { svc, fallbackCalls } = services(
			async () => status(txid, 'UNKNOWN'),
			async (t) => [accepted('GorillaPoolArcBeef', t[0])],
		)
		await svc.postBeef(beef, [txid])
		expect(fallbackCalls).toEqual([[txid]])
	})

	test('stack rejects: final, no failover', async () => {
		const { beef, txid } = signedBeef()
		const { svc, fallbackCalls } = services(
			async () => status(txid, 'REJECTED'),
			async (t) => [accepted('GorillaPoolArcBeef', t[0])],
		)
		const results = await svc.postBeef(beef, [txid])
		expect(fallbackCalls).toHaveLength(0)
		expect(results).toHaveLength(1)
		expect(results[0].status).toBe('error')
		expect(results[0].txidResults[0].serviceError).toBeUndefined()
	})

	test('stack reports double spend: final, no failover', async () => {
		const { beef, txid } = signedBeef()
		const { svc, fallbackCalls } = services(
			async () => status(txid, 'DOUBLE_SPEND_ATTEMPTED'),
			async (t) => [accepted('GorillaPoolArcBeef', t[0])],
		)
		const results = await svc.postBeef(beef, [txid])
		expect(fallbackCalls).toHaveLength(0)
		expect(results[0].txidResults[0].doubleSpend).toBe(true)
	})

	test('failover off: stack result only', async () => {
		const { beef, txid } = signedBeef()
		const { svc, fallbackCalls } = services(
			async () => {
				throw new Error('timeout')
			},
			async (t) => [accepted('GorillaPoolArcBeef', t[0])],
		)
		svc.broadcastFailover = false
		const results = await svc.postBeef(beef, [txid])
		expect(fallbackCalls).toHaveLength(0)
		expect(results).toHaveLength(1)
		expect(results[0].txidResults[0].serviceError).toBe(true)
	})

	test('failover throws: keeps the stack no-verdict result so the monitor retries', async () => {
		const { beef, txid } = signedBeef()
		const { svc } = services(
			async () => {
				throw new Error('timeout')
			},
			async () => {
				throw new Error('misconfigured')
			},
		)
		const results = await svc.postBeef(beef, [txid])
		expect(results).toHaveLength(1)
		expect(results[0].txidResults[0].serviceError).toBe(true)
		expect(console.error).toHaveBeenCalled()
	})
})

describe('OneSatServices.postBeef failover refusals', () => {
	const quiet: Array<ReturnType<typeof spyOn>> = []
	beforeEach(() => {
		for (const m of ['log', 'warn', 'error'] as const)
			quiet.push(spyOn(console, m).mockImplementation(() => {}))
	})
	afterEach(() => {
		for (const s of quiet.splice(0)) s.mockRestore()
	})

	test('a failover double spend or rejection never fails the tx', async () => {
		const { beef, txid } = signedBeef()
		const { svc } = services(
			async () => {
				throw new Error('timeout')
			},
			async (t) => [
				{
					name: 'WhatsOnChain',
					status: 'error',
					error: new Error('Missing inputs'),
					txidResults: [{ txid: t[0], status: 'error', doubleSpend: true }],
				},
				{
					name: 'TaalArcBeef',
					status: 'error',
					error: new Error('401 unauthorized'),
					txidResults: [{ txid: t[0], status: 'error' }],
				},
			],
		)
		const results = await svc.postBeef(beef, [txid])
		for (const r of results) {
			for (const t of r.txidResults) {
				expect(t.serviceError).toBe(true)
				expect(t.doubleSpend).not.toBe(true)
			}
		}
	})

	test('a failover acceptance is kept as success', async () => {
		const { beef, txid } = signedBeef()
		const { svc } = services(
			async () => {
				throw new Error('timeout')
			},
			async (t) => [
				refused('GorillaPoolArcBeef', t[0]),
				accepted('TaalArcBeef', t[0]),
			],
		)
		const results = await svc.postBeef(beef, [txid])
		expect(results[2].status).toBe('success')
		expect(results[2].txidResults[0].status).toBe('success')
	})
})

describe('OneSatServices.getUtxoStatus', () => {
	const outpoint = `${'ab'.repeat(32)}.0`
	function withTxoGet(get: () => Promise<unknown>): OneSatServices {
		const svc = new OneSatServices('main', 'https://stack.example')
		;(svc.txo as unknown as { get: () => Promise<unknown> }).get = get
		return svc
	}

	test('404 means not a UTXO', async () => {
		const svc = withTxoGet(async () => {
			throw new HttpError(404, 'not found')
		})
		const r = await svc.getUtxoStatus('', undefined, outpoint)
		expect(r.status).toBe('success')
		expect(r.isUtxo).toBe(false)
	})

	test('an unreachable stack is unknown, not spent', async () => {
		for (const err of [new Error('ECONNREFUSED'), new HttpError(503, 'down')]) {
			const svc = withTxoGet(async () => {
				throw err
			})
			const r = await svc.getUtxoStatus('', undefined, outpoint)
			expect(r.status).toBe('error')
		}
	})
})

describe('describePostBeefResult', () => {
	test('names the provider and its refusal', () => {
		expect(describePostBeefResult(accepted('TaalArcBeef', 'a'))).toBe(
			'TaalArcBeef accepted',
		)
		expect(describePostBeefResult(refused('WhatsOnChain', 'a'))).toBe(
			'WhatsOnChain refused (ERR_503: service unavailable; no verdict)',
		)
	})
})
