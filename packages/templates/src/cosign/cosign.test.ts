import { describe, expect, it } from 'bun:test'
import {
	Hash,
	PrivateKey,
	Spend,
	Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
} from '@bsv/sdk'
import Cosign from './cosign.js'

function sighashFromPreimage(preimage: number[]): number[] {
	// Spend interpreter signs single-SHA256 of the preimage (it adds the second SHA-256 internally during verification)
	return Hash.sha256(preimage)
}

const SCOPE =
	TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID

function compressedPubKeyHex(priv: PrivateKey): string {
	return Utils.toHex(priv.toPublicKey().encode(true) as number[])
}

describe('Cosign template', () => {
	const ownerKey = PrivateKey.fromRandom()
	const ownerAddress = ownerKey.toPublicKey().toAddress()
	const cosignerKey = PrivateKey.fromRandom()
	const cosignerPubKeyHex = compressedPubKeyHex(cosignerKey)

	it('lock + decode round-trip preserves address and cosigner pubkey', () => {
		const lockingScript = Cosign.lock(ownerAddress, cosignerPubKeyHex)
		const decoded = Cosign.decode(lockingScript)
		expect(decoded).not.toBeNull()
		expect(decoded?.address).toBe(ownerAddress)
		expect(decoded?.cosigner).toBe(cosignerPubKeyHex)
		expect(Cosign.isCosign(lockingScript)).toBe(true)
	})

	it('lock rejects an address with the wrong pkhash length', () => {
		expect(() => Cosign.lock('1', cosignerPubKeyHex)).toThrow()
	})

	it('lock rejects a non-33-byte cosigner pubkey', () => {
		expect(() => Cosign.lock(ownerAddress, '00')).toThrow()
		// uncompressed (65 byte) is also invalid for our cosign template
		const uncompressed = Utils.toHex(
			ownerKey.toPublicKey().encode(false) as number[],
		)
		expect(() => Cosign.lock(ownerAddress, uncompressed)).toThrow()
	})

	it('full unlock validates against the script interpreter', () => {
		const lockingScript = Cosign.lock(ownerAddress, cosignerPubKeyHex)

		// Build a synthetic source tx with a single cosign output
		const sourceTx = new Transaction()
		sourceTx.addOutput({ lockingScript, satoshis: 1 })
		const sourceTxid = sourceTx.id('hex')

		// Build the spending tx: one input pointing at the cosign output, one trivial output.
		const spendTx = new Transaction()
		spendTx.addInput({
			sourceTransaction: sourceTx,
			sourceTXID: sourceTxid,
			sourceOutputIndex: 0,
			unlockingScript: new UnlockingScript(),
			sequence: 0xffffffff,
		})
		spendTx.addOutput({ lockingScript: new UnlockingScript(), satoshis: 1 })

		// Compute the sighash for the cosign input
		const preimage = TransactionSignature.format({
			sourceTXID: sourceTxid,
			sourceOutputIndex: 0,
			sourceSatoshis: 1,
			transactionVersion: spendTx.version,
			otherInputs: [],
			inputIndex: 0,
			outputs: spendTx.outputs,
			inputSequence: 0xffffffff,
			subscript: lockingScript,
			lockTime: spendTx.lockTime,
			scope: SCOPE,
		})

		// Sign with both keys against the same sighash
		const ownerSig = ownerKey
			.sign(sighashFromPreimage(preimage))
			.toDER() as number[]
		const cosignerSig = cosignerKey
			.sign(sighashFromPreimage(preimage))
			.toDER() as number[]

		// Build the unlock: <approverSig> <ownerSig> <ownerPubKey>
		const ownerPubKeyHex = compressedPubKeyHex(ownerKey)
		const ownerUnlock = Cosign.ownerUnlock(ownerSig, SCOPE, ownerPubKeyHex)
		const fullUnlock = Cosign.approverUnlock(cosignerSig, SCOPE, ownerUnlock)

		spendTx.inputs[0].unlockingScript = fullUnlock

		// Verify the script evaluates successfully
		const spendCheck = new Spend({
			sourceTXID: sourceTxid,
			sourceOutputIndex: 0,
			lockingScript,
			sourceSatoshis: 1,
			transactionVersion: spendTx.version,
			otherInputs: [],
			unlockingScript: fullUnlock,
			inputSequence: 0xffffffff,
			inputIndex: 0,
			outputs: spendTx.outputs,
			lockTime: spendTx.lockTime,
		})

		expect(spendCheck.validate()).toBe(true)
	})

	it('full unlock fails interpreter when the cosigner sig is wrong', () => {
		const lockingScript = Cosign.lock(ownerAddress, cosignerPubKeyHex)

		const sourceTx = new Transaction()
		sourceTx.addOutput({ lockingScript, satoshis: 1 })
		const sourceTxid = sourceTx.id('hex')

		const spendTx = new Transaction()
		spendTx.addInput({
			sourceTransaction: sourceTx,
			sourceTXID: sourceTxid,
			sourceOutputIndex: 0,
			unlockingScript: new UnlockingScript(),
			sequence: 0xffffffff,
		})
		spendTx.addOutput({ lockingScript: new UnlockingScript(), satoshis: 1 })

		const preimage = TransactionSignature.format({
			sourceTXID: sourceTxid,
			sourceOutputIndex: 0,
			sourceSatoshis: 1,
			transactionVersion: spendTx.version,
			otherInputs: [],
			inputIndex: 0,
			outputs: spendTx.outputs,
			inputSequence: 0xffffffff,
			subscript: lockingScript,
			lockTime: spendTx.lockTime,
			scope: SCOPE,
		})

		const ownerSig = ownerKey
			.sign(sighashFromPreimage(preimage))
			.toDER() as number[]
		// Sign the approver portion with the OWNER key by mistake — should fail CHECKSIG
		const wrongCosignerSig = ownerKey
			.sign(sighashFromPreimage(preimage))
			.toDER() as number[]

		const ownerPubKeyHex = compressedPubKeyHex(ownerKey)
		const ownerUnlock = Cosign.ownerUnlock(ownerSig, SCOPE, ownerPubKeyHex)
		const fullUnlock = Cosign.approverUnlock(
			wrongCosignerSig,
			SCOPE,
			ownerUnlock,
		)

		spendTx.inputs[0].unlockingScript = fullUnlock

		const spendCheck = new Spend({
			sourceTXID: sourceTxid,
			sourceOutputIndex: 0,
			lockingScript,
			sourceSatoshis: 1,
			transactionVersion: spendTx.version,
			otherInputs: [],
			unlockingScript: fullUnlock,
			inputSequence: 0xffffffff,
			inputIndex: 0,
			outputs: spendTx.outputs,
			lockTime: spendTx.lockTime,
		})

		// Wrong cosigner sig must fail validation
		let validates = false
		try {
			validates = spendCheck.validate()
		} catch {
			validates = false
		}
		expect(validates).toBe(false)
	})
})
