/**
 * Placeholder substitution: SDK actions that need an AIP or Sigma signature
 * embedded in an output script append a marker push at the script tail.
 * The module detects the marker, strips it, and runs the appropriate
 * signing helper to produce the real trailing pushes — using the underlying
 * wallet directly so the inner signature call doesn't re-prompt.
 *
 * Marker format (UTF-8 bytes pushed as a single data push at the script tail):
 *
 *   1SATPM:AIP                       — needs BAP-AIP signature
 *   1SATPM:SIGMA:<targetVout>:<refVin> — needs Sigma signature
 *
 * Example: a BSocial post action constructs the OP_RETURN with all data
 * pushes, then appends a single push of `'1SATPM:AIP'`. The module sees
 * this trailing push, removes it, calls `applyBapAip` on the resulting
 * script, and writes the modified locking script back to the createAction
 * args before passing them to the underlying wallet.
 */

import { applyBapAip, applySigma } from '@1sat/actions'
import type { OneSatContext } from '@1sat/actions'
import {
	P1SAT_AIP_PLACEHOLDER,
	P1SAT_AIP_PLACEHOLDER_PREFIX,
	P1SAT_PLACEHOLDER_PREFIX,
	P1SAT_SIGMA_PLACEHOLDER_PREFIX,
} from '@1sat/types'
import type { CreateActionOutput, WalletInterface } from '@bsv/sdk'
import { Script, Utils } from '@bsv/sdk'

/**
 * Build the AIP placeholder bytes the SDK should append.
 *
 * @param keyID - Optional explicit BAP keyID to sign with. Omit to use
 *                the current rotated signing key (resolved by the module
 *                via `resolveCurrentKeyId`).
 */
export const aipPlaceholderBytes = (keyID?: string): number[] =>
	Utils.toArray(
		keyID ? `${P1SAT_AIP_PLACEHOLDER_PREFIX}${keyID}` : P1SAT_AIP_PLACEHOLDER,
		'utf8',
	)

/**
 * Build the Sigma placeholder bytes the SDK should append.
 *
 * @param targetVout - which output of the new tx the signature covers
 * @param refVin     - which input of the new tx anchors the input hash
 */
export const sigmaPlaceholderBytes = (
	targetVout: number,
	refVin: number,
): number[] =>
	Utils.toArray(
		`${P1SAT_SIGMA_PLACEHOLDER_PREFIX}${targetVout}:${refVin}`,
		'utf8',
	)

interface PlaceholderInfo {
	kind: 'aip' | 'sigma'
	/** For AIP: optional explicit BAP keyID. Undefined → resolve current. */
	keyID?: string
	/** For Sigma only: the targetVout argument. */
	targetVout?: number
	/** For Sigma only: the refVin argument. */
	refVin?: number
}

/** Read the trailing placeholder marker (if any) from a locking script. */
function readPlaceholder(scriptHex: string): PlaceholderInfo | null {
	const script = Script.fromHex(scriptHex)
	const lastChunk = script.chunks[script.chunks.length - 1]
	if (!lastChunk?.data || lastChunk.data.length === 0) return null
	const text = Utils.toUTF8(Array.from(lastChunk.data))
	if (!text.startsWith(P1SAT_PLACEHOLDER_PREFIX)) return null
	if (text === P1SAT_AIP_PLACEHOLDER) return { kind: 'aip' }
	if (text.startsWith(P1SAT_AIP_PLACEHOLDER_PREFIX)) {
		const keyID = text.slice(P1SAT_AIP_PLACEHOLDER_PREFIX.length)
		if (!keyID) return { kind: 'aip' }
		return { kind: 'aip', keyID }
	}
	if (text.startsWith(P1SAT_SIGMA_PLACEHOLDER_PREFIX)) {
		const rest = text.slice(P1SAT_SIGMA_PLACEHOLDER_PREFIX.length)
		const [voutStr, vinStr] = rest.split(':')
		const targetVout = Number.parseInt(voutStr, 10)
		const refVin = Number.parseInt(vinStr, 10)
		if (Number.isNaN(targetVout) || Number.isNaN(refVin)) return null
		return { kind: 'sigma', targetVout, refVin }
	}
	return null
}

/** Strip the trailing placeholder push from a script. */
function stripPlaceholder(scriptHex: string): Script {
	const script = Script.fromHex(scriptHex)
	return new Script(script.chunks.slice(0, -1))
}

/**
 * Inspect every output in `outputs` and substitute placeholder markers with
 * real signatures. Mutation is returned via a fresh array; the caller writes
 * it back into the createAction args before forwarding to the underlying
 * wallet.
 *
 * For Sigma placeholders, the source-input outpoint is needed to compute
 * the input hash. The caller supplies a `resolveSigmaInputOutpoint(refVin)`
 * function that maps a vin index to `{ txid, vout }` (typically by reading
 * `args.inputs[refVin].outpoint`).
 */
export async function substitutePlaceholders(
	outputs: CreateActionOutput[],
	wallet: WalletInterface,
	resolveSigmaInputOutpoint: (
		refVin: number,
	) => { txid: string; vout: number } | null,
): Promise<CreateActionOutput[]> {
	const ctx: OneSatContext = { wallet, chain: 'main' }
	const next: CreateActionOutput[] = []
	for (const out of outputs) {
		const info = readPlaceholder(out.lockingScript)
		if (!info) {
			next.push(out)
			continue
		}
		const stripped = stripPlaceholder(out.lockingScript)
		let signed: Script
		if (info.kind === 'aip') {
			signed = await applyBapAip(ctx, stripped, info.keyID)
		} else {
			const refVin = info.refVin ?? 0
			const targetVout = info.targetVout ?? next.length
			const outpoint = resolveSigmaInputOutpoint(refVin)
			if (!outpoint) {
				throw new Error(
					`1Sat permission module: cannot resolve input outpoint for Sigma placeholder (refVin=${refVin})`,
				)
			}
			signed = await applySigma(ctx, stripped, outpoint, targetVout, refVin)
		}
		next.push({ ...out, lockingScript: signed.toHex() })
	}
	return next
}
