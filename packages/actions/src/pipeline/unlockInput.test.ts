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
import { unlockByScript } from './unlockInput.js'

const buyerKey = new PrivateKey(7001)
const buyerAddr = buyerKey.toAddress()
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
	const listing = new Transaction()
	listing.addOutput({ satoshis: 1, lockingScript: lock as LockingScript })
	return { listing, lock }
}

describe('unlockByScript: OrdLock v2', () => {
	it('cancels when key CI is present', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7003))
		const keyID = 'abc_1'
		const { listing, lock } = await v2Listing(wallet, keyID)
		const tx = new Transaction()
		tx.addInput({ sourceTransaction: listing, sourceOutputIndex: 0 })
		tx.addOutput({ satoshis: 1, lockingScript: new P2PKH().lock(buyerAddr) })

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

	it('purchases when no key CI and the payout+tag pair is present', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7004))
		const { listing, lock } = await v2Listing(wallet, 'abc_2')
		const tx = new Transaction()
		tx.addInput({ sourceTransaction: listing, sourceOutputIndex: 0 })
		tx.addOutput({ satoshis: 1, lockingScript: new P2PKH().lock(buyerAddr) })
		tx.addOutput(OrdLockV2.payoutOutput(lock))
		tx.addOutput(OrdLockV2.tagOutput(listing.id('hex'), 0))
		tx.addOutput({ satoshis: 900, lockingScript: new P2PKH().lock(buyerAddr) })

		const res = await unlockByScript(
			asWallet(wallet),
			tx,
			0,
			lock as LockingScript,
			1,
		)
		if (!('unlockingScript' in res)) throw new Error(res.error)
		expect(OrdLockV2.isPurchase(Script.fromHex(res.unlockingScript))).toBe(true)
	})

	it('returns an error, not a v1 attempt, when the tag output is missing', async () => {
		const wallet = new ProtoWallet(new PrivateKey(7005))
		const { listing, lock } = await v2Listing(wallet, 'abc_3')
		const tx = new Transaction()
		tx.addInput({ sourceTransaction: listing, sourceOutputIndex: 0 })
		tx.addOutput({ satoshis: 1, lockingScript: new P2PKH().lock(buyerAddr) })
		tx.addOutput(OrdLockV2.payoutOutput(lock))

		const res = await unlockByScript(
			asWallet(wallet),
			tx,
			0,
			lock as LockingScript,
			1,
		)
		expect(
			'error' in res && /payout immediately followed/.test(res.error),
		).toBe(true)
	})
})
