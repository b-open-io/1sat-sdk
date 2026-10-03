import { describe, expect, test } from 'bun:test'
import { Mandala } from '@1sat/templates'
import {
	MANDALA_AUTH_TAG,
	MANDALA_BASKET,
	MANDALA_DEPLOY_TAG,
	mandalaTokenTag,
} from '@1sat/types'
import {
	type CreateActionArgs,
	type InternalizeActionArgs,
	LockingScript,
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

async function derivedLock(ci: { protocolID: never; keyID: string }) {
	const { publicKey } = await proto.getPublicKey({
		protocolID: ci.protocolID,
		keyID: ci.keyID,
		counterparty: 'self',
		forSelf: true,
	})
	return new P2PKH().lock(PublicKey.fromString(publicKey).toAddress())
}

describe('deployMandala', () => {
	test('fixed supply: deploy at vout 0, filed under mandala:<txid>, tokenId = txid', async () => {
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
		expect(remit?.tags).toContain(mandalaTokenTag(res.txid as string))
		expect(remit?.tags).not.toContain(MANDALA_AUTH_TAG)
		expect(
			remit?.tags?.filter((t) => t.startsWith('mandala:') && t.includes('_')),
		).toEqual([])

		const ci = JSON.parse(remit?.customInstructions ?? '{}')
		expect(ci).toMatchObject({ amt: '21000000', dec: 8, sym: 'GOLD' })
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
				mandalaTokenTag(res.txid as string),
			]),
		)
		const ci = JSON.parse(remit?.customInstructions ?? '{}')
		expect(ci).toMatchObject({ amt: '0', dec: 2, sym: 'STABLE', icon: 1 })

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
