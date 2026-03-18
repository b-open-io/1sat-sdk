import { AIP, WalletSigner } from '@1sat/templates'
import { OP, Script, Utils } from '@bsv/sdk'
import { BAP_BASKET, BAP_KEY_ID, BAP_PROTOCOL_ID } from '../constants'
import type { OneSatContext } from '../types'

const { toArray } = Utils

const AIP_PREFIX = '15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva'

/**
 * Resolve the current BAP signing key ID and create a WalletSigner for it.
 */
export async function resolveBapSigner(
	ctx: OneSatContext,
	keyID?: string,
): Promise<{ signer: WalletSigner; keyID: string }> {
	const resolvedKeyID = keyID ?? (await resolveCurrentKeyId(ctx))
	return {
		signer: new WalletSigner(
			ctx.wallet,
			BAP_PROTOCOL_ID,
			resolvedKeyID,
			'self',
		),
		keyID: resolvedKeyID,
	}
}

/**
 * Resolve the current BAP signing key ID from the wallet's basket.
 *
 * Scans `type:id` outputs for the highest `seq:N` tag and reads the
 * keyID from customInstructions. Falls back to `identity-0` if no
 * ID outputs exist (identity not yet published).
 */
export async function resolveCurrentKeyId(ctx: OneSatContext): Promise<string> {
	const result = await ctx.wallet.listOutputs({
		basket: BAP_BASKET,
		tags: ['type:id'],
		includeTags: true,
		includeCustomInstructions: true,
		limit: 100,
	})

	let maxSeq = 0
	let keyID = `${BAP_KEY_ID}-0`

	for (const output of result.outputs) {
		const seqTag = output.tags?.find((t) => t.startsWith('seq:'))
		if (!seqTag) continue
		const seq = Number.parseInt(seqTag.slice(4), 10)
		if (seq > maxSeq && output.customInstructions) {
			maxSeq = seq
			const info = JSON.parse(output.customInstructions)
			keyID = info.keyID
		}
	}

	return keyID
}

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
 * Sign OP_RETURN data with AIP using any wallet-derived key.
 *
 * General-purpose AIP signing — takes full derivation parameters
 * (protocolID, keyID, counterparty) to sign with any derivable address.
 *
 * The returned script contains the original locking script followed by:
 * `| AIP_PREFIX BITCOIN_ECDSA <address> <compactSig>`
 */
export async function applyAip(
	ctx: OneSatContext,
	lockingScript: Script,
	protocolID: [0 | 1 | 2, string],
	keyID: string,
	counterparty: string,
): Promise<Script> {
	const message = getAipMessageBuffer(lockingScript)
	const signer = new WalletSigner(ctx.wallet, protocolID, keyID, counterparty)
	const aip = await AIP.sign(message, signer)

	const out = new Script(lockingScript.chunks.slice())
	out.writeBin(toArray('|'))
	out.writeBin(toArray(AIP_PREFIX))
	out.writeBin(toArray(aip.data.algorithm))
	out.writeBin(toArray(aip.data.address))
	out.writeBin(aip.data.signature)

	return out
}

/**
 * Sign OP_RETURN data with AIP using the BAP signing key.
 *
 * When keyID is omitted, resolves the current signing key from the
 * wallet's BAP basket (highest sequence output).
 */
export async function applyBapAip(
	ctx: OneSatContext,
	lockingScript: Script,
	keyID?: string,
): Promise<Script> {
	const { signer } = await resolveBapSigner(ctx, keyID)
	const message = getAipMessageBuffer(lockingScript)
	const aip = await AIP.sign(message, signer)

	const out = new Script(lockingScript.chunks.slice())
	out.writeBin(toArray('|'))
	out.writeBin(toArray(AIP_PREFIX))
	out.writeBin(toArray(aip.data.algorithm))
	out.writeBin(toArray(aip.data.address))
	out.writeBin(aip.data.signature)

	return out
}
