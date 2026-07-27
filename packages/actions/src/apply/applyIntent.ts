import { parseIntentLabel } from '@1sat/types'
import type { CreateActionArgs, WalletInterface } from '@bsv/sdk'
import { P1SAT_APPLY_REGISTRY } from './registry'
import { stampScriptDerivedTags } from './stampScriptTags'

/**
 * Dispatch apply by intent, then stamp script-derived tags.
 *
 * Its own module so both callers share it without a cycle: `index.ts`
 * re-exports it, and `prepare.ts` (the base-wallet path) calls it. Reaching for
 * `P1SAT_APPLY_REGISTRY` directly instead skips the stamping — that is exactly
 * the bug this split exists to prevent.
 *
 * Mutates `args` in place (never replace inputs/outputs arrays). Unknown
 * labeled intents fail closed.
 *
 * @param wallet - Base wallet only (field-sig / nested CA must not hit WPM)
 * @param args - createAction args to mutate
 * @param intent - Explicit intent; falls back to `p 1sat intent …` label
 */
export async function applyP1SatIntent(
	wallet: WalletInterface,
	args: CreateActionArgs,
	intent?: string,
): Promise<void> {
	const resolved = intent ?? parseIntentLabel(args.labels)

	if (resolved) {
		const fn = P1SAT_APPLY_REGISTRY[resolved]
		if (!fn) {
			throw new Error(`1Sat apply: unknown intent "${resolved}"`)
		}
		await fn(wallet, args)
	}

	// After apply, so seals (PushDrop, sigma) are already on the outputs and the
	// tags are stamped from the scripts that will actually be committed.
	stampScriptDerivedTags(args)
}
