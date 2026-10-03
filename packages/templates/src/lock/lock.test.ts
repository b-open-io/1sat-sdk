import { describe, expect, it } from 'bun:test'
import {
	KeyDeriver,
	type LockingScript,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	type Script,
	Spend,
	Transaction,
	type WalletProtocol,
} from '@bsv/sdk'
import Lock from './lock.js'

describe('Lock unlockWithWallet', () => {
	it('produces an unlock that passes the interpreter and matches the raw-key unlock', async () => {
		const rootKey = new PrivateKey(6006)
		const wallet = new ProtoWallet(rootKey)
		const protocolID: WalletProtocol = [1, 'lock test']
		const keyID = 'lock_0'
		const { publicKey } = await wallet.getPublicKey({
			protocolID,
			keyID,
			counterparty: 'self',
			forSelf: true,
		})
		const addr = PublicKey.fromString(publicKey).toAddress()
		const until = 800_000
		const lock = Lock.lock(addr, until)

		const source = new Transaction()
		source.addOutput({ satoshis: 1000, lockingScript: lock as LockingScript })
		const tx = new Transaction()
		tx.lockTime = until
		tx.addInput({
			sourceTransaction: source,
			sourceOutputIndex: 0,
			sequence: 0,
			unlockingScriptTemplate: Lock.unlockWithWallet(wallet, protocolID, keyID),
		})
		tx.addOutput({ satoshis: 900, lockingScript: new P2PKH().lock(addr) })
		await tx.sign()

		const unlock = tx.inputs[0].unlockingScript as Script
		expect(
			new Spend({
				sourceTXID: source.id('hex'),
				sourceOutputIndex: 0,
				lockingScript: lock,
				sourceSatoshis: 1000,
				transactionVersion: tx.version,
				otherInputs: [],
				unlockingScript: unlock,
				inputSequence: 0,
				inputIndex: 0,
				outputs: tx.outputs,
				lockTime: tx.lockTime,
			}).validate(),
		).toBe(true)

		const derivedKey = new KeyDeriver(rootKey).derivePrivateKey(
			protocolID,
			keyID,
			'self',
		)
		const rawUnlock = await Lock.unlock(derivedKey).sign(tx, 0)
		expect(unlock.toHex()).toBe(rawUnlock.toHex())
	})
})
