import type { CreateActionArgs, WalletInterface } from '@bsv/sdk'
import { applyP1SatCreateAction } from './applyIntent'

export type ApplyFn = (
	wallet: WalletInterface,
	args: CreateActionArgs,
) => Promise<void>

/**
 * @deprecated Intent registry retired — apply is script-driven via
 * {@link applyP1SatCreateAction}. Kept as a single default entry for any
 * leftover callers.
 */
export const P1SAT_APPLY_REGISTRY: Record<string, ApplyFn> = {
	default: async (wallet, args) => {
		await applyP1SatCreateAction(wallet, args)
	},
}
