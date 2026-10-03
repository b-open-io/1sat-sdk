import { describe, expect, it } from 'bun:test'
import { ORDLOCK_LISTING_CREATE_DISABLED, P1SAT_PROTOCOL } from '@1sat/types'
import {
	KeyDeriver,
	type LockingScript,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	Script,
	Spend,
	Transaction,
	Utils,
} from '@bsv/sdk'
import OrdLock, { ORDLOCK_PREFIX, ORDLOCK_SUFFIX } from './ordlock.js'

/** Builds a v1 listing script the way lock() did before listing create was disabled. */
function v1Lock(cancelAddress: string, payAddress: string, price: number) {
	const cancelPkh = Utils.fromBase58Check(cancelAddress).data as number[]
	const payPkh = Utils.fromBase58Check(payAddress).data as number[]
	return new Script()
		.writeScript(Script.fromBinary(ORDLOCK_PREFIX))
		.writeBin(cancelPkh)
		.writeBin(OrdLock.buildOutput(price, new P2PKH().lock(payPkh).toBinary()))
		.writeScript(Script.fromBinary(ORDLOCK_SUFFIX))
}

/** Runs the script interpreter over a signed input; throws on failure. */
function spendValidates(tx: Transaction, inputIndex: number): boolean {
	const input = tx.inputs[inputIndex]
	const src = input.sourceTransaction as Transaction
	const out = src.outputs[input.sourceOutputIndex]
	return new Spend({
		sourceTXID: src.id('hex'),
		sourceOutputIndex: input.sourceOutputIndex,
		lockingScript: out.lockingScript,
		sourceSatoshis: out.satoshis as number,
		transactionVersion: tx.version,
		otherInputs: tx.inputs.filter((_, i) => i !== inputIndex),
		unlockingScript: input.unlockingScript as Script,
		inputSequence: input.sequence ?? 0xffffffff,
		inputIndex,
		outputs: tx.outputs,
		lockTime: tx.lockTime,
	}).validate()
}

describe('OrdLock listing create disable (OPL-4690)', () => {
	it('lock() refuses new listing scripts', () => {
		expect(() =>
			OrdLock.lock(
				'1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
				'1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
				1000,
			),
		).toThrow(ORDLOCK_LISTING_CREATE_DISABLED)
	})

	it('buy/cancel helpers remain exported', () => {
		expect(typeof OrdLock.decode).toBe('function')
		expect(typeof OrdLock.isOrdLock).toBe('function')
		expect(typeof OrdLock.cancelListing).toBe('function')
		expect(typeof OrdLock.cancelWithWallet).toBe('function')
		expect(typeof OrdLock.purchaseListing).toBe('function')
	})
})

describe('OrdLock cancel', () => {
	it('cancelWithWallet() produces an unlock that passes the interpreter', async () => {
		const rootKey = new PrivateKey(5005)
		const wallet = new ProtoWallet(rootKey)
		const protocolID = P1SAT_PROTOCOL
		const keyID = 'abc_0'
		const { publicKey } = await wallet.getPublicKey({
			protocolID,
			keyID,
			counterparty: 'self',
			forSelf: true,
		})
		const cancelAddr = PublicKey.fromString(publicKey).toAddress()
		const payAddr = new PrivateKey(5006).toAddress()
		const lock = v1Lock(cancelAddr, payAddr, 1000)
		expect(OrdLock.decode(lock)).not.toBeNull()

		const listing = new Transaction()
		listing.addOutput({ satoshis: 1, lockingScript: lock as LockingScript })
		const tx = new Transaction()
		tx.addInput({
			sourceTransaction: listing,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: OrdLock.cancelWithWallet(
				wallet,
				protocolID,
				keyID,
			),
		})
		tx.addOutput({ satoshis: 1, lockingScript: new P2PKH().lock(cancelAddr) })
		await tx.sign()

		const unlock = tx.inputs[0].unlockingScript as Script
		expect(OrdLock.isPurchase(unlock)).toBe(false)
		expect(Utils.toHex(unlock.chunks[1].data ?? [])).toBe(publicKey)
		expect(spendValidates(tx, 0)).toBe(true)

		const derivedKey = new KeyDeriver(rootKey).derivePrivateKey(
			protocolID,
			keyID,
			'self',
		)
		const rawUnlock = await OrdLock.cancelListing(derivedKey, 'all', true).sign(
			tx,
			0,
		)
		expect(unlock.toHex()).toBe(rawUnlock.toHex())
	})
})
