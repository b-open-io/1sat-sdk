import {
	BSM,
	BigNumber,
	type LockingScript,
	type PrivateKey,
	type PublicKey,
	Script,
	type ScriptTemplate,
	Signature,
	SignedMessage,
	type Transaction,
	type UnlockingScript,
	Utils,
} from '@bsv/sdk'
import BitCom, { type Protocol, type BitComDecoded } from './bitcom.js'

/**
 * SIGMA protocol identifier
 */
export const SIGMA_PREFIX = 'SIGMA'

/**
 * Signing algorithm for SIGMA signatures
 */
export enum SigmaAlgorithm {
	BSM = 'BSM',
	BRC77 = 'BRC77',
}

/**
 * SIGMA signature data structure
 */
export interface SigmaData {
	/** BitCom protocol index */
	bitcomIndex?: number
	/** Signing algorithm (BSM or BRC77) */
	algorithm: SigmaAlgorithm
	/** Bitcoin address of signer */
	address: string
	/** Cryptographic signature as number array */
	signature: number[]
	/** Input index (vin) that anchors the signature */
	vin: number
	/** Whether signature verification passed */
	valid?: boolean
}

/**
 * Options for SIGMA signature creation
 */
export interface SigmaOptions {
	/** Signing algorithm (default: BSM) */
	algorithm?: SigmaAlgorithm
	/** Input index to anchor signature (default: 0) */
	vin?: number
	/** For BRC-77: specific verifier public key (private signature) */
	verifier?: PublicKey
}

/**
 * SIGMA (Secure Identity for Global Message Authentication) implementation
 *
 * SIGMA enables cryptographic signing of blockchain content by combining:
 * - Input hash: SHA256 of the outpoint (txid + vout) from a specific input
 * - Data hash: SHA256 of the script data before the SIGMA protocol marker
 *
 * Supports both BSM (Bitcoin Signed Message) and BRC-77 signing algorithms.
 */
export default class Sigma implements ScriptTemplate {
	public readonly data: SigmaData

	constructor(data: SigmaData) {
		this.data = data
	}

	/**
	 * Extract SIGMA signatures from BitCom transaction
	 */
	static decode(bitcom: BitComDecoded): Sigma[] {
		const sigmas: Sigma[] = []

		if (bitcom?.protocols?.length === 0) {
			return sigmas
		}

		for (let protoIdx = 0; protoIdx < bitcom.protocols.length; protoIdx++) {
			const protocol = bitcom.protocols[protoIdx]
			if (protocol.protocol === SIGMA_PREFIX) {
				try {
					const script = Script.fromBinary(protocol.script)
					const chunks = script.chunks

					if (chunks?.length < 4) {
						continue
					}

					const sigma = new Sigma({
						bitcomIndex: protoIdx,
						algorithm: Utils.toUTF8(chunks[0].data ?? []) as SigmaAlgorithm,
						address: Utils.toUTF8(chunks[1].data ?? []),
						signature: Array.from(chunks[2].data ?? []),
						vin: Number.parseInt(Utils.toUTF8(chunks[3].data ?? []), 10),
						valid: undefined,
					})

					sigmas.push(sigma)
				} catch {}
			}
		}

		return sigmas
	}

	/**
	 * Decode SIGMA signatures directly from a Script
	 */
	static decodeFromScript(script: Script | LockingScript): Sigma[] {
		const bitcom = BitCom.decode(script)
		if (bitcom == null) {
			return []
		}
		return Sigma.decode(bitcom)
	}

	/**
	 * Create SIGMA signature for data
	 *
	 * @param inputHash - SHA256 hash of the input outpoint
	 * @param dataHash - SHA256 hash of the script data
	 * @param privateKey - Private key for signing
	 * @param options - Additional signing options
	 */
	static sign(
		inputHash: number[],
		dataHash: number[],
		privateKey: PrivateKey,
		options: SigmaOptions = {},
	): Sigma {
		const algorithm = options.algorithm ?? SigmaAlgorithm.BSM
		const vin = options.vin ?? 0
		const address = privateKey.toAddress().toString()

		// Combine hashes to create the message
		const messageHash = [...inputHash, ...dataHash]

		let signatureArray: number[]

		if (algorithm === SigmaAlgorithm.BRC77) {
			// BRC-77 signing using SignedMessage
			const brc77Sig = SignedMessage.sign(
				messageHash,
				privateKey,
				options.verifier,
			)
			signatureArray = brc77Sig
		} else {
			// BSM signing
			const sig = BSM.sign(messageHash, privateKey, 'raw') as Signature
			const magicHashValue = BSM.magicHash(messageHash)
			const recoveryFactor = sig.CalculateRecoveryFactor(
				privateKey.toPublicKey(),
				new BigNumber(magicHashValue),
			)
			const compactSig = sig.toCompact(recoveryFactor, true, 'base64') as string
			signatureArray = Array.from(Utils.toArray(compactSig, 'base64'))
		}

		return new Sigma({
			algorithm,
			address,
			signature: signatureArray,
			vin,
			valid: true,
		})
	}

	/**
	 * Verify SIGMA signature against provided hashes
	 *
	 * @param inputHash - SHA256 hash of the input outpoint
	 * @param dataHash - SHA256 hash of the script data
	 * @param recipientPrivateKey - For BRC-77 private signatures, the recipient's key
	 */
	verifyWithHashes(
		inputHash: number[],
		dataHash: number[],
		recipientPrivateKey?: PrivateKey,
	): boolean {
		try {
			const messageHash = [...inputHash, ...dataHash]

			if (this.data.algorithm === SigmaAlgorithm.BRC77) {
				// BRC-77 verification using SignedMessage
				this.data.valid = SignedMessage.verify(
					messageHash,
					this.data.signature,
					recipientPrivateKey,
				)
				return this.data.valid
			}

			// BSM verification
			const signatureBase64 = Utils.toBase64(this.data.signature)
			const sig = Signature.fromCompact(signatureBase64, 'base64')

			for (let recovery = 0; recovery < 4; recovery++) {
				try {
					const publicKey = sig.RecoverPublicKey(
						recovery,
						new BigNumber(BSM.magicHash(messageHash)),
					)
					if (
						BSM.verify(messageHash, sig, publicKey) &&
						publicKey.toAddress().toString() === this.data.address
					) {
						this.data.valid = true
						return true
					}
				} catch {
					// Try next recovery factor
				}
			}

			this.data.valid = false
			return false
		} catch {
			this.data.valid = false
			return false
		}
	}

	/**
	 * Check if signature was previously verified
	 */
	verify(): boolean {
		return this.data.valid === true
	}

	/**
	 * Generate locking script for SIGMA within BitCom
	 */
	lock(): LockingScript {
		const script = new Script()

		script.writeBin(Utils.toArray(this.data.algorithm, 'utf8'))
		script.writeBin(Utils.toArray(this.data.address, 'utf8'))
		script.writeBin(this.data.signature)
		script.writeBin(Utils.toArray(this.data.vin.toString(), 'utf8'))

		const protocols: Protocol[] = [
			{
				protocol: SIGMA_PREFIX,
				script: script.toBinary(),
				pos: 0,
			},
		]

		const bitcom = new BitCom(protocols)
		return bitcom.lock()
	}

	/**
	 * Unlock method is not available for SIGMA scripts
	 */
	unlock(): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		throw new Error('SIGMA signatures cannot be unlocked')
	}
}
