import {
	BigNumber,
	BSM,
	type LockingScript,
	OP,
	PublicKey,
	Script,
	type ScriptTemplate,
	Signature,
	type UnlockingScript,
	Utils,
} from '@bsv/sdk'
import type { Signer } from '../signer.js'
import BitCom, { type BitComDecoded, type Protocol } from './bitcom.js'

/**
 * AIP (Author Identity Protocol) prefix for BitCom transactions
 */
export const AIP_PREFIX = '15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva'

/**
 * AIP signature data structure
 */
export interface AIPData {
	/** BitCom protocol index */
	bitcomIndex?: number
	/** Signing algorithm (typically "BITCOIN_ECDSA") */
	algorithm: string
	/** Bitcoin address of signer */
	address: string
	/** Cryptographic signature as number array */
	signature: number[]
	/** Optional field indexes that were signed */
	fieldIndexes?: number[]
	/** Whether signature verification passed */
	valid?: boolean
}

/**
 * Options for AIP signature creation
 */
export interface AIPOptions {
	/** Signing algorithm (default: "BITCOIN_ECDSA") */
	algorithm?: string
	/** Specific field indexes to sign (default: sign all fields) */
	fieldIndexes?: number[]
}

/**
 * AIP (Author Identity Protocol) implementation
 *
 * AIP enables cryptographic signing of blockchain content with Bitcoin addresses,
 * providing verifiable authorship and identity verification within BitCom transactions.
 */
export default class AIP implements ScriptTemplate {
	public readonly data: AIPData

	constructor(data: AIPData) {
		this.data = data
	}

	/**
	 * Extract AIP signatures from BitCom transaction
	 *
	 * @param bitcom - Decoded BitCom transaction
	 * @returns Array of AIP signatures found in transaction
	 */
	static decode(bitcom: BitComDecoded): AIP[] {
		const aips: AIP[] = []

		// Safety check for nil
		if (bitcom?.protocols?.length === 0) {
			return aips
		}

		for (let protoIdx = 0; protoIdx < bitcom.protocols.length; protoIdx++) {
			const protocol = bitcom.protocols[protoIdx]
			if (protocol.protocol === AIP_PREFIX) {
				try {
					const script = Script.fromBinary(protocol.script)
					const chunks = script.chunks

					// Need at least algorithm, address, and signature
					if (chunks?.length < 3) {
						continue
					}

					const aip = new AIP({
						bitcomIndex: protoIdx,
						algorithm: Utils.toUTF8(chunks[0].data ?? []),
						address: Utils.toUTF8(chunks[1].data ?? []),
						signature: Array.from(chunks[2].data ?? []),
						fieldIndexes: undefined,
						valid: undefined,
					})

					// Read optional field indexes (remaining chunks)
					const fieldIndexes: number[] = []
					for (let i = 3; i < chunks.length; i++) {
						const indexStr = Utils.toUTF8(chunks[i].data ?? [])
						const index = Number.parseInt(indexStr, 10)
						if (Number.isInteger(index) && !Number.isNaN(index)) {
							fieldIndexes.push(index)
						}
						// Continue parsing even if we encounter invalid field indexes
					}

					if (fieldIndexes.length > 0) {
						aip.data.fieldIndexes = fieldIndexes
					}

					// Validate signature against protocols that came before this AIP
					AIP.validateAIP(aip, bitcom.protocols.slice(0, protoIdx))

					aips.push(aip)
				} catch {}
			}
		}

		return aips
	}

	/**
	 * Create AIP signature for data using a Signer.
	 *
	 * @param data - Data to sign as number array
	 * @param signer - A Signer (PrivateKeySigner or WalletSigner)
	 * @param options - Additional signing options
	 * @returns AIP signature object
	 */
	static async sign(
		data: number[],
		signer: Signer,
		options: AIPOptions = {},
	): Promise<AIP> {
		const algorithm = options.algorithm ?? 'BITCOIN_ECDSA'
		const bsmHash = BSM.magicHash(data)

		const derSig = await signer.signHash(Array.from(bsmHash))
		const pubKeyHex = await signer.getPublicKey()

		const publicKey = PublicKey.fromString(pubKeyHex)
		const signature = Signature.fromDER(derSig)
		const recovery = signature.CalculateRecoveryFactor(
			publicKey,
			new BigNumber(bsmHash),
		)

		const compactSig = signature.toCompact(recovery, true) as number[]

		return new AIP({
			algorithm,
			address: publicKey.toAddress(),
			signature: compactSig,
			fieldIndexes: options.fieldIndexes,
			valid: true,
		})
	}

	/**
	 * Verify AIP signature
	 *
	 * @returns True if signature is valid
	 */
	verify(): boolean {
		return this.data.valid === true
	}

	/**
	 * Generate locking script for AIP within BitCom
	 *
	 * @returns Locking script
	 */
	lock(): LockingScript {
		const script = new Script()

		// Add algorithm
		script.writeBin(Utils.toArray(this.data.algorithm, 'utf8'))

		// Add address
		script.writeBin(Utils.toArray(this.data.address, 'utf8'))

		// Add signature
		script.writeBin(this.data.signature)

		// Add field indexes if present
		if (this.data.fieldIndexes != null && this.data.fieldIndexes.length > 0) {
			for (const index of this.data.fieldIndexes) {
				script.writeBin(Utils.toArray(index.toString(), 'utf8'))
			}
		}

		// Create BitCom protocol
		const protocols: Protocol[] = [
			{
				protocol: AIP_PREFIX,
				script: script.toBinary(),
				pos: 0,
			},
		]

		const bitcom = new BitCom(protocols)
		return bitcom.lock()
	}

	/**
	 * Unlock method is not available for AIP scripts
	 *
	 * @throws Error - AIP signatures cannot be unlocked
	 */
	unlock(): {
		sign: (tx: unknown, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		throw new Error('AIP signatures cannot be unlocked')
	}

	/**
	 * Validate AIP signature against protocol data
	 *
	 * @param aip - AIP to validate
	 * @param protocols - Protocols that came before this AIP
	 */
	private static validateAIP(aip: AIP, protocols: Protocol[]): void {
		try {
			// Reconstruct signed data exactly as Go implementation
			const data: number[] = []
			let fieldIndex = 0

			// Add OP_RETURN
			data.push(OP.OP_RETURN)

			// Process each protocol
			for (const protocol of protocols) {
				// Add protocol prefix
				data.push(...Utils.toArray(protocol.protocol, 'utf8'))

				// Parse protocol script
				const script = Script.fromBinary(protocol.script)
				const chunks = script.chunks

				// Process script chunks
				for (const chunk of chunks) {
					if (chunk.data != null && chunk.data.length > 0) {
						// Check if this field should be signed
						const shouldSign =
							aip.data.fieldIndexes == null ||
							aip.data.fieldIndexes.includes(fieldIndex)

						if (shouldSign) {
							data.push(...Array.from(chunk.data))
						}
					} else if (chunk.op != null && chunk.op > 0x43 && chunk.op < 0x4f) {
						// Handle printable opcodes
						data.push(chunk.op)
					}
					fieldIndex++
				}

				// Add pipe delimiter
				data.push(0x7c) // '|'
			}

			// Verify signature using BSM following the pattern from BAP library
			const signatureBase64 = Utils.toBase64(aip.data.signature)
			const sig = Signature.fromCompact(signatureBase64, 'base64')

			// Try all recovery factors (0-3) to find the correct public key
			for (let recovery = 0; recovery < 4; recovery++) {
				try {
					const publicKey = sig.RecoverPublicKey(
						recovery,
						new BigNumber(BSM.magicHash(data)),
					)

					const sigFitsPubkey = BSM.verify(data, sig, publicKey)
					if (
						sigFitsPubkey &&
						publicKey.toAddress().toString() === aip.data.address
					) {
						aip.data.valid = true
						return
					}
				} catch {
					// Try next recovery factor
				}
			}

			aip.data.valid = false
		} catch {
			aip.data.valid = false
		}
	}
}
