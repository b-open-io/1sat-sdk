import { buildIntentLabel, parseIntentLabel } from '@1sat/types'
import type { CreateActionArgs } from '@bsv/sdk'
import type { OneSatContext } from '../types'
import { ensureActionId } from '../utils/createTrackedAction'
import { applyP1SatIntent } from './applyIntent'

/**
 * Attach intent + action-id labels and run apply when `ctx.isBaseWallet`.
 * Mutates `args` in place (labels + any apply rewrite).
 *
 * The action id is stamped here, ahead of apply, so both the base-wallet path
 * (apply below) and the gated path (apply inside the module) see the same
 * value and derive identical intermediate keyIDs.
 */
export async function prepareP1SatArgs(
	ctx: OneSatContext,
	args: CreateActionArgs,
	intent: string,
): Promise<CreateActionArgs> {
	const labels = args.labels ?? []
	if (!parseIntentLabel(labels)) {
		args.labels = [buildIntentLabel(intent), ...labels]
	}
	ensureActionId(args)
	if (ctx.isBaseWallet) {
		// The shared entrypoint, not the registry directly — it dispatches by
		// intent *and* stamps script-derived tags afterwards. Calling the registry
		// here would skip the stamping on every base-wallet action.
		await applyP1SatIntent(ctx.wallet, args, intent)
	}
	return args
}
