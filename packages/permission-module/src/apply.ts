/**
 * Module-side apply entry. Crypto always uses the module's base wallet
 * (never the gated WPM wrapper). Implementations live in @1sat/actions.
 */
import { applyP1SatIntent } from '@1sat/actions'
import type { CreateActionArgs, WalletInterface } from '@bsv/sdk'

export async function applyCreateAction(
	baseWallet: WalletInterface,
	args: CreateActionArgs,
	intent?: string,
): Promise<void> {
	await applyP1SatIntent(baseWallet, args, intent)
}
