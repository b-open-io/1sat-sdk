import { Sigma } from '@1sat/templates'
import {
	BigNumber,
	BSM,
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

/**
 * Check whether a script contains OP_RETURN.
 */
function hasOpReturn(script: Script): boolean {
	return script.chunks.some((c) => c.op === OP.OP_RETURN)
}

/**
 * Compact BSM signatures are always `[recoveryByte, r(32), s(32)]`. Fixed
 * width, so a placeholder tape is exactly the size of the sealed one.
 */
export const SIGMA_COMPACT_SIG_LEN = 65

/**
 * The current BAP signing address. Read-only, so this resolves at
 * createAction-args time — before anything is signed.
 */
export async function resolveSigmaAddress(
	ctx: OneSatContext,
): Promise<{ keyID: string; publicKey: PublicKey; address: string }> {
	const keyID = await resolveCurrentKeyId(ctx)
	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: BAP_PROTOCOL_ID,
		keyID,
		forSelf: true,
	})
	const pub = PublicKey.fromString(publicKey)
	return { keyID, publicKey: pub, address: pub.toAddress() }
}

/**
 * Serialize the SIGMA tape.
 *
 * Built as raw bytes and concatenated rather than appended to
 * `script.chunks`: `Script.fromHex` folds everything after a data-bearing
 * `OP_RETURN` into that one chunk, and re-serializing a chunk copy silently
 * drops anything pushed after it. Concatenation also keeps the signed
 * preimage byte-exact.
 */
function sigmaTapeBytes(
	needsSeparator: boolean,
	address: string,
	compactSig: number[],
	vin: number,
): number[] {
	const tail = new Script()
	if (needsSeparator) {
		tail.writeBin(toArray('|'))
	} else {
		tail.writeOpCode(OP.OP_RETURN)
	}
	tail.writeBin(toArray('SIGMA'))
	tail.writeBin(toArray('BSM'))
	tail.writeBin(toArray(address))
	tail.writeBin(compactSig)
	tail.writeBin(toArray(vin.toString()))
	return tail.toBinary()
}

function concatScript(base: Script, suffix: number[]): Script {
	return Script.fromBinary([...base.toBinary(), ...suffix])
}

/**
 * Append an unsigned SIGMA tape with the signature zero-filled.
 *
 * The signature itself can't be computed yet — it commits to the anchor
 * outpoint, and the anchor transaction is created during apply. Its length
 * is fixed though, so the output is already its exact on-chain size and fee
 * estimation is correct.
 */
export async function appendSigmaPlaceholder(
	ctx: OneSatContext,
	lockingScript: Script,
	vin = 0,
): Promise<Script> {
	const { address } = await resolveSigmaAddress(ctx)
	return concatScript(
		lockingScript,
		sigmaTapeBytes(
			hasOpReturn(lockingScript),
			address,
			new Array(SIGMA_COMPACT_SIG_LEN).fill(0),
			vin,
		),
	)
}

/**
 * Replace the zeroed signature in a placeholder tape with the real one.
 *
 * The placeholder is rebuilt from the same inputs and matched against the
 * script's tail, which both locates the tape exactly and proves nothing else
 * drifted. Sigma hashes the script *without* its tape, so the signature is
 * computed over the stripped prefix.
 */
export async function sealSigma(
	ctx: OneSatContext,
	lockingScript: Script,
	inputOutpoint: { txid: string; vout: number },
	targetVout = 0,
	refVin = 0,
): Promise<Script> {
	const vin = refVin === -1 ? targetVout : refVin
	const { keyID, publicKey, address } = await resolveSigmaAddress(ctx)

	const bytes = lockingScript.toBinary()
	const zeroed = sigmaTapeBytes(
		true,
		address,
		new Array(SIGMA_COMPACT_SIG_LEN).fill(0),
		vin,
	)
	const noSeparator = sigmaTapeBytes(
		false,
		address,
		new Array(SIGMA_COMPACT_SIG_LEN).fill(0),
		vin,
	)
	const tape = [zeroed, noSeparator].find((t) => {
		const start = bytes.length - t.length
		return start >= 0 && t.every((b, i) => bytes[start + i] === b)
	})
	if (!tape) {
		throw new Error('sigma seal: no zeroed placeholder tape on the script')
	}

	const base = Script.fromBinary(bytes.slice(0, bytes.length - tape.length))
	const compactSig = await signSigma(ctx, base, inputOutpoint, keyID, publicKey)
	return concatScript(
		base,
		sigmaTapeBytes(hasOpReturn(base), address, compactSig, vin),
	)
}

/**
 * Sign against an anchor outpoint, returning the 65-byte compact signature.
 * `scriptWithTape` must already carry its SIGMA tape (zero-filled is fine) —
 * the template's dataHash locates the tape and hashes the bytes before it.
 */
async function signSigma(
	ctx: OneSatContext,
	scriptWithTape: Script,
	inputOutpoint: { txid: string; vout: number },
	keyID: string,
	publicKey: PublicKey,
): Promise<number[]> {
	// Both hashes come from the template, so the signer and any verifier
	// agree by construction. Reimplementing dataHash here is what broke MAP
	// inscriptions: it hashed the whole prefix, while the template stops at
	// the OP_RETURN carrying the tape.
	const inputHash = Sigma.computeInputHash(
		inputOutpoint.txid,
		0,
		inputOutpoint.vout,
	)
	const dataHash = Sigma.computeDataHash(scriptWithTape, 0)
	const messageHash = Sigma.computeMessageHash(inputHash, dataHash)
	const bsmHash = BSM.magicHash(messageHash)

	const { signature: der } = await ctx.wallet.createSignature({
		protocolID: BAP_PROTOCOL_ID,
		keyID,
		counterparty: 'self',
		hashToDirectlySign: Array.from(bsmHash),
	})

	const signature = Signature.fromDER(der)
	const recovery = signature.CalculateRecoveryFactor(
		publicKey,
		new BigNumber(bsmHash),
	)
	return signature.toCompact(recovery, true) as number[]
}
