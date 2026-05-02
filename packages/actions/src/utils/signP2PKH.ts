import {
	Hash,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletCounterparty,
	type WalletProtocol,
} from '@bsv/sdk'
import type { OneSatContext } from '../types'

/**
 * Sign a P2PKH input using the wallet's key derivation.
 *
 * `counterparty` selects the BRC-43 derivation peer:
 *   - `'self'` (default) — output was self-derived; the wallet signs with
 *     its own (privKey × protocolID × keyID).
 *   - `<pubKey hex>` — output was sent to this wallet by a counterparty
 *     (BRC-29 receive). The wallet derives the spend privkey via
 *     (privKey × counterpartyPub × protocolID × keyID) and the unlock
 *     pubkey is the matching shared key — `forSelf: false`.
 *
 * Outputs whose customInstructions were recorded without a counterparty
 * field continue to default to `'self'`, preserving the legacy behavior.
 *
 * Returns the unlocking script hex for the input.
 */
export async function signP2PKHInput(
	ctx: OneSatContext,
	tx: Transaction,
	inputIndex: number,
	protocolID: WalletProtocol,
	keyID: string,
	counterparty: WalletCounterparty = 'self',
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

	const isSelf = counterparty === 'self'

	const { signature } = await ctx.wallet.createSignature({
		protocolID,
		keyID,
		counterparty,
		hashToDirectlySign: Array.from(sighash),
	})

	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID,
		keyID,
		counterparty,
		forSelf: isSelf,
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
