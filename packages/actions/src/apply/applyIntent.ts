import { OPNS_BASKET } from '@1sat/types'
import {
	type CreateActionArgs,
	LockingScript,
	PushDrop,
	Script,
	type WalletInterface,
} from '@bsv/sdk'
import { findUnsealedSigmaVin } from '../signing/sigma.js'
import { stampManagedOutputIds } from '../utils/createTrackedAction.js'
import { stampBsv21OutputCustomInstructions } from '../utils/stampBsv21OutputCi.js'
import { stampOrdinalOutputCustomInstructions } from '../utils/stampOrdinalOutputCi.js'
import { applyInscribeSigma } from './inscribeSigma.js'
import { applyOpnsRegister } from './opnsRegister.js'
import { stampScriptDerivedTags } from './stampScriptTags.js'

/**
 * Authoritative enrich (local pipeline + module embellish):
 * managed `id:` tags, seals, script-derived tags, BSV-21 + ordinal/OpNS CI.
 * Does **not** add module dispatch labels — those are opt-in via prepare.
 */
export async function applyP1SatCreateAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
): Promise<string> {
	const actionId = stampManagedOutputIds(args)

	if (hasUnsealedOpnsRegister(args)) {
		await applyOpnsRegister(wallet, args)
	}
	if (hasUnsealedSigmaTape(args)) {
		await applyInscribeSigma(wallet, args)
	}

	stampScriptDerivedTags(args)
	// Tags/script + spent-input carry → CI. Keeps derivation.
	// Same path for local (WPM encrypts after) and module (may re-encrypt).
	await stampBsv21OutputCustomInstructions(wallet, args)
	await stampOrdinalOutputCustomInstructions(wallet, args)
	return actionId
}

/** @deprecated Use {@link applyP1SatCreateAction} */
export async function applyP1SatIntent(
	wallet: WalletInterface,
	args: CreateActionArgs,
	_intent?: string,
): Promise<void> {
	await applyP1SatCreateAction(wallet, args)
}

function hasUnsealedOpnsRegister(args: CreateActionArgs): boolean {
	const outputs = args.outputs
	if (!outputs?.length || !args.inputs?.[0]?.outpoint) return false
	const out =
		outputs.find((o) => o.basket === OPNS_BASKET) ??
		outputs.find((o) => o.satoshis === 1)
	if (!out?.lockingScript) return false
	try {
		const fields = PushDrop.decode(
			LockingScript.fromHex(out.lockingScript),
		).fields
		const last = fields[fields.length - 1]
		return !!last?.length && last.every((b) => b === 0)
	} catch {
		return false
	}
}

function hasUnsealedSigmaTape(args: CreateActionArgs): boolean {
	const outputs = args.outputs
	if (!outputs?.length) return false
	const maxVin = Math.max(0, (args.inputs?.length ?? 1) - 1)
	for (const out of outputs) {
		if (!out.lockingScript) continue
		try {
			const script = Script.fromHex(out.lockingScript)
			if (findUnsealedSigmaVin(script, maxVin) != null) return true
		} catch {
			continue
		}
	}
	return false
}
