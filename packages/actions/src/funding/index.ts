import type { AtomicBEEF, CreateActionArgs } from '@bsv/sdk'

/**
 * External funding provider for actions where a third party pays
 * for the transaction instead of the wallet.
 *
 * Receives the full CreateActionArgs so it can build the exact transaction
 * the caller described (inputs, outputs, ordering), adding its own funding.
 *
 * Implementations handle funding strategy (free tier, metered, paid plans, etc.)
 * and return the broadcasted transaction as BEEF for wallet internalization.
 */
export interface FundingProvider {
	/**
	 * Build, fund, and broadcast a transaction from the given action args.
	 *
	 * @param args - Full CreateActionArgs (inputs, outputs, options)
	 * @returns txid and BEEF of the broadcasted transaction
	 */
	fund(args: CreateActionArgs): Promise<FundingResult>
}

export interface FundingResult {
	txid: string
	tx: AtomicBEEF
}
