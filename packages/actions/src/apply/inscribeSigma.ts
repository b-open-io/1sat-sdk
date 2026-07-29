import { ORDINALS_BASKET, P1SAT_PROTOCOL, SIGMA_BASKET } from '@1sat/types'
import {
	type CreateActionArgs,
	P2PKH,
	PublicKey,
	Script,
	type WalletInterface,
} from '@bsv/sdk'
import { sealSigma } from '../signing/sigma'
import type { OneSatContext } from '../types'
import {
	ensureActionId,
	executeTrackedAction,
} from '../utils/createTrackedAction'

/**
 * Anchor keyID for a given action. Derived from the action id so the action's
 * sign callback and apply arrive at the same value independently, and so the
 * key stays recoverable from the action record.
 */
export function sigmaAnchorKeyId(actionId: string): string {
	return `anchor-${actionId}`
}

/**
 * Multi-step sigma inscribe apply on **base** wallet only:
 * 1. Anchor createAction (noSend, bypassP1Sat)
 * 2. Sigma-sign inscription script
 * 3. Push anchor input + seal sigma script in place
 */
export async function applyInscribeSigma(
	wallet: WalletInterface,
	args: CreateActionArgs,
): Promise<void> {
	const outputs = args.outputs
	if (!outputs?.length) {
		throw new Error('ordinal.inscribe-sigma apply: missing outputs')
	}
	const out =
		outputs.find((o) => o.basket === ORDINALS_BASKET) ?? outputs[0]
	if (!out?.lockingScript) {
		throw new Error('ordinal.inscribe-sigma apply: missing inscription output')
	}

	// Already sealed (has anchor input) — idempotent.
	if (args.inputs?.length) return

	const placeholderScript = Script.fromHex(out.lockingScript)
	const ctx: OneSatContext = {
		wallet,
		chain: 'main',
		isBaseWallet: true,
	}

	const anchorKeyID = sigmaAnchorKeyId(ensureActionId(args))
	const { publicKey: anchorPubKey } = await wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID: anchorKeyID,
		counterparty: 'self',
		forSelf: true,
	})
	const anchorAddress = PublicKey.fromString(anchorPubKey).toAddress()
	const anchorLockingScript = new P2PKH().lock(anchorAddress)

	const anchorResult = await executeTrackedAction(
		wallet,
		{
			description: 'Sigma anchor output',
			outputs: [
				{
					lockingScript: anchorLockingScript.toHex(),
					satoshis: 2,
					outputDescription: 'Sigma anchor',
					basket: SIGMA_BASKET,
					customInstructions: JSON.stringify({
						protocolID: P1SAT_PROTOCOL,
						keyID: anchorKeyID,
					}),
				},
			],
			options: {
				noSend: true,
				randomizeOutputs: false,
				acceptDelayedBroadcast: true,
			},
		},
		undefined,
		undefined,
		undefined,
		{ bypassP1Sat: true },
	)

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
	if (sigmaScript.toHex().length !== out.lockingScript.length) {
		throw new Error(
			'ordinal.inscribe-sigma apply: sealed script size differs from placeholder',
		)
	}
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

	args.inputBEEF = anchorResult.tx

	args.options = {
		...args.options,
		randomizeOutputs: false,
		noSendChange: anchorResult.noSendChange,
		knownTxids: [anchorResult.txid],
		acceptDelayedBroadcast: true,
		trustSelf: 'known',
		sendWith: [anchorResult.txid],
	}
}
