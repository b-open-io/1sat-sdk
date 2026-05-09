/**
 * Placeholder helpers for the 1Sat permission module.
 *
 * Bucket B actions (BSocial posts, BAP-signed inscriptions, BAP chain ops)
 * traditionally compute their AIP/Sigma signatures BEFORE calling
 * createAction. Under the new permission flow, that pre-signature call
 * goes through the module with no captured commitment and prompts the
 * user — leading to two prompts per action.
 *
 * Instead, the action constructs the locking script with all data pushes
 * EXCEPT the AIP/Sigma signature, then appends a placeholder marker push.
 * The module's onRequest handler detects the placeholder, strips it,
 * computes the real signature internally (via direct underlying-wallet
 * calls that bypass the permission manager), and writes the modified
 * locking script back to the createAction args. The user sees one prompt
 * covering the full intent.
 */

import {
	P1SAT_AIP_PLACEHOLDER,
	P1SAT_AIP_PLACEHOLDER_PREFIX,
	P1SAT_SIGMA_PLACEHOLDER_PREFIX,
} from '@1sat/types'
import { type Script, Utils } from '@bsv/sdk'

/**
 * Append the AIP placeholder push to a locking script. The module will
 * substitute the real AIP suffix (`| AIP_PREFIX BITCOIN_ECDSA <addr> <sig>`)
 * before the wallet sees the createAction args.
 *
 * @param script - locking script to append the placeholder to (mutated and returned)
 * @param keyID  - optional explicit BAP keyID (e.g. `'identity-0'` for the
 *                 root key during identity publish). Omit to use the current
 *                 rotated signing key.
 */
export function appendAipPlaceholder(script: Script, keyID?: string): Script {
	const marker = keyID
		? `${P1SAT_AIP_PLACEHOLDER_PREFIX}${keyID}`
		: P1SAT_AIP_PLACEHOLDER
	script.writeBin(Utils.toArray(marker, 'utf8'))
	return script
}

/**
 * Append the Sigma placeholder push to a locking script.
 *
 * @param targetVout - which output of the new tx the signature covers
 *                     (typically the index of this output)
 * @param refVin     - which input of the new tx anchors the input hash
 */
export function appendSigmaPlaceholder(
	script: Script,
	targetVout: number,
	refVin: number,
): Script {
	script.writeBin(
		Utils.toArray(
			`${P1SAT_SIGMA_PLACEHOLDER_PREFIX}${targetVout}:${refVin}`,
			'utf8',
		),
	)
	return script
}
