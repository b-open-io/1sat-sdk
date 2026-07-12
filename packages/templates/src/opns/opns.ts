import { OPNS_CONTRACT, OPNS_DIFFICULTY, OPNS_GENESIS } from '@1sat/types'
import {
	BigNumber,
	Hash,
	OP,
	Script,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
} from '@bsv/sdk'

/** OpNS covenant contract as a byte array (the compiled sCrypt prefix). */
export const OPNS_CONTRACT_BYTES = Utils.toArray(OPNS_CONTRACT, 'hex')

/** Genesis outpoint bytes embedded in every node's state. */
export const OPNS_GENESIS_BYTES = Utils.toArray(OPNS_GENESIS, 'hex')

/** Ordinal inscription bitcom address for OpNS names. */
const OPNS_BITCOM = '1opNSUJVbBc2Vf8LFNSoywGGK4jMcGVrC'

/** OpNS content type. */
const OPNS_CONTENT_TYPE = 'application/op-ns'

/** Decoded OpNS node state. */
export interface OpNSData {
	/** Claimed-character bitfield (little-endian). */
	claimed: number[]
	/** The name mined so far. */
	domain: string
	/** Proof-of-work root: sha256d hash the node was mined to. */
	pow: number[]
}

/**
 * OpNS - Ordinals Name System covenant template.
 *
 * A node output locks the compiled covenant plus a stateful OP_RETURN trailer
 * carrying {genesis, claimed, domain, pow}. Spending it mines one character:
 * the keyless unlock pushes char + nonce + ownerScript + trailingOutputs +
 * the BIP-143 preimage (SIGHASH_ALL | ANYONECANPAY | FORKID), and the covenant
 * validates the three mandated outputs (restated parent, child node, name
 * inscription) against its own introspected state.
 *
 * @example
 * ```typescript
 * const node = OpNS.decode(parentTx.outputs[1].lockingScript)
 * const child = OpNS.lock([0], node.domain + 'h', solutionHash)
 * ```
 */
export default class OpNS {
	/**
	 * Builds a node locking script: the compiled covenant followed by the
	 * stateful OP_RETURN trailer.
	 *
	 * @param claimed - Claimed-character bitfield (little-endian)
	 * @param domain - The name mined so far
	 * @param pow - The sha256d hash the node was mined to (32 bytes)
	 * @returns The node locking script
	 */
	static lock(claimed: number[], domain: string, pow: number[]): Script {
		const state = new Script()
			.writeOpCode(OP.OP_RETURN)
			.writeOpCode(OP.OP_FALSE)
			.writeBin(OPNS_GENESIS_BYTES)
			.writeBin(claimed)
			.writeBin(Utils.toArray(domain, 'utf8'))
			.writeBin(pow)
		const stateBin = state.toBinary()

		const writer = new Utils.Writer()
		writer.write(stateBin)
		writer.writeUInt32LE(stateBin.length - 1)
		writer.writeUInt8(0)

		return Script.fromBinary([...OPNS_CONTRACT_BYTES, ...writer.toArray()])
	}

	/**
	 * Decodes a node's state from its locking script.
	 *
	 * @param script - The locking script to decode
	 * @returns Decoded node state, or null if not an OpNS node
	 */
	static decode(script: Script): OpNSData | null {
		try {
			const bin = script.toBinary()
			for (let i = 0; i < OPNS_CONTRACT_BYTES.length; i++) {
				if (bin[i] !== OPNS_CONTRACT_BYTES[i]) return null
			}
			// State starts after the contract plus OP_RETURN + OP_FALSE.
			const state = Script.fromBinary(bin.slice(OPNS_CONTRACT_BYTES.length + 2))
			const genesis = state.chunks[0]?.data
			if (genesis == null) return null
			for (let i = 0; i < OPNS_GENESIS_BYTES.length; i++) {
				if (genesis[i] !== OPNS_GENESIS_BYTES[i]) return null
			}
			const domainData = state.chunks[2]?.data ?? []
			return {
				claimed: state.chunks[1]?.data ?? [],
				domain: Utils.toUTF8(domainData),
				pow: state.chunks[3]?.data ?? [],
			}
		} catch {
			return null
		}
	}

	/**
	 * Sets the bit for a claimed character in the node's bitfield.
	 *
	 * @param claimed - Current claimed bitfield (little-endian)
	 * @param char - Character byte to mark claimed
	 * @returns Updated claimed bitfield
	 */
	static claimBit(claimed: number[], char: number): number[] {
		let bits = 0n
		for (const b of [...claimed].reverse()) bits = (bits << 8n) | BigInt(b)
		bits |= 1n << BigInt(char)

		const out: number[] = []
		for (let v = bits; v > 0n; v >>= 8n) out.unshift(Number(v & 0xffn))
		// Sign guard: keep the value positive when the top byte's MSB is set.
		if ((out[0] & 0x80) !== 0) out.unshift(0)
		return out.reverse()
	}

	/**
	 * Builds the 1Sat ordinal inscription for a mined name, locked to
	 * ownerScript.
	 *
	 * @param domain - The mined name
	 * @param ownerScript - The owner's locking script (prefix)
	 * @returns The inscription locking script
	 */
	static buildInscription(domain: string, ownerScript: Script): Script {
		return new Script()
			.writeScript(ownerScript)
			.writeOpCode(OP.OP_FALSE)
			.writeOpCode(OP.OP_IF)
			.writeBin(Utils.toArray('ord', 'utf8'))
			.writeOpCode(OP.OP_1)
			.writeBin(Utils.toArray(OPNS_CONTENT_TYPE, 'utf8'))
			.writeOpCode(OP.OP_0)
			.writeBin(Utils.toArray(domain, 'utf8'))
			.writeOpCode(OP.OP_ENDIF)
			.writeOpCode(OP.OP_RETURN)
			.writeBin(Utils.toArray(OPNS_BITCOM, 'utf8'))
			.writeBin(OPNS_GENESIS_BYTES)
	}

	/**
	 * Tests whether a nonce solves the proof-of-work for a character: the
	 * top OPNS_DIFFICULTY bits of the reversed sha256d(pow ‖ char ‖ nonce)
	 * must be zero.
	 *
	 * @param pow - The node's pow root (32 bytes)
	 * @param char - Character byte being mined
	 * @param nonce - Candidate nonce (32 bytes)
	 * @returns The solution hash if valid, otherwise null
	 */
	static testSolution(
		pow: number[],
		char: number,
		nonce: number[],
	): number[] | null {
		const preimage = [...pow, char, ...nonce]
		const hash = Hash.sha256(Hash.sha256(preimage))
		const fullBytes = Math.floor(OPNS_DIFFICULTY / 8)
		for (let i = 0; i < fullBytes; i++) {
			if (hash[31 - i] !== 0) return null
		}
		const rem = OPNS_DIFFICULTY % 8
		if (rem > 0) {
			const mask = (0xff << (8 - rem)) & 0xff
			if ((hash[31 - fullBytes] & mask) !== 0) return null
		}
		return hash
	}

	/**
	 * Serializes a transaction output (8-byte LE value + varint length +
	 * script) as the covenant expects in trailingOutputs.
	 *
	 * @param satoshis - Output value
	 * @param script - Locking script bytes
	 * @returns Serialized output bytes
	 */
	static buildOutput(satoshis: number, script: number[]): number[] {
		const writer = new Utils.Writer()
		writer.writeUInt64LEBn(new BigNumber(satoshis))
		writer.writeVarIntNum(script.length)
		writer.write(script)
		return writer.toArray()
	}

	/**
	 * Builds the keyless covenant unlock for a mined character. The unlock
	 * pushes char, nonce, ownerScript, the serialized trailing outputs (those
	 * beyond the three mandated by the covenant), and the BIP-143 preimage.
	 *
	 * @param char - Character byte being mined
	 * @param nonce - The winning nonce (32 bytes)
	 * @param ownerScript - The owner's locking script for the name
	 * @returns Unlock template with sign and estimateLength methods
	 */
	static unlock(
		char: number,
		nonce: number[],
		ownerScript: Script,
	): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: (tx: Transaction, inputIndex: number) => Promise<number>
	} {
		return {
			sign: async (tx: Transaction, inputIndex: number) => {
				const input = tx.inputs[inputIndex]
				const sourceTXID =
					input.sourceTXID ?? input.sourceTransaction?.id('hex')
				if (!sourceTXID) {
					throw new Error(
						'The input sourceTXID or sourceTransaction is required for signing.',
					)
				}
				const sourceOutput =
					input.sourceTransaction?.outputs[input.sourceOutputIndex]
				if (!sourceOutput?.satoshis || !sourceOutput.lockingScript) {
					throw new Error(
						'The input sourceTransaction is required for signing the covenant.',
					)
				}

				const preimage = TransactionSignature.format({
					sourceTXID,
					sourceOutputIndex: input.sourceOutputIndex,
					sourceSatoshis: sourceOutput.satoshis,
					transactionVersion: tx.version,
					otherInputs: [],
					inputIndex,
					outputs: tx.outputs,
					inputSequence: input.sequence ?? 0xffffffff,
					subscript: sourceOutput.lockingScript,
					lockTime: tx.lockTime,
					scope:
						TransactionSignature.SIGHASH_ALL |
						TransactionSignature.SIGHASH_ANYONECANPAY |
						TransactionSignature.SIGHASH_FORKID,
				})

				// Trailing outputs are those beyond the three the covenant mandates.
				const trailing: number[] = []
				for (const out of tx.outputs.slice(3)) {
					trailing.push(
						...OpNS.buildOutput(
							out.satoshis ?? 0,
							(out.lockingScript ?? new Script()).toBinary(),
						),
					)
				}

				return new UnlockingScript()
					.writeBin([char])
					.writeBin(nonce)
					.writeBin(ownerScript.toBinary())
					.writeBin(trailing)
					.writeBin(preimage)
			},
			estimateLength: async (tx: Transaction, inputIndex: number) => {
				return (
					await OpNS.unlock(char, nonce, ownerScript).sign(tx, inputIndex)
				).toBinary().length
			},
		}
	}
}
