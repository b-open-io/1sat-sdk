import type { CreateActionArgs } from '@bsv/sdk'
import type { OneSatContext } from '../types'
import { ensureActionId } from '../utils/createTrackedAction'
import { applyP1SatCreateAction } from './applyIntent'

/**
 * Ensure action id tags + dispatch label, and run apply when `ctx.isBaseWallet`.
 * Mutates `args` in place.
 */
export async function prepareP1SatArgs(ctx: OneSatContext, args: CreateActionArgs): Promise<CreateActionArgs> {
	ensureActionId(args)
	if (ctx.isBaseWallet) {
		await applyP1SatCreateAction(ctx.wallet, args)
	}
	return args
}
