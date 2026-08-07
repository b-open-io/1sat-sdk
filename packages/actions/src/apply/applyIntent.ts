import { OPNS_BASKET, ORDINALS_BASKET } from '@1sat/types'
import {
	type CreateActionArgs,
	LockingScript,
	PushDrop,
	Script,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import { ensureActionId } from '../utils/createTrackedAction'
import { applyInscribeSigma } from './inscribeSigma'
import { applyOpnsRegister } from './opnsRegister'
import { stampScriptDerivedTags } from './stampScriptTags'

/**
 * Module/base-wallet apply: seal recognized placeholders from script shape,
 * then stamp script-derived tags. No intent labels.
 */
export async function applyP1SatCreateAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
): Promise<void> {
	ensureActionId(args)

	if (hasUnsealedOpnsRegister(args)) {
		await applyOpnsRegister(wallet, args)
	}
	if (hasUnsealedSigmaInscribe(args)) {
		await applyInscribeSigma(wallet, args)
	}

	stampScriptDerivedTags(args)
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

function hasUnsealedSigmaInscribe(args: CreateActionArgs): boolean {
	// Already has anchor input — sealed or mid-flight.
	if (args.inputs?.length) return false
	const outputs = args.outputs
	if (!outputs?.length) return false
	const out =
		outputs.find((o) => o.basket === ORDINALS_BASKET) ?? outputs[0]
	if (!out?.lockingScript) return false
	try {
		const script = Script.fromHex(out.lockingScript)
		const bin = script.toBinary()
		// SIGMA ascii in script + likely zero-filled compact sig region
		const sigma = Utils.toArray('SIGMA')
		return containsSubarray(bin, sigma)
	} catch {
		return false
	}
}

function containsSubarray(hay: number[], needle: number[]): boolean {
	if (needle.length === 0 || hay.length < needle.length) return false
	outer: for (let i = 0; i <= hay.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (hay[i + j] !== needle[j]) continue outer
		}
		return true
	}
	return false
}
