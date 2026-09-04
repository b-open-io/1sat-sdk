import { ORDINALS_BASKET, P1SAT_PROTOCOL, SIGMA_BASKET } from '@1sat/types'
import { parseOutpoint } from '@1sat/utils'
import {
	type CreateActionArgs,
	P2PKH,
	PublicKey,
	Script,
	type WalletInterface,
} from '@bsv/sdk'
import {
	type ArgsWithPendingSpends,
	PENDING_RESOLVED_SPENDS_KEY,
	type ResolvedSpend,
} from '../pipeline/spendTargets'
import { findUnsealedSigmaVin, sealSigma } from '../signing/sigma'
import type { OneSatContext } from '../types'
import { stampManagedOutputIds } from '../utils/createTrackedAction'

/**
 * Anchor keyID for a given action. Derived from the action id so the action's
 * sign callback and apply arrive at the same value independently, and so the
 * key stays recoverable from the action record.
 */
export function sigmaAnchorKeyId(actionId: string): string {
	return `anchor-${actionId}`
}

/**
 * Seal unsigned SIGMA tapes on **base** wallet only.
 *
 * - Inputs already present (reinscribe): the spent tip is the vin. Seal
 *   each leftover placeholder against `args.inputs[vin]`. No anchor tx.
 * - No inputs (inscribe): create the 2-sat noSend anchor, then seal vin 0.
 *
 * Idempotent: a script with no zeroed tape is left alone.
 */
export async function applyInscribeSigma(
	wallet: WalletInterface,
	args: CreateActionArgs,
): Promise<void> {
	const ctx: OneSatContext = {
		wallet,
		chain: 'main',
		isBaseWallet: true,
	}

	if (args.inputs?.length) {
		await sealTapesAgainstInputs(ctx, args)
		return
	}

	const outputs = args.outputs
	if (!outputs?.length) {
		throw new Error('ordinal.inscribe-sigma apply: missing outputs')
	}
	const out =
		outputs.find((o) => o.basket === ORDINALS_BASKET) ?? outputs[0]
	if (!out?.lockingScript) {
		throw new Error('ordinal.inscribe-sigma apply: missing inscription output')
	}

	const placeholderScript = Script.fromHex(out.lockingScript)

	const anchorKeyID = sigmaAnchorKeyId(stampManagedOutputIds(args))
	const { publicKey: anchorPubKey } = await wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID: anchorKeyID,
		counterparty: 'self',
		forSelf: true,
	})
	const anchorAddress = PublicKey.fromString(anchorPubKey).toAddress()
	const anchorLockingScript = new P2PKH().lock(anchorAddress)

	const anchorCi = JSON.stringify({
		protocolID: P1SAT_PROTOCOL,
		keyID: anchorKeyID,
	})
	const anchorResult = await wallet.createAction({
		description: 'Sigma anchor output',
		outputs: [
			{
				lockingScript: anchorLockingScript.toHex(),
				satoshis: 2,
				outputDescription: 'Sigma anchor',
				basket: SIGMA_BASKET,
				customInstructions: anchorCi,
			},
		],
		options: {
			noSend: true,
			randomizeOutputs: false,
			acceptDelayedBroadcast: true,
		},
	})

	if (!anchorResult.txid || !anchorResult.tx) {
		throw new Error('ordinal.inscribe-sigma apply: anchor failed')
	}

	const sigmaScript = await sealSigma(
		ctx,
		placeholderScript,
		{ txid: anchorResult.txid, vout: 0 },
		0,
		0,
	)
	out.lockingScript = sigmaScript.toHex()

	// Mutate inputs array in place (or initialize then push).
	if (!args.inputs) {
		;(args as { inputs: NonNullable<CreateActionArgs['inputs']> }).inputs = []
	}
	args.inputs!.push({
		outpoint: `${anchorResult.txid}.0`,
		inputDescription: 'Sigma anchor',
		unlockingScriptLength: 108,
	})

	args.inputBEEF = Array.from(anchorResult.tx)

	args.options = {
		...args.options,
		randomizeOutputs: false,
		noSendChange: anchorResult.noSendChange,
		knownTxids: [anchorResult.txid],
		acceptDelayedBroadcast: true,
		trustSelf: 'known',
		sendWith: [anchorResult.txid],
	}

	// Output record for finalize — we just created it; no DB round-trip.
	const anchorRecord: ResolvedSpend = {
		outpoint: `${anchorResult.txid}.0`,
		customInstructions: anchorCi,
	}
	const stash = args as CreateActionArgs & ArgsWithPendingSpends
	const prev = stash[PENDING_RESOLVED_SPENDS_KEY] ?? []
	stash[PENDING_RESOLVED_SPENDS_KEY] = [...prev, anchorRecord]
}

async function sealTapesAgainstInputs(
	ctx: OneSatContext,
	args: CreateActionArgs,
): Promise<void> {
	const inputs = args.inputs
	if (!inputs?.length) return
	const maxVin = inputs.length - 1

	for (const out of args.outputs ?? []) {
		if (!out.lockingScript) continue
		let script: Script
		try {
			script = Script.fromHex(out.lockingScript)
		} catch {
			continue
		}
		const vin = findUnsealedSigmaVin(script, maxVin)
		if (vin == null) continue
		const outpoint = inputs[vin]?.outpoint
		if (!outpoint) {
			throw new Error('sigma seal: placeholder vin has no matching input')
		}
		const { txid, vout } = parseOutpoint(outpoint)
		out.lockingScript = (
			await sealSigma(ctx, script, { txid, vout }, 0, vin)
		).toHex()
	}
}
