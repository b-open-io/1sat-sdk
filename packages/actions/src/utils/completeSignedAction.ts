import {
	Beef,
	type CreateActionResult,
	Script,
	type SignActionOptions,
	Spend,
	Transaction,
	Utils,
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
		// Build complete BEEF by merging the signable transaction BEEF (which has funding
		// input proof chains) into inputBEEF (which has ordinal/asset proof chains).
		const signableBeef = Beef.fromBinary(createResult.signableTransaction.tx)
		const signingTx = Transaction.fromBEEF(createResult.signableTransaction.tx)
		const beef = Beef.fromBinary(inputBEEF)
		beef.mergeBeef(signableBeef)
		const tx = beef.findAtomicTransaction(signingTx.id('hex'))
		if (!tx) {
			await wallet.abortAction({ reference })
			return { error: 'failed-to-build-verification-beef' }
		}

		// Let the caller build unlocking scripts using the fully-wired tx
		const spends = await sign(tx)

		// Apply unlocking scripts and verify only the inputs we signed.
		// Funding inputs are unsigned at this point — the wallet signs them during signAction.
		for (const [idx, spend] of Object.entries(spends)) {
			const i = Number(idx)
			tx.inputs[i].unlockingScript = Script.fromHex(spend.unlockingScript)

			const input = tx.inputs[i]
			const sourceOutput =
				input.sourceTransaction?.outputs[input.sourceOutputIndex]
			if (!sourceOutput) {
				await wallet.abortAction({ reference })
				return { error: `missing-source-transaction-for-input-${i}` }
			}

			const unlockingScript = tx.inputs[i].unlockingScript!
			const spendCheck = new Spend({
				sourceTXID:
					input.sourceTXID ?? input.sourceTransaction?.id('hex') ?? '',
				sourceOutputIndex: input.sourceOutputIndex,
				lockingScript: sourceOutput.lockingScript,
				sourceSatoshis: sourceOutput.satoshis ?? 0,
				transactionVersion: tx.version,
				otherInputs: tx.inputs.filter((_, j) => j !== i),
				unlockingScript,
				inputSequence: input.sequence ?? 0xffffffff,
				inputIndex: i,
				outputs: tx.outputs,
				lockTime: tx.lockTime,
			})

			if (!spendCheck.validate()) {
				await wallet.abortAction({ reference })
				return { error: `script-verification-failed-for-input-${i}` }
			}
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
