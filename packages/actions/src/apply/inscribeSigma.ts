import { ORDINALS_BASKET, P1SAT_PROTOCOL, SIGMA_BASKET } from '@1sat/types'
import {
	type CreateActionArgs,
	P2PKH,
	PublicKey,
	Script,
	type WalletInterface,
} from '@bsv/sdk'
import { applySigma } from '../signing/sigma'
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

/** True when locking script hex already carries a SIGMA tape (ASCII "SIGMA"). */
function lockingScriptHasSigma(hex: string | undefined): boolean {
	if (!hex) return false
	return hex.toLowerCase().includes('5349474d41')
}

function parseOutpoint(outpoint: string): { txid: string; vout: number } {
	const normalized = outpoint.includes('.')
		? outpoint
		: outpoint.replace(/_(\d+)$/, '.$1')
	const dot = normalized.lastIndexOf('.')
	if (dot <= 0) {
		throw new Error(`ordinal.inscribe-sigma apply: bad outpoint ${outpoint}`)
	}
	const txid = normalized.slice(0, dot)
	const vout = Number.parseInt(normalized.slice(dot + 1), 10)
	if (!txid || !Number.isFinite(vout) || vout < 0) {
		throw new Error(`ordinal.inscribe-sigma apply: bad outpoint ${outpoint}`)
	}
	return { txid, vout }
}

/**
 * Multi-step sigma inscribe apply on **base** wallet only:
 * 1. Anchor createAction (noSend, bypassP1Sat)
 * 2. Sigma-sign inscription script
 * 3. Push anchor input + seal sigma script in place
 *
 * Idempotent when already sealed. If an anchor input exists but the SIGMA tape
 * is missing (dApp pre-apply + WPM handoff can drop the seal while keeping the
 * input), re-seal against the existing anchor instead of returning early.
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

	const ctx: OneSatContext = {
		wallet,
		chain: 'main',
		isBaseWallet: true,
	}

	// Already has anchor input — only skip when SIGMA seal is present too.
	if (args.inputs?.length) {
		if (lockingScriptHasSigma(out.lockingScript)) return

		const anchor = parseOutpoint(args.inputs[0].outpoint)
		const baseScript = Script.fromHex(out.lockingScript)
		const sigmaScript = await applySigma(ctx, baseScript, anchor, 0, 0)
		out.lockingScript = sigmaScript.toHex()
		if (!lockingScriptHasSigma(out.lockingScript)) {
			throw new Error(
				'ordinal.inscribe-sigma apply: re-seal produced no SIGMA tape',
			)
		}
		return
	}

	const baseScript = Script.fromHex(out.lockingScript)

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

	const sigmaScript = await applySigma(
		ctx,
		baseScript,
		{ txid: anchorResult.txid, vout: 0 },
		0,
		0,
	)
	out.lockingScript = sigmaScript.toHex()
	if (!lockingScriptHasSigma(out.lockingScript)) {
		throw new Error('ordinal.inscribe-sigma apply: seal produced no SIGMA tape')
	}

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
