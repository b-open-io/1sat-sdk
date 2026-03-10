import { BSM, BigNumber, Hash, PublicKey, Script, Signature, Utils } from '@bsv/sdk'
import { BAP_KEY_ID, BAP_PROTOCOL_ID } from '../constants'
import type { OneSatContext } from '../types'

const { toHex, toArray } = Utils

const SIGMA_HEX = '5349474d41'

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

	const result = await ctx.wallet.createSignature({
		protocolID: BAP_PROTOCOL_ID,
		keyID: BAP_KEY_ID,
		counterparty: 'self',
		hashToDirectlySign: Array.from(bsmHash),
	})

	const pubKeyResult = await ctx.wallet.getPublicKey({
		protocolID: BAP_PROTOCOL_ID,
		keyID: BAP_KEY_ID,
		forSelf: true,
	})

	const publicKey = PublicKey.fromString(pubKeyResult.publicKey)
	const signature = Signature.fromDER(result.signature)
	const recovery = signature.CalculateRecoveryFactor(
		publicKey,
		new BigNumber(bsmHash),
	)

	const address = publicKey.toAddress()
	const compactSigHex = signature.toCompact(recovery, true, 'hex')

	const existingAsm = lockingScript.toASM()
	const containsOpReturn = existingAsm.split(' ').includes('OP_RETURN')
	const separator = containsOpReturn ? '7c' : 'OP_RETURN'

	const sigmaAsm = `${SIGMA_HEX} ${toHex(toArray('BSM'))} ${toHex(toArray(address))} ${compactSigHex} ${toHex(toArray(vin.toString()))}`
	const newAsm = `${existingAsm} ${separator} ${sigmaAsm}`

	return Script.fromASM(newAsm)
}
