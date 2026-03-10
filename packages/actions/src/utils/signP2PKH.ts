import {
	Hash,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletProtocol,
} from '@bsv/sdk'
import type { OneSatContext } from '../types'

/**
 * Sign a P2PKH input using the wallet's key derivation.
 * Returns the unlocking script hex for the input.
 */
export async function signP2PKHInput(
	ctx: OneSatContext,
	tx: Transaction,
	inputIndex: number,
	protocolID: WalletProtocol,
	keyID: string,
): Promise<string | { error: string }> {
	const txInput = tx.inputs[inputIndex]

	const sourceLockingScript =
		txInput.sourceTransaction?.outputs[txInput.sourceOutputIndex]?.lockingScript
	if (!sourceLockingScript) {
		return { error: `missing-source-locking-script-for-input-${inputIndex}` }
	}

	const sourceTXID = txInput.sourceTXID ?? txInput.sourceTransaction?.id('hex')
	if (!sourceTXID) {
		return { error: `missing-source-txid-for-input-${inputIndex}` }
	}

	const sourceSatoshis =
		txInput.sourceTransaction?.outputs[txInput.sourceOutputIndex]?.satoshis ?? 1
	const preimage = TransactionSignature.format({
		sourceTXID,
		sourceOutputIndex: txInput.sourceOutputIndex,
		sourceSatoshis,
		transactionVersion: tx.version,
		otherInputs: tx.inputs
			.filter((_, idx) => idx !== inputIndex)
			.map((inp) => ({
				sourceTXID: inp.sourceTXID ?? inp.sourceTransaction?.id('hex') ?? '',
				sourceOutputIndex: inp.sourceOutputIndex,
				sequence: inp.sequence ?? 0xffffffff,
			})),
		inputIndex,
		outputs: tx.outputs,
		inputSequence: txInput.sequence ?? 0xffffffff,
		subscript: sourceLockingScript,
		lockTime: tx.lockTime,
		scope:
			TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID,
	})

	const sighash = Hash.sha256(Hash.sha256(preimage))

	const { signature } = await ctx.wallet.createSignature({
		protocolID,
		keyID,
		counterparty: 'self',
		hashToDirectlySign: Array.from(sighash),
	})

	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID,
		keyID,
		forSelf: true,
	})

	const sigWithHashtype = [
		...signature,
		TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID,
	]

	return new UnlockingScript()
		.writeBin(sigWithHashtype)
		.writeBin(Utils.toArray(publicKey, 'hex'))
		.toHex()
}
