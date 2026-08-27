import {
	BSM,
	BigNumber,
	OP,
	PublicKey,
	Script,
	Signature,
	Utils,
} from '@bsv/sdk'
import { Sigma } from '@1sat/templates'
import { BAP_PROTOCOL_ID } from '../constants'
import type { OneSatContext } from '../types'
import { resolveCurrentKeyId } from './aip'

const { toArray } = Utils

function hasOpReturn(script: Script): boolean {
	return script.chunks.some((c) => c.op === OP.OP_RETURN)
}

/**
 * Compact BSM signatures are always `[recoveryByte, r(32), s(32)]`.
 */
export const SIGMA_COMPACT_SIG_LEN = 65

/**
 * Placeholder address push (max P2PKH base58 length). Apply rewrites the
 * whole tape with the real address — pushdata opcodes follow the real length.
 */
export const SIGMA_ADDRESS_PLACEHOLDER_LEN = 34

const ZERO_SIG = (): number[] => new Array(SIGMA_COMPACT_SIG_LEN).fill(0)
const ZERO_ADDRESS = (): number[] =>
	new Array(SIGMA_ADDRESS_PLACEHOLDER_LEN).fill(0)

/**
 * The current BAP signing address. Used in apply when sealing, not when
 * building the unsigned placeholder (that would hit WPM protocol access).
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
 * drops anything pushed after it.
 */
function sigmaTapeBytes(
	needsSeparator: boolean,
	address: string | number[],
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
	tail.writeBin(typeof address === 'string' ? toArray(address) : address)
	tail.writeBin(compactSig)
	tail.writeBin(toArray(vin.toString()))
	return tail.toBinary()
}

function concatScript(base: Script, suffix: number[]): Script {
	return Script.fromBinary([...base.toBinary(), ...suffix])
}

function placeholderTapes(vin: number): number[][] {
	const addr = ZERO_ADDRESS()
	const sig = ZERO_SIG()
	return [
		sigmaTapeBytes(true, addr, sig, vin),
		sigmaTapeBytes(false, addr, sig, vin),
	]
}

function findPlaceholderTape(
	scriptBin: number[],
	vin: number,
): number[] | undefined {
	return placeholderTapes(vin).find((t) => {
		const start = scriptBin.length - t.length
		return start >= 0 && t.every((b, i) => scriptBin[start + i] === b)
	})
}

/**
 * Append an unsigned SIGMA tape: zero address push + zero signature.
 * No BAP getPublicKey — apply fills both fields and rewrites the tape.
 */
export async function appendSigmaPlaceholder(
	_ctx: OneSatContext,
	lockingScript: Script,
	vin = 0,
): Promise<Script> {
	return concatScript(
		lockingScript,
		sigmaTapeBytes(
			hasOpReturn(lockingScript),
			ZERO_ADDRESS(),
			ZERO_SIG(),
			vin,
		),
	)
}

/**
 * Strip the placeholder tape, sign, append a new tape with real address + sig.
 * Rewrites pushdata for the real address length — does not patch bytes in place.
 */
export async function sealSigma(
	ctx: OneSatContext,
	lockingScript: Script,
	inputOutpoint: { txid: string; vout: number },
	targetVout = 0,
	refVin = 0,
): Promise<Script> {
	const vin = refVin === -1 ? targetVout : refVin
	const bytes = lockingScript.toBinary()
	const tape = findPlaceholderTape(bytes, vin)
	if (!tape) {
		throw new Error('sigma seal: no zeroed placeholder tape on the script')
	}

	const base = Script.fromBinary(bytes.slice(0, bytes.length - tape.length))
	const { keyID, publicKey, address } = await resolveSigmaAddress(ctx)
	const compactSig = await signSigma(ctx, base, inputOutpoint, keyID, publicKey)
	return concatScript(
		base,
		sigmaTapeBytes(hasOpReturn(base), address, compactSig, vin),
	)
}

/**
 * Sign against an anchor outpoint, returning the 65-byte compact signature.
 * `scriptWithTape` is the prefix (no tape); dataHash hashes those bytes.
 */
async function signSigma(
	ctx: OneSatContext,
	scriptPrefix: Script,
	inputOutpoint: { txid: string; vout: number },
	keyID: string,
	publicKey: PublicKey,
): Promise<number[]> {
	const inputHash = Sigma.computeInputHash(
		inputOutpoint.txid,
		0,
		inputOutpoint.vout,
	)
	const dataHash = Sigma.computeDataHash(scriptPrefix, 0)
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
