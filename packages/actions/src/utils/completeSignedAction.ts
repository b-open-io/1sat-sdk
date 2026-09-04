import {
	Beef,
	type CreateActionResult,
	type SignActionOptions,
	type SignActionResult,
	Transaction,
	type WalletInterface,
} from '@bsv/sdk'
import { assertValidInputUnlock } from './verifyInputUnlock.js'

export interface CompleteSignedActionResult {
	txid?: string
	tx?: number[]
	noSendChange?: string[]
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
 * Inspect the broadcast results returned by signAction. When
 * `acceptDelayedBroadcast: false` is in effect, a correctly behaving
 * wallet-toolbox server already throws `WERR_REVIEW_ACTIONS` on any
 * non-'unproven' outcome. This second pass catches the case where
 * signAction returns results without throwing (e.g. a remote deploy
 * whose postBeef optimistically reports success).
 */
function findBroadcastError(r: SignActionResult): string | undefined {
	const swrs = (r as { sendWithResults?: Array<{ status: string }> })
		.sendWithResults
	const ndrs = (r as { notDelayedResults?: Array<{ status: string }> })
		.notDelayedResults

	if (swrs && swrs.length > 0) {
		for (const swr of swrs) {
			if (swr.status !== 'unproven') {
				return `broadcast-${swr.status}`
			}
		}
	}
	if (ndrs && ndrs.length > 0) {
		for (const ndr of ndrs) {
			if (ndr.status !== 'success') {
				return `broadcast-${ndr.status}`
			}
		}
	}
	return undefined
}

/**
 * Complete a two-phase action: build verified BEEF, sign inputs, verify
 * scripts, then call signAction. Aborts on any failure before signAction
 * so the wallet-toolbox pending sign action entry and storage-side
 * `unsigned` transaction record are cleaned up (neither is swept
 * automatically, so a missed abort leaks allocated change outputs).
 *
 * @param wallet - BRC-100 wallet
 * @param createResult - Result from createAction with signAndProcess: false
 * @param inputBEEF - Optional BEEF for external inputs (merged with signable BEEF for verification). When omitted, only the signable BEEF is used.
 * @param sign - Callback that receives the verified tx and returns spends
 * @param options - Options for signAction
 */
export async function completeSignedAction(
	wallet: WalletInterface,
	createResult: CreateActionResult,
	inputBEEF: number[] | undefined,
	sign: SigningCallback,
	options?: SignActionOptions,
): Promise<CompleteSignedActionResult> {
	if (!createResult.signableTransaction) {
		return { error: 'no-signable-transaction' }
	}

	const reference = createResult.signableTransaction.reference

	// Local validation + signing: any unplanned throw here leaves the server
	// holding an 'unsigned' row with allocated change outputs, so abort on
	// exception. Broadcast rejection from signAction is NOT wrapped — the
	// server already transitions the tx to 'failed' and re-aborting would
	// just generate noise on an already-resolved record.
	let spends: Record<number, { unlockingScript: string }>
	try {
		const signableBeef = Beef.fromBinary(createResult.signableTransaction.tx)
		const signingTx = Transaction.fromBEEF(createResult.signableTransaction.tx)

		// When inputBEEF is provided, merge it with the signable BEEF so source
		// transactions for external inputs are available for signing and verification.
		// When absent, the signable BEEF alone is sufficient (wallet-only inputs).
		const beef = inputBEEF ? Beef.fromBinary(inputBEEF) : signableBeef
		if (inputBEEF) {
			beef.mergeBeef(signableBeef)
		}
		const tx = beef.findAtomicTransaction(signingTx.id('hex'))
		if (!tx) {
			await wallet.abortAction({ reference })
			return { error: 'failed-to-build-verification-beef' }
		}

		// Let the caller build unlocking scripts using the fully-wired tx
		spends = await sign(tx)

		// Apply unlocking scripts and verify only the inputs we signed.
		// Funding inputs are unsigned at this point — the wallet signs them during signAction.
		for (const [idx, spend] of Object.entries(spends)) {
			const i = Number(idx)
			try {
				assertValidInputUnlock(tx, i, spend.unlockingScript)
			} catch (error) {
				await wallet.abortAction({ reference })
				return {
					error: error instanceof Error ? error.message : `invalid-input-${i}`,
				}
			}
		}
	} catch (error) {
		await wallet.abortAction({ reference }).catch(() => {})
		throw error
	}

	const signResult = await wallet.signAction({
		reference,
		spends,
		options: { acceptDelayedBroadcast: false, ...options },
	})

	if ('error' in signResult) {
		return { error: String(signResult.error) }
	}

	const broadcastError = findBroadcastError(signResult)
	if (broadcastError) {
		return { error: broadcastError }
	}

	return {
		txid: signResult.txid,
		tx: signResult.tx ? Array.from(signResult.tx) : undefined,
		noSendChange: createResult.noSendChange,
	}
}
