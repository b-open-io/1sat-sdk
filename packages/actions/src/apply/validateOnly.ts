import type { CreateActionArgs, WalletInterface } from '@bsv/sdk'

/**
 * Validate-only apply: no rewrite. Most intents only need module re-lookup
 * for the prompt; tx shape is already built by the action.
 */
export async function applyValidateOnly(
	_wallet: WalletInterface,
	_args: CreateActionArgs,
): Promise<void> {
	// no-op
}
