import { describe, expect, it } from 'bun:test'
import { OrdLockV2 } from '@1sat/templates'
import { P1SAT_PROTOCOL } from '@1sat/types'
import {
	type LockingScript,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	Script,
	Transaction,
	type WalletInterface,
} from '@bsv/sdk'
import { deliveryTargetsFromArgs } from './spendTargets.js'
import { unlockByScript } from './unlockInput.js'

const buyerKey = new PrivateKey(7001)
const buyerAddr = buyerKey.toAddress()
const buyerLock = new P2PKH().lock(buyerAddr)
const payAddr = new PrivateKey(7002).toAddress()

// ProtoWallet implements only the key/signature half of WalletInterface,
// which is all unlockByScript touches.
function asWallet(w: ProtoWallet): WalletInterface {
	return w as unknown as WalletInterface
}

async function v2Listing(wallet: ProtoWallet, keyID: string) {
	const { publicKey } = await wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: 'self',
		forSelf: true,
	})
	const lock = OrdLockV2.lock(
		PublicKey.fromString(publicKey).toAddress(),
		payAddr,
		5000,
	)
	// output 0: buyer front funding · output 1: the listing
	const listing = new Transaction()
	listing.addOutput({ satoshis: 20_000, lockingScript: buyerLock })
	listing.addOutput({ satoshis: 1, lockingScript: lock as LockingScript })
	return { listing, lock }
}

/** Canonical layout: 0 front · 1 listing → 0 cushion · 1 payout · 2 receive */
function canonicalPurchase(listing: Transaction, lock: Script) {
	const tx = new Transaction()
	tx.addInput({ sourceTransaction: listing, sourceOutputIndex: 0 })
	tx.addInput({ sourceTransaction: listing, sourceOutputIndex: 1 })
	tx.addOutput({ satoshis: 15_000, lockingScript: buyerLock })
	tx.addOutput(OrdLockV2.payoutOutput(lock))
	tx.addOutput({ satoshis: 1, lockingScript: buyerLock })
	return tx
}

describe('unlockByScript: OrdLock v2', () => {
	it('cancels when key CI is present', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7003))
		const keyID = 'abc_1'
		const { listing, lock } = await v2Listing(wallet, keyID)
		const tx = new Transaction()
		tx.addInput({ sourceTransaction: listing, sourceOutputIndex: 1 })
		tx.addOutput({ satoshis: 1, lockingScript: buyerLock })

		const res = await unlockByScript(
			asWallet(wallet),
			tx,
			0,
			lock as LockingScript,
			1,
			{
				protocolID: P1SAT_PROTOCOL,
				keyID,
			},
		)
		expect('unlockingScript' in res).toBe(true)
		if (!('unlockingScript' in res)) throw new Error(res.error)
		expect(OrdLockV2.isCancel(Script.fromHex(res.unlockingScript))).toBe(true)
	})

	it('purchases when no key CI, the payout sits at the listing index and the ordinal reaches an approved output', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7004))
		const { listing, lock } = await v2Listing(wallet, 'abc_2')
		const tx = canonicalPurchase(listing, lock)
		const deliveries = deliveryTargetsFromArgs({
			outputs: [
				{
					lockingScript: buyerLock.toHex(),
					satoshis: 15_000,
					outputDescription: 'cushion',
				},
				{
					lockingScript: OrdLockV2.payoutOutput(lock).lockingScript.toHex(),
					satoshis: 5000,
					outputDescription: 'payout',
				},
				{
					lockingScript: buyerLock.toHex(),
					satoshis: 1,
					outputDescription: 'ordinal',
					basket: '1sat',
				},
			],
		})
		expect(deliveries.map((d) => d.vout)).toEqual([2])

		const res = await unlockByScript(
			asWallet(wallet),
			tx,
			1,
			lock as LockingScript,
			1,
			undefined,
			deliveries,
		)
		if (!('unlockingScript' in res)) throw new Error(res.error)
		expect(OrdLockV2.isPurchase(Script.fromHex(res.unlockingScript))).toBe(true)
	})

	it('returns an error, not a v1 attempt, when the payout is not at the listing index', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7005))
		const { listing, lock } = await v2Listing(wallet, 'abc_3')
		const tx = new Transaction()
		// ordinal-first layout of the withdrawn draft: listing at input 0 but
		// the buyer output, not the payout, at output 0
		tx.addInput({ sourceTransaction: listing, sourceOutputIndex: 1 })
		tx.addInput({ sourceTransaction: listing, sourceOutputIndex: 0 })
		tx.addOutput({ satoshis: 1, lockingScript: buyerLock })
		tx.addOutput(OrdLockV2.payoutOutput(lock))
		tx.addOutput({ satoshis: 14_000, lockingScript: buyerLock })

		const res = await unlockByScript(
			asWallet(wallet),
			tx,
			0,
			lock as LockingScript,
			1,
		)
		expect(
			'error' in res && /output 0 must be the listing payout/.test(res.error),
		).toBe(true)
	})

	it('returns an error when the ordinal would reach an unapproved output', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7006))
		const { listing, lock } = await v2Listing(wallet, 'abc_4')
		const tx = canonicalPurchase(listing, lock)
		const other = new P2PKH().lock(new PrivateKey(7007).toAddress())
		const res = await unlockByScript(
			asWallet(wallet),
			tx,
			1,
			lock as LockingScript,
			1,
			undefined,
			[{ vout: 2, lockingScript: other }],
		)
		expect(
			'error' in res && /not an approved receive output/.test(res.error),
		).toBe(true)
	})
})
