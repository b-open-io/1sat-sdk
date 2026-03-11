import {
	Beef,
	Script,
	Transaction,
	Utils,
	type CreateActionResult,
	type SignActionOptions,
	type WalletInterface,
} from '@bsv/sdk'

export interface CompleteSignedActionResult {
	txid?: string
	rawtx?: string
	error?: string
}

/**
 * Signing callback that receives the verified tx and returns unlocking scripts.
 * The tx has full source transaction data (with merkle proofs) wired up.
 */
export type SigningCallback = (
	tx: Transaction,
) => Promise<Record<number, { unlockingScript: string }>>

/**
 * Complete a two-phase action: build verified BEEF, sign inputs, verify
 * scripts, then call signAction. Aborts on any failure.
 *
 * @param wallet - BRC-100 wallet
 * @param createResult - Result from createAction with signAndProcess: false
 * @param inputBEEF - Original BEEF with full merkle proofs
 * @param sign - Callback that receives the verified tx and returns spends
 * @param options - Options for signAction
 */
export async function completeSignedAction(
	wallet: WalletInterface,
	createResult: CreateActionResult,
	inputBEEF: number[],
	sign: SigningCallback,
	options?: SignActionOptions,
): Promise<CompleteSignedActionResult> {
	if (!createResult.signableTransaction) {
		return { error: 'no-signable-transaction' }
	}

	const reference = createResult.signableTransaction.reference

	try {
		// Build complete BEEF by merging the unsigned tx into inputBEEF (which has merkle proofs).
		// The signableTransaction BEEF only contains raw txs without proofs.
		const signingTx = Transaction.fromBEEF(createResult.signableTransaction.tx)
		const beef = Beef.fromBinary(inputBEEF)
		beef.mergeRawTx(signingTx.toBinary())
		const tx = beef.findAtomicTransaction(signingTx.id('hex'))
		if (!tx) {
			await wallet.abortAction({ reference })
			return { error: 'failed-to-build-verification-beef' }
		}

		// Let the caller build unlocking scripts using the fully-wired tx
		const spends = await sign(tx)

		// Apply unlocking scripts and verify
		for (const [idx, spend] of Object.entries(spends)) {
			tx.inputs[Number(idx)].unlockingScript = Script.fromHex(spend.unlockingScript)
		}

		const valid = await tx.verify('scripts only')
		if (!valid) {
			await wallet.abortAction({ reference })
			return { error: 'transaction-verification-failed' }
		}

		const signResult = await wallet.signAction({
			reference,
			spends,
			options: { acceptDelayedBroadcast: false, ...options },
		})

		if ('error' in signResult) {
			return { error: String(signResult.error) }
		}

		return {
			txid: signResult.txid,
			rawtx: signResult.tx ? Utils.toHex(signResult.tx) : undefined,
		}
	} catch (error) {
		await wallet.abortAction({ reference }).catch(() => {})
		throw error
	}
}
