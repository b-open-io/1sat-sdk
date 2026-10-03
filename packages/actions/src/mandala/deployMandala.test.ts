import { afterEach, describe, expect, test } from 'bun:test'
import { Mandala } from '@1sat/templates'
import {
	MANDALA_AUTH_TAG,
	MANDALA_BASKET,
	MANDALA_DEPLOY_TAG,
	MANDALA_INDEX_TAG,
	MANDALA_PROTOCOL,
	MANDALA_TOPIC,
	mandalaTokenBasket,
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
import type { FundingProvider } from '../funding/index.js'
import type { OneSatContext } from '../types.js'
import { deployMandala } from './index.js'

const proto = new ProtoWallet(PrivateKey.fromHex('01'.repeat(32)))

function setup() {
	const internalized: InternalizeActionArgs[] = []
	const funded: CreateActionArgs[] = []
	const wallet: Partial<WalletInterface> = {
		getPublicKey: (a) => proto.getPublicKey(a),
		internalizeAction: async (args) => {
			internalized.push(args)
			return { accepted: true }
		},
	}
	// Builds the caller's outputs into a real transaction, as a provider would.
	const fundingProvider: FundingProvider = {
		async fund(args) {
			funded.push(structuredClone(args))
			const tx = new Transaction()
			tx.addInput({
				sourceTXID: '22'.repeat(32),
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
			return { txid: tx.id('hex'), tx: tx.toAtomicBEEF(true) }
		},
	}
	const ctx = {
		wallet: wallet as WalletInterface,
		chain: 'main',
		isBaseWallet: true,
	} as unknown as OneSatContext
	return { ctx, fundingProvider, internalized, funded }
}

/** The P2PKH the wallet derives under MANDALA_PROTOCOL for this keyID. */
async function derivedLock(ci: { keyID: string }) {
	const { publicKey } = await proto.getPublicKey({
		protocolID: MANDALA_PROTOCOL,
		keyID: ci.keyID,
		counterparty: 'self',
		forSelf: true,
	})
	return new P2PKH().lock(PublicKey.fromString(publicKey).toAddress())
}

describe('deployMandala', () => {
	test('fixed supply: deploy at vout 0, filed in the mandala index, tokenId = txid', async () => {
		const { ctx, fundingProvider, internalized, funded } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '21000000',
			symbol: 'GOLD',
			decimals: 8,
			fundingProvider,
		})

		expect(res.error).toBeUndefined()
		expect(res.txid).toMatch(/^[0-9a-f]{64}$/)
		expect(res.tokenId).toBe(res.txid as string)
		expect(res.tx).toBeDefined()

		expect(funded).toHaveLength(1)
		expect(funded[0].options?.randomizeOutputs).toBe(false)
		expect(funded[0].outputs).toHaveLength(1)

		expect(internalized).toHaveLength(1)
		const out = internalized[0].outputs[0]
		expect(out.outputIndex).toBe(0)
		expect(out.protocol).toBe('basket insertion')
		const remit = out.insertionRemittance
		expect(remit?.basket).toBe(MANDALA_BASKET)
		expect(remit?.tags).toContain(MANDALA_DEPLOY_TAG)
		expect(remit?.tags).toContain(MANDALA_INDEX_TAG)
		expect(remit?.tags).not.toContain(MANDALA_AUTH_TAG)
		expect(remit?.tags?.filter((t) => t.startsWith('mandala:')).sort()).toEqual(
			[MANDALA_DEPLOY_TAG, MANDALA_INDEX_TAG].sort(),
		)

		const ci = JSON.parse(remit?.customInstructions ?? '{}')
		// derivation only: no token fields
		expect(Object.keys(ci).sort()).toEqual(['keyID', 'protocolID'])
		expect(ci.protocolID).toEqual(MANDALA_PROTOCOL)
		expect(ci.keyID).toStartWith('mandala-deploy-')

		const tx = Transaction.fromAtomicBEEF(internalized[0].tx)
		expect(tx.id('hex')).toBe(res.txid as string)
		const expected = Mandala.deployValue(21_000_000n, {
			lock: await derivedLock(ci),
			payload: { sym: 'GOLD', dec: 8 },
		})
		expect(tx.outputs[0].lockingScript.toHex()).toBe(expected.lock().toHex())
		const decoded = Mandala.decode(tx.outputs[0].lockingScript as Script)
		expect(decoded?.role).toBe('deploy')
		expect(decoded?.amount).toBe(21_000_000n)
		expect(decoded?.metadata).toEqual({ sym: 'GOLD', dec: 8 })
	})

	test('authority: amount 0 deploys the first authority, tagged mandala:auth', async () => {
		const { ctx, fundingProvider, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: 0n,
			symbol: 'STABLE',
			decimals: 2,
			icon: 1,
			fundingProvider,
		})

		expect(res.error).toBeUndefined()
		expect(res.tokenId).toBe(res.txid as string)

		const remit = internalized[0].outputs[0].insertionRemittance
		expect(remit?.basket).toBe(MANDALA_BASKET)
		expect(remit?.tags).toEqual(
			expect.arrayContaining([
				MANDALA_DEPLOY_TAG,
				MANDALA_AUTH_TAG,
				MANDALA_INDEX_TAG,
			]),
		)
		const ci = JSON.parse(remit?.customInstructions ?? '{}')
		expect(Object.keys(ci).sort()).toEqual(['keyID', 'protocolID'])
		// nothing filed in the token's own basket yet
		expect(
			internalized[0].outputs.map((o) => o.insertionRemittance?.basket),
		).toEqual([MANDALA_BASKET])
		expect(mandalaTokenBasket(res.txid as string)).toBe(res.txid as string)
		expect(ci.protocolID).toEqual(MANDALA_PROTOCOL)

		const tx = Transaction.fromAtomicBEEF(internalized[0].tx)
		const expected = Mandala.deployAuthority({
			lock: await derivedLock(ci),
			payload: { sym: 'STABLE', dec: 2, icon: 1 },
		})
		expect(tx.outputs[0].lockingScript.toHex()).toBe(expected.lock().toHex())
		const decoded = Mandala.decode(tx.outputs[0].lockingScript as Script)
		expect(decoded?.role).toBe('deploy')
		expect(decoded?.amount).toBe(0n)
	})
})

describe('deployMandala overlay', () => {
	const realFetch = globalThis.fetch
	afterEach(() => {
		globalThis.fetch = realFetch
	})

	test('broadcasts as a BRC-22 submit to tm_mandala and tm_<txid>, not postBeef', async () => {
		const submits: { url: string; topics: string | null }[] = []
		globalThis.fetch = (async (
			url: string | URL | Request,
			init?: RequestInit,
		) => {
			const u = String(url)
			if (u.endsWith('/submit')) {
				submits.push({
					url: u,
					topics: new Headers(init?.headers).get('x-topics'),
				})
				return new Response(
					JSON.stringify({
						[MANDALA_TOPIC]: { outputsToAdmit: [0], coinsToRetain: [] },
					}),
					{ status: 200 },
				)
			}
			// fee policy lookup: fail so LivePolicy uses its default rate
			return new Response('', { status: 404 })
		}) as typeof fetch

		let postBeefCalls = 0
		const internalized: InternalizeActionArgs[] = []
		const wallet: Partial<WalletInterface> = {
			getPublicKey: (a) => proto.getPublicKey(a),
			createSignature: (a) => proto.createSignature(a),
			createAction: async (args) => {
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
			services: {
				postBeef: async () => {
					postBeefCalls++
					return []
				},
			},
		} as unknown as OneSatContext

		const res = await deployMandala.execute(ctx, {
			amount: '1000',
			symbol: 'OVL',
			overlay: 'https://overlay.example/',
		})

		expect(res.error).toBeUndefined()
		expect(res.tokenId).toBe(res.txid as string)
		expect(postBeefCalls).toBe(0)
		expect(submits).toEqual([
			{
				url: 'https://overlay.example/submit',
				topics: `${MANDALA_TOPIC},tm_${res.txid}`,
			},
		])
		expect(internalized).toHaveLength(1)
	})
})

describe('deployMandala filing', () => {
	test('an address destination files the deploy with no customInstructions', async () => {
		const { ctx, fundingProvider, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '5',
			destination: {
				address: PrivateKey.fromHex('06'.repeat(32)).toPublicKey().toAddress(),
			},
			fundingProvider,
		})
		expect(res.error).toBeUndefined()
		expect(res.tx).toBeDefined()
		const remit = internalized[0].outputs[0].insertionRemittance
		expect(remit?.basket).toBe(MANDALA_BASKET)
		expect(remit?.customInstructions).toBeUndefined()
	})

	test('mandalaTokenBasket is the bare lowercase token id', () => {
		expect(mandalaTokenBasket('AB'.repeat(32))).toBe('ab'.repeat(32))
	})
})
