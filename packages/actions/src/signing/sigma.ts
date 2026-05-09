import {
	BSM,
	BigNumber,
	Hash,
	OP,
	PublicKey,
	Script,
	Signature,
	Utils,
} from '@bsv/sdk'
import { BAP_PROTOCOL_ID } from '../constants'
import type { OneSatContext } from '../types'
import { resolveCurrentKeyId } from './aip'

const { toArray } = Utils

const writeUint32LE = (value: number): number[] => [
	value & 0xff,
	(value >> 8) & 0xff,
	(value >> 16) & 0xff,
	(value >> 24) & 0xff,
]

/**
 * Compute the Sigma input hash from an outpoint (txid + vout).
 */
function getInputHash(txid: string, vout: number): number[] {
	const txidBytes: number[] = []
	for (let i = 0; i < txid.length; i += 2) {
		txidBytes.push(Number.parseInt(txid.substring(i, i + 2), 16))
	}
	return Hash.sha256([...txidBytes, ...writeUint32LE(vout)])
}

/**
 * Compute the Sigma data hash from a locking script (pre-signature).
 */
function getDataHash(lockingScript: Script): number[] {
	return Hash.sha256(lockingScript.toBinary())
}

/**
 * Compute the Sigma message hash: SHA256(inputHash || dataHash).
 */
function getMessageHash(inputHash: number[], dataHash: number[]): number[] {
	const combined = new Uint8Array(inputHash.length + dataHash.length)
	combined.set(inputHash, 0)
	combined.set(dataHash, inputHash.length)
	return Hash.sha256(Array.from(combined))
}

/**
 * Check whether a script contains OP_RETURN.
 */
function hasOpReturn(script: Script): boolean {
	return script.chunks.some((c) => c.op === OP.OP_RETURN)
}

/**
 * Compute a Sigma signature using the BRC-100 wallet and append SIGMA
 * protocol data to the provided locking script.
 *
 * The returned script contains the original locking script followed by a
 * SIGMA suffix: `SIGMA BSM <address> <compactSig> <vin>`.
 */
export async function applySigma(
	ctx: OneSatContext,
	lockingScript: Script,
	inputOutpoint: { txid: string; vout: number },
	targetVout = 0,
	refVin = 0,
): Promise<Script> {
	const vin = refVin === -1 ? targetVout : refVin

	const inputHash = getInputHash(inputOutpoint.txid, inputOutpoint.vout)
	const dataHash = getDataHash(lockingScript)
	const messageHash = getMessageHash(inputHash, dataHash)
	const bsmHash = BSM.magicHash(messageHash)

	const keyID = await resolveCurrentKeyId(ctx)

	const result = await ctx.wallet.createSignature({
		protocolID: BAP_PROTOCOL_ID,
		keyID,
		counterparty: 'self',
		hashToDirectlySign: Array.from(bsmHash),
	})

	const pubKeyResult = await ctx.wallet.getPublicKey({
		protocolID: BAP_PROTOCOL_ID,
		keyID,
		forSelf: true,
	})

	const publicKey = PublicKey.fromString(pubKeyResult.publicKey)
	const signature = Signature.fromDER(result.signature)
	const recovery = signature.CalculateRecoveryFactor(
		publicKey,
		new BigNumber(bsmHash),
	)

	const address = publicKey.toAddress()
	const compactSig = signature.toCompact(recovery, true) as number[]

	const out = new Script(lockingScript.chunks.slice())
	if (hasOpReturn(lockingScript)) {
		out.writeBin(toArray('|'))
	} else {
		out.writeOpCode(OP.OP_RETURN)
	}
	out.writeBin(toArray('SIGMA'))
	out.writeBin(toArray('BSM'))
	out.writeBin(toArray(address))
	out.writeBin(compactSig)
	out.writeBin(toArray(vin.toString()))

	return out
}
