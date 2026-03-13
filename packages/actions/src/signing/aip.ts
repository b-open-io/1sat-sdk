import { AIP, WalletSigner } from '@bopen-io/templates'
import { OP, Script, Utils } from '@bsv/sdk'
import { BAP_KEY_ID, BAP_PROTOCOL_ID } from '../constants'
import type { OneSatContext } from '../types'

const { toArray } = Utils

const AIP_PREFIX = '15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva'

/**
 * Build the AIP message buffer from a locking script's OP_RETURN data.
 *
 * Collects all push-data chunks (including OP_RETURN itself as a raw byte)
 * into a flat byte array, matching the signing format expected by AIP
 * verifiers.
 */
function getAipMessageBuffer(lockingScript: Script): number[] {
	const buf: number[] = []
	let foundOpReturn = false

	for (const chunk of lockingScript.chunks) {
		if (chunk.op === OP.OP_RETURN) {
			buf.push(OP.OP_RETURN)
			foundOpReturn = true
			continue
		}
		if (!foundOpReturn) continue
		if (chunk.data != null && chunk.data.length > 0) {
			buf.push(...Array.from(chunk.data))
		}
	}

	return buf
}

/**
 * Sign OP_RETURN data with AIP using the BRC-100 wallet and append the
 * AIP protocol suffix to the provided locking script.
 *
 * AIP signs the raw OP_RETURN content via BSM (no input hash or anchor
 * transaction — simpler than Sigma). The returned script contains the
 * original locking script followed by:
 * `| AIP_PREFIX BITCOIN_ECDSA <address> <compactSig>`
 */
export async function applyAip(
	ctx: OneSatContext,
	lockingScript: Script,
): Promise<Script> {
	const message = getAipMessageBuffer(lockingScript)
	const signer = new WalletSigner(
		ctx.wallet,
		BAP_PROTOCOL_ID,
		BAP_KEY_ID,
		'self',
	)
	const aip = await AIP.sign(message, signer)

	const out = new Script(lockingScript.chunks.slice())
	out.writeBin(toArray('|'))
	out.writeBin(toArray(AIP_PREFIX))
	out.writeBin(toArray(aip.data.algorithm))
	out.writeBin(toArray(aip.data.address))
	out.writeBin(aip.data.signature)

	return out
}
