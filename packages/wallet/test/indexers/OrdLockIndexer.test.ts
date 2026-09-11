import { describe, expect, it } from 'bun:test'
import { OrdLock, OrdLockV2 } from '@1sat/templates'
import {
	ORDLOCK_V2_TAG,
	ORD_LOCK_PREFIX,
	ORD_LOCK_SUFFIX,
	type ParseContext,
	type Txo,
} from '@1sat/types'
import {
	type LockingScript,
	P2PKH,
	PrivateKey,
	Script,
	Transaction,
	Utils,
} from '@bsv/sdk'
import { OrdLockIndexer } from '../../src/indexers/OrdLockIndexer'
import { Outpoint } from '../../src/indexers/Outpoint'

const seller = new PrivateKey(31337).toAddress()
const sellerPkh = Utils.fromBase58Check(seller).data as number[]
const txid = 'bb'.repeat(32)

function v1Lock(price: number): Script {
	const payout = OrdLock.buildOutput(
		price,
		new P2PKH().lock(sellerPkh).toBinary(),
	)
	return Script.fromHex(
		`${ORD_LOCK_PREFIX}14${Utils.toHex(sellerPkh)}${Utils.toHex(payout).length / 2 === 34 ? '22' : ''}${Utils.toHex(payout)}${ORD_LOCK_SUFFIX}`,
	)
}

const makeTxo = (lockingScript: Script): Txo => ({
	output: { satoshis: 1, lockingScript: lockingScript as LockingScript },
	outpoint: new Outpoint(txid, 0),
	owner: seller,
	data: {},
})

describe('OrdLockIndexer', () => {
	const indexer = new OrdLockIndexer(new Set([seller]), 'mainnet')

	it('tags a v2 listing ordlock2 with its price and seller', async () => {
		const result = await indexer.parse(
			makeTxo(OrdLockV2.lock(seller, seller, 4200)),
		)
		expect(result?.tags).toEqual([ORDLOCK_V2_TAG, 'price:4200'])
		expect(result?.owner).toBe(seller)
	})

	it('still tags a v1 listing ordlock', async () => {
		const result = await indexer.parse(makeTxo(v1Lock(1000)))
		expect(result?.tags).toEqual(['ordlock', 'price:1000'])
		expect(result?.owner).toBe(seller)
	})

	it('ignores non-listing scripts', async () => {
		const result = await indexer.parse(makeTxo(new P2PKH().lock(seller)))
		expect(result).toBeUndefined()
	})

	it('summarizes a v2 purchase as +1 and a v2 cancel as 0', async () => {
		const lock = OrdLockV2.lock(seller, seller, 4200)
		const listingTx = new Transaction()
		listingTx.addOutput({ satoshis: 1, lockingScript: lock as LockingScript })

		const buyer = new PrivateKey(31338).toAddress()
		const buy = new Transaction()
		buy.addInput({
			sourceTransaction: listingTx,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: OrdLockV2.purchaseListing(),
		})
		buy.addOutput({ satoshis: 1, lockingScript: new P2PKH().lock(buyer) })
		buy.addOutput(OrdLockV2.payoutOutput(lock))
		buy.addOutput(OrdLockV2.tagOutput(listingTx.id('hex'), 0))
		await buy.sign()

		const spendData = { list: { data: {}, tags: [] } }
		const purchaseCtx = {
			tx: buy,
			spends: [{ data: spendData }],
			txos: [],
		} as unknown as ParseContext
		expect(await indexer.summarize(purchaseCtx)).toEqual({ amount: 1 })

		const cancel = new Transaction()
		cancel.addInput({
			sourceTransaction: listingTx,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: OrdLockV2.cancelListing(new PrivateKey(31337)),
		})
		cancel.addOutput({ satoshis: 1, lockingScript: new P2PKH().lock(seller) })
		await cancel.sign()
		const cancelCtx = {
			tx: cancel,
			spends: [{ data: spendData }],
			txos: [],
		} as unknown as ParseContext
		expect(await indexer.summarize(cancelCtx)).toEqual({ amount: 0 })
	})
})
