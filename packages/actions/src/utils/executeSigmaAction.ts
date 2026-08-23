import { P1SAT_PROTOCOL, type P1SatIntent } from '@1sat/types'
import { type CreateActionArgs, Script } from '@bsv/sdk'
import { prepareP1SatArgs, sigmaAnchorKeyId } from '../apply'
import type { FundingProvider } from '../funding'
import { appendSigmaPlaceholder } from '../signing/sigma'
import type { OneSatContext } from '../types'
import { ensureActionId, executeTrackedAction } from './createTrackedAction'
import { signP2PKHInput } from './signP2PKH'

/**
 * Prepare and execute a createAction whose selected output carries SIGMA.
 *
 * The placeholder makes the output its final size before wallet funding. The
 * intent apply creates the anchor, seals the signature, and adds the anchor
 * input. This helper owns the matching anchor-input signature callback so
 * inscription-like actions do not duplicate that transaction plumbing.
 */
export async function executeSigmaAction(
	ctx: OneSatContext,
	args: CreateActionArgs,
	intent: P1SatIntent,
	fundingProvider?: FundingProvider,
	targetOutputIndex = 0,
) {
	const target = args.outputs?.[targetOutputIndex]
	if (!target?.lockingScript) {
		throw new Error(`sigma action: missing output ${targetOutputIndex}`)
	}

	target.lockingScript = (
		await appendSigmaPlaceholder(ctx, Script.fromHex(target.lockingScript))
	).toHex()

	const prepared = await prepareP1SatArgs(ctx, args, intent)
	return executeTrackedAction(
		ctx.wallet,
		prepared,
		fundingProvider,
		prepared.inputBEEF as number[] | undefined,
		async (tx) => {
			const anchorKeyID = sigmaAnchorKeyId(ensureActionId(prepared))
			const unlocking = await signP2PKHInput(
				ctx,
				tx,
				0,
				P1SAT_PROTOCOL,
				anchorKeyID,
			)
			if (typeof unlocking !== 'string') throw new Error(unlocking.error)
			return { 0: { unlockingScript: unlocking } }
		},
	)
}
