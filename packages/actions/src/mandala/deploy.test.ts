import { afterEach, describe, expect, test } from 'bun:test'
import { Mandala } from '@1sat/templates'
import {
	MANDALA_DEPLOY_PROTOCOL,
	MANDALA_LABEL,
	MANDALA_TOPIC,
	mandalaProtocol,
	mandalaTokenBasket,
	mandalaTokenLabel,
	parseMandalaName,
} from '@1sat/types'
import {
	type CreateActionArgs,
	type InternalizeActionArgs,
	LockingScript,
	MerklePath,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	type Script,
	Transaction,
	UnlockingScript,
	type WalletInterface,
} from '@bsv/sdk'
import type { OneSatContext } from '../types.js'
import { deployMandala, fileMandalaDeploy } from './deploy.js'

const proto = new ProtoWallet(PrivateKey.fromHex('01'.repeat(32)))

/** Fake wallet: createAction builds the outputs into a real tx; internalize is recorded. */
function setup() {
	const created: CreateActionArgs[] = []
	const internalized: InternalizeActionArgs[] = []
	const wallet: Partial<WalletInterface> = {
		getPublicKey: (a) => proto.getPublicKey(a),
		createAction: async (args) => {
			created.push(args)
			const parent = new Transaction()
			parent.addInput({
				sourceTXID: '11'.repeat(32),
				sourceOutputIndex: 0,
				unlockingScript: new UnlockingScript(),
				sequence: 0xffffffff,
			})
			parent.addOutput({
				lockingScript: new P2PKH().lock(
					PrivateKey.fromHex('05'.repeat(32)).toPublicKey().toAddress(),
				),
				satoshis: 100_000,
			})
			parent.merklePath = new MerklePath(100, [
				[{ offset: 0, hash: parent.id('hex'), txid: true }],
			])
			const tx = new Transaction()
			tx.addInput({
				sourceTransaction: parent,
				sourceOutputIndex: 0,
				unlockingScript: new UnlockingScript(),
				sequence: 0xffffffff,
			})
			for (const o of args.outputs ?? []) {
				tx.addOutput({
					lockingScript: LockingScript.fromHex(o.lockingScript),
					satoshis: o.satoshis,
				})
			}
			return { txid: tx.id('hex'), tx: tx.toAtomicBEEF() }
		},
		internalizeAction: async (args) => {
			internalized.push(args)
			return { accepted: true }
		},
	}
	const ctx = {
		wallet: wallet as WalletInterface,
		chain: 'main',
		isBaseWallet: true,
	} as unknown as OneSatContext
	return { ctx, created, internalized }
}

/** The P2PKH the wallet derives under MANDALA_DEPLOY_PROTOCOL for this keyID. */
async function derivedLock(ci: { keyID: string }) {
	const { publicKey } = await proto.getPublicKey({
		protocolID: MANDALA_DEPLOY_PROTOCOL,
		keyID: ci.keyID,
		counterparty: 'self',
		forSelf: true,
	})
	return new P2PKH().lock(PublicKey.fromString(publicKey).toAddress())
}

function expectFiling(
	created: CreateActionArgs[],
	internalized: InternalizeActionArgs[],
	txid: string,
) {
	// one createAction: deploy at vout 0, label `mandala`, derivation-only CI
	expect(created).toHaveLength(1)
	expect(created[0].options?.randomizeOutputs).toBe(false)
	expect(created[0].labels).toEqual([MANDALA_LABEL])
	expect(created[0].outputs).toHaveLength(1)
	// untracked: an output cannot later be moved out of a basket
	expect(created[0].outputs?.[0].basket).toBeUndefined()
	const ci = JSON.parse(created[0].outputs?.[0].customInstructions ?? '{}')
	expect(Object.keys(ci).sort()).toEqual(['keyID', 'protocolID'])
	// deploy key: [2, 'mandala deploy'] (txid unknown at derivation time)
	expect(ci.protocolID).toEqual([2, 'mandala deploy'])
	expect(ci.keyID).toStartWith('mandala-deploy-')

	// one internalizeAction on the same tx: vout 0 into the per-token basket
	expect(internalized).toHaveLength(1)
	const int = internalized[0]
	expect(Transaction.fromAtomicBEEF(int.tx).id('hex')).toBe(txid)
	expect(int.labels).toEqual([MANDALA_LABEL, `mandala ${txid} 0`])
	expect(int.labels).toContain(mandalaTokenLabel({ txid, vout: 0 }))
	expect(int.outputs).toHaveLength(1)
	expect(int.outputs[0].outputIndex).toBe(0)
	expect(int.outputs[0].protocol).toBe('basket insertion')
	const remit = int.outputs[0].insertionRemittance
	expect(remit?.basket).toBe(`mandala ${txid} 0`)
	expect(remit?.basket).toBe(mandalaTokenBasket(`${txid}_0`))
	expect(remit?.customInstructions).toBe(
		created[0].outputs?.[0].customInstructions,
	)
	return { ci, tx: Transaction.fromAtomicBEEF(int.tx) }
}

describe('deployMandala', () => {
	test('fixed supply: createAction + internalize into the per-token basket, tokenId = txid', async () => {
		const { ctx, created, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '21000000',
			symbol: 'GOLD',
			decimals: 8,
		})

		expect(res.error).toBeUndefined()
		expect(res.txid).toMatch(/^[0-9a-f]{64}$/)
		expect(res.tokenId).toBe(`${res.txid}.0`)
		expect(res.tx).toBeDefined()
		expect(created[0].options?.noSend).toBeUndefined()

		const { ci, tx } = expectFiling(created, internalized, res.txid as string)
		const expected = Mandala.deployValue(21_000_000n, {
			lock: await derivedLock(ci),
			payload: { sym: 'GOLD', dec: 8 },
		})
		expect(created[0].outputs?.[0].lockingScript).toBe(expected.lock().toHex())
		const decoded = Mandala.decode(tx.outputs[0].lockingScript as Script)
		expect(decoded?.role).toBe('deploy')
		expect(decoded?.amount).toBe(21_000_000n)
		expect(decoded?.metadata).toEqual({ sym: 'GOLD', dec: 8 })
	})

	test('authority: amount 0 deploys the first authority, filed the same way', async () => {
		const { ctx, created, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: 0n,
			symbol: 'STABLE',
			decimals: 2,
			icon: { mediaType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
		})

		expect(res.error).toBeUndefined()
		expect(res.tokenId).toBe(`${res.txid}.0`)

		const { ci, tx } = expectFiling(created, internalized, res.txid as string)
		const expected = Mandala.deployAuthority({
			lock: await derivedLock(ci),
			payload: {
				sym: 'STABLE',
				dec: 2,
				icon: {
					mediaType: 'image/png',
					bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47),
				},
			},
		})
		expect(created[0].outputs?.[0].lockingScript).toBe(expected.lock().toHex())
		const decoded = Mandala.decode(tx.outputs[0].lockingScript as Script)
		expect(decoded?.role).toBe('deploy')
		expect(decoded?.amount).toBe(0n)
		expect(decoded?.metadata?.icon).toEqual({
			mediaType: 'image/png',
			bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47),
		})
	})

	test('an address destination carries no customInstructions', async () => {
		const { ctx, created, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '5',
			destination: {
				address: PrivateKey.fromHex('06'.repeat(32)).toPublicKey().toAddress(),
			},
		})
		expect(res.error).toBeUndefined()
		expect(created[0].outputs?.[0].customInstructions).toBeUndefined()
		expect(
			internalized[0].outputs[0].insertionRemittance?.customInstructions,
		).toBeUndefined()
	})

	test('names: `mandala <txid> <vout>` from {txid, vout}, txid_vout or txid.vout', () => {
		const txid = 'AB'.repeat(32)
		const name = `mandala ${'ab'.repeat(32)} 3`
		for (const ref of [{ txid, vout: 3 }, `${txid}_3`, `${txid}.3`]) {
			expect(mandalaTokenBasket(ref)).toBe(name)
			expect(mandalaTokenLabel(ref)).toBe(name)
			expect(mandalaProtocol(ref)).toEqual([2, name])
		}
		expect(() => mandalaProtocol(txid)).toThrow()
	})

	test('parseMandalaName recovers {txid, vout} from basket, label or protocol', () => {
		const txid = 'ab'.repeat(32)
		expect(parseMandalaName(`mandala ${txid} 7`)).toEqual({ txid, vout: 7 })
		expect(parseMandalaName([2, `mandala ${txid} 0`])).toEqual({
			txid,
			vout: 0,
		})
		expect(parseMandalaName('mandala')).toBeUndefined()
		expect(parseMandalaName('mandala deploy')).toBeUndefined()
		expect(parseMandalaName(`mandala ${txid}_0`)).toBeUndefined()
	})
})

describe('deployMandala filing retry', () => {
	test('a failed internalize returns txid/tx/error; fileMandalaDeploy re-files from listActions', async () => {
		const { ctx, created, internalized } = setup()
		const internalize = ctx.wallet.internalizeAction
		let fail = true
		ctx.wallet.internalizeAction = async (args) => {
			if (fail) throw new Error('storage busy')
			return internalize(args)
		}
		const res = await deployMandala.execute(ctx, { amount: '7' })
		expect(res.error).toBe('file-failed: storage busy')
		expect(res.txid).toMatch(/^[0-9a-f]{64}$/)
		expect(res.tokenId).toBe(`${res.txid}.0`)
		expect(internalized).toHaveLength(0)

		const ciString = created[0].outputs?.[0].customInstructions
		const listCalls: unknown[] = []
		ctx.wallet.listActions = async (args) => {
			listCalls.push(args)
			return {
				totalActions: 1,
				actions: [
					{
						txid: res.txid as string,
						satoshis: 0,
						status: 'completed',
						isOutgoing: true,
						description: 'Deploy Mandala token (fixed supply)',
						labels: [MANDALA_LABEL],
						version: 1,
						lockTime: 0,
						outputs: [
							{
								outputIndex: 0,
								satoshis: 1,
								spendable: true,
								tags: [],
								outputDescription: 'Mandala deploy',
								basket: '',
								customInstructions: ciString,
							},
						],
					},
				],
			}
		}
		fail = false
		const filed = await fileMandalaDeploy.execute(ctx, {
			txid: res.txid as string,
			tx: res.tx,
		})
		expect(filed.error).toBeUndefined()
		expect(filed.tokenId).toBe(`${res.txid}.0`)
		expect(listCalls).toEqual([
			{ labels: [MANDALA_LABEL], includeOutputs: true, limit: 10000 },
		])
		expectFiling(created, internalized, res.txid as string)
	})

	test('fileMandalaDeploy: unknown txid', async () => {
		const { ctx } = setup()
		ctx.wallet.listActions = async () => ({ totalActions: 0, actions: [] })
		const filed = await fileMandalaDeploy.execute(ctx, {
			txid: 'cd'.repeat(32),
		})
		expect(filed.error).toBe('deploy-not-found')
	})
})

describe('deployMandala overlay', () => {
	const realFetch = globalThis.fetch
	afterEach(() => {
		globalThis.fetch = realFetch
	})

	test('creates with noSend and submits to tm_mandala and tm_<txid> before internalizing', async () => {
		const order: string[] = []
		const submits: { url: string; topics: string | null }[] = []
		globalThis.fetch = (async (
			url: string | URL | Request,
			init?: RequestInit,
		) => {
			order.push('submit')
			submits.push({
				url: String(url),
				topics: new Headers(init?.headers).get('x-topics'),
			})
			return new Response(
				JSON.stringify({
					[MANDALA_TOPIC]: { outputsToAdmit: [0], coinsToRetain: [] },
				}),
				{ status: 200 },
			)
		}) as typeof fetch

		const { ctx, created, internalized } = setup()
		const internalize = ctx.wallet.internalizeAction
		ctx.wallet.internalizeAction = async (args) => {
			order.push('internalize')
			return internalize(args)
		}

		const res = await deployMandala.execute(ctx, {
			amount: '1000',
			symbol: 'OVL',
			overlay: 'https://overlay.example/',
		})

		expect(res.error).toBeUndefined()
		expect(res.tokenId).toBe(`${res.txid}.0`)
		expect(created[0].options?.noSend).toBe(true)
		expect(submits).toEqual([
			{
				url: 'https://overlay.example/submit',
				topics: `${MANDALA_TOPIC},tm_${res.txid}`,
			},
		])
		expect(order).toEqual(['submit', 'internalize'])
		expectFiling(created, internalized, res.txid as string)
	})
})
