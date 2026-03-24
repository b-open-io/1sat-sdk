import {
	BSM,
	BigNumber,
	Hash,
	type LockingScript,
	OP,
	type PrivateKey,
	type PublicKey,
	Script,
	type ScriptTemplate,
	Signature,
	SignedMessage,
	Transaction,
	type TransactionOutput,
	type UnlockingScript,
	Utils,
} from '@bsv/sdk'
import BitCom, { type Protocol, type BitComDecoded } from './bitcom.js'

const { magicHash } = BSM
const { toHex, toArray, toUTF8, toBase64 } = Utils

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SIGMA protocol identifier */
export const SIGMA_PREFIX = 'SIGMA'

/** Hex-encoded SIGMA prefix for ASM construction */
export const sigmaHex = '5349474d41'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Signing algorithm for SIGMA signatures */
export enum SigmaAlgorithm {
	BSM = 'BSM',
	BRC77 = 'BRC77',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed signature from a transaction output */
export type Sig = {
	address: string
	/** Base64-encoded compact signature */
	signature: string
	algorithm: SigmaAlgorithm
	vin: number
	targetVout: number
}

/** Result of a sign operation — includes the mutated transaction */
export interface SignResponse extends Sig {
	sigmaScript: Script
	signedTx: Transaction
}

/** Auth token for remote signing endpoints */
export type AuthToken = {
	type: 'header' | 'query'
	value: string
	key: string
}

/** Response from a remote signing server */
export type RemoteSigningResponse = {
	address: string
	sig: string
	message: string
	ts: number
	recovery: number
}

/**
 * SIGMA signature data for the data-container / ScriptTemplate mode.
 * Used by static decode/sign methods and the BitCom integration.
 */
export interface SigmaData {
	bitcomIndex?: number
	algorithm: SigmaAlgorithm
	address: string
	/** Raw signature bytes (number array) */
	signature: number[]
	vin: number
	valid?: boolean
}

/** Options for the static hash-level sign helper */
export interface SigmaOptions {
	algorithm?: SigmaAlgorithm
	vin?: number
	verifier?: PublicKey
}

// ---------------------------------------------------------------------------
// Module-level helpers (private)
// ---------------------------------------------------------------------------

/** Convert hex string to byte array */
const hexToBytes = (hex: string): number[] => {
	const bytes: number[] = []
	for (let i = 0; i < hex.length; i += 2) {
		bytes.push(Number.parseInt(hex.substring(i, i + 2), 16))
	}
	return bytes
}

/** Write a 32-bit unsigned integer in little-endian format */
const writeUint32LE = (value: number): number[] => [
	value & 0xff,
	(value >> 8) & 0xff,
	(value >> 16) & 0xff,
	(value >> 24) & 0xff,
]

/**
 * Deduce the recovery factor for a BSM signature.
 * Tries factors 0–3, returns the first that recovers to the given address.
 * Returns -1 if none match.
 */
const deduceRecovery = (
	signature: Signature,
	message: number[],
	address: string,
): number => {
	for (let recovery = 0; recovery < 4; recovery++) {
		try {
			const publicKey = signature.RecoverPublicKey(
				recovery,
				new BigNumber(magicHash(message)),
			)
			if (
				BSM.verify(message, signature, publicKey) &&
				publicKey.toAddress() === address
			) {
				return recovery
			}
		} catch {
			// try next
		}
	}
	return -1
}

// ---------------------------------------------------------------------------
// Script parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse all SIGMA instances from a script using chunk-based parsing.
 * Handles both standard format (SIGMA as data chunk) and OP_RETURN embedded format.
 */
function parseSigmaInstances(script: Script, targetVout: number): Sig[] {
	const instances: Sig[] = []
	const chunks = script.chunks

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i]

		if (chunk.data && toUTF8(chunk.data) === SIGMA_PREFIX) {
			if (i + 4 < chunks.length) {
				const algo = chunks[i + 1]
				const addr = chunks[i + 2]
				const sig = chunks[i + 3]
				const vin = chunks[i + 4]
				if (algo?.data && addr?.data && sig?.data && vin?.data) {
					instances.push({
						algorithm: toUTF8(algo.data) as SigmaAlgorithm,
						address: toUTF8(addr.data),
						signature: toBase64(sig.data),
						vin: Number.parseInt(toUTF8(vin.data), 10),
						targetVout,
					})
					i += 4
				}
			}
		} else if (
			chunk.op === OP.OP_RETURN &&
			chunk.data &&
			chunk.data.length > 0
		) {
			try {
				const inner = Script.fromBinary(chunk.data).chunks
				for (let j = 0; j < inner.length; j++) {
					const ic = inner[j]
					if (ic.data && toUTF8(ic.data) === SIGMA_PREFIX) {
						if (j + 4 < inner.length) {
							const algo = inner[j + 1]
							const addr = inner[j + 2]
							const sig = inner[j + 3]
							const vin = inner[j + 4]
							if (algo?.data && addr?.data && sig?.data && vin?.data) {
								instances.push({
									algorithm: toUTF8(algo.data) as SigmaAlgorithm,
									address: toUTF8(addr.data),
									signature: toBase64(sig.data),
									vin: Number.parseInt(toUTF8(vin.data), 10),
									targetVout,
								})
								j += 4
							}
						}
					}
				}
			} catch {
				// inner script parse failed — continue
			}
		}
	}

	return instances
}

/** Count SIGMA instances in a script */
function countSigmaInstances(script: Script): number {
	return parseSigmaInstances(script, 0).length
}

/**
 * Find the chunk index where the Nth SIGMA instance starts.
 * Returns -1 if not found.
 */
function findSigmaPosition(script: Script, instanceIndex: number): number {
	const chunks = script.chunks
	let occurrences = 0

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i]

		if (chunk.data && toUTF8(chunk.data) === SIGMA_PREFIX) {
			if (occurrences === instanceIndex) return i
			occurrences++
		} else if (
			chunk.op === OP.OP_RETURN &&
			chunk.data &&
			chunk.data.length > 0
		) {
			try {
				for (const ic of Script.fromBinary(chunk.data).chunks) {
					if (ic.data && toUTF8(ic.data) === SIGMA_PREFIX) {
						if (occurrences === instanceIndex) return i
						occurrences++
					}
				}
			} catch {
				// continue
			}
		}
	}

	return -1
}

// ---------------------------------------------------------------------------
// Sigma class — transaction-centric implementation with ScriptTemplate layer
// ---------------------------------------------------------------------------

/**
 * SIGMA (Secure Identity for Global Message Authentication)
 *
 * Combines an input hash (SHA256 of the outpoint from a specific input) with
 * a data hash (SHA256 of the script data before the SIGMA marker) to produce
 * a message that is signed with BSM or BRC-77.
 *
 * Supports multiple signatures on the same output (instance targeting),
 * signature replacement (for fee estimation with dummy sigs), remote signing
 * via HTTP, and both BSM and BRC-77 algorithms.
 *
 * Also implements ScriptTemplate for integration with the @bsv/sdk template
 * system, and provides static utility methods for hash-level operations.
 */
export default class Sigma implements ScriptTemplate {
	// -- Transaction-centric state --
	private _inputHash: number[] | null = null
	private _dataHash: number[] | null = null
	private _transaction: Transaction | null = null
	private _sigmaInstance = 0
	private _refVin = 0
	private _targetVout = 0
	private _sig: Sig | null = null

	// -- Data-container state (for static decode/sign and ScriptTemplate) --
	public data: SigmaData

	// -----------------------------------------------------------------------
	// Constructor overloads
	// -----------------------------------------------------------------------

	/** Transaction-centric mode: operate on a live transaction */
	constructor(
		transaction: Transaction,
		targetVout?: number,
		sigmaInstance?: number,
		refVin?: number,
	)
	/** Data-container mode: wrap parsed signature data (from decode/sign) */
	constructor(data: SigmaData)
	constructor(
		arg: Transaction | SigmaData,
		targetVout = 0,
		sigmaInstance = 0,
		refVin = 0,
	) {
		if (arg instanceof Transaction) {
			this._transaction = arg
			this._targetVout = targetVout
			this._sigmaInstance = sigmaInstance
			this._refVin = refVin
			// Initialize data from the parsed sig (if any)
			this.data = {
				algorithm: SigmaAlgorithm.BSM,
				address: '',
				signature: [],
				vin: refVin,
			}
			this._sig = this.sig
			this.setHashes()
		} else {
			this.data = arg
			this._transaction = null
		}
	}

	// -----------------------------------------------------------------------
	// Hash computation
	// -----------------------------------------------------------------------

	setHashes = (): void => {
		this._inputHash = this.getInputHash()
		this._dataHash = this.getDataHash()
	}

	setTargetVout = (targetVout: number): void => {
		this._targetVout = targetVout
	}

	setSigmaInstance = (sigmaInstance: number): void => {
		this._sigmaInstance = sigmaInstance
		this.setHashes()
	}

	getMessageHash(): number[] {
		if (!this._inputHash || !this._dataHash) {
			throw new Error('Input hash and data hash must be set')
		}
		const combined = new Uint8Array(
			this._inputHash.length + this._dataHash.length,
		)
		combined.set(this._inputHash, 0)
		combined.set(this._dataHash, this._inputHash.length)
		return Hash.sha256(Array.from(combined))
	}

	getInputHash = (): number[] => {
		if (!this._transaction) return Hash.sha256(new Array(32).fill(0))
		// refVin === -1 means "use the targetVout index as the input index"
		// for partially-signed transactions where the anchor input index is unknown
		const vin = this._refVin === -1 ? this._targetVout : this._refVin
		return this._getInputHashByVin(vin)
	}

	private _getInputHashByVin = (vin: number): number[] => {
		if (!this._transaction) return Hash.sha256(new Array(32).fill(0))
		const txIn = this._transaction.inputs[vin]
		if (txIn?.sourceTXID) {
			const txidBytes = hexToBytes(txIn.sourceTXID)
			const indexBytes = writeUint32LE(txIn.sourceOutputIndex)
			return Hash.sha256([...txidBytes, ...indexBytes])
		}
		return Hash.sha256(new Array(32).fill(0))
	}

	/**
	 * Compute the data hash for the current sigma instance.
	 * Walks the target output script to find the Nth SIGMA marker,
	 * then hashes all script data before it.
	 */
	getDataHash = (): number[] => {
		if (!this._transaction) {
			throw new Error('No transaction provided')
		}
		const outputScript =
			this._transaction.outputs[this._targetVout].lockingScript
		const chunks = outputScript.chunks
		let occurrences = 0

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i]

			// Standard format: SIGMA as a data chunk
			if (chunk.data && toUTF8(chunk.data) === SIGMA_PREFIX) {
				if (occurrences === this._sigmaInstance) {
					// Hash everything before the separator (i - 1 for the pipe/OP_RETURN)
					const dataChunks = chunks.slice(0, i - 1)
					const dataScript = new Script()
					for (const c of dataChunks) {
						if (c.op !== undefined && c.data === undefined)
							dataScript.writeOpCode(c.op)
						else if (c.data) dataScript.writeBin(c.data)
					}
					return Hash.sha256(dataScript.toBinary())
				}
				occurrences++
			}
			// OP_RETURN embedded format
			else if (
				chunk.op === OP.OP_RETURN &&
				chunk.data &&
				chunk.data.length > 0
			) {
				try {
					for (const ic of Script.fromBinary(chunk.data).chunks) {
						if (ic.data && toUTF8(ic.data) === SIGMA_PREFIX) {
							if (occurrences === this._sigmaInstance) {
								// Hash everything before the OP_RETURN chunk
								const dataChunks = chunks.slice(0, i)
								const dataScript = new Script()
								for (const c of dataChunks) {
									if (c.op !== undefined && c.data === undefined)
										dataScript.writeOpCode(c.op)
									else if (c.data) dataScript.writeBin(c.data)
								}
								return Hash.sha256(dataScript.toBinary())
							}
							occurrences++
						}
					}
				} catch {
					// continue
				}
			}
		}

		// No SIGMA found — hash the entire script
		return Hash.sha256(outputScript.toBinary())
	}

	// -----------------------------------------------------------------------
	// Transaction accessors
	// -----------------------------------------------------------------------

	get transaction(): Transaction {
		if (!this._transaction)
			throw new Error(
				'No transaction — Sigma was constructed in data-container mode',
			)
		return this._transaction
	}

	get targetTxOut(): TransactionOutput | null {
		if (!this._transaction) return null
		return this._transaction.outputs[this._targetVout] || null
	}

	/** Parse the signature for the current sigma instance from the transaction */
	get sig(): Sig | null {
		if (!this._transaction) return this._sig
		const output = this._transaction.outputs[this._targetVout]
		if (!output?.lockingScript) return this._sig
		const instances = parseSigmaInstances(
			output.lockingScript,
			this._targetVout,
		)
		if (instances.length === 0) return this._sig
		return instances[this._sigmaInstance] ?? null
	}

	getSigInstanceCount(): number {
		const script = this.targetTxOut?.lockingScript
		if (!script) return 0
		return countSigmaInstances(script)
	}

	getSigInstancePosition(): number {
		const script = this.targetTxOut?.lockingScript
		if (!script) return -1
		return findSigmaPosition(script, this._sigmaInstance)
	}

	// -----------------------------------------------------------------------
	// Transaction-level signing
	// -----------------------------------------------------------------------

	/**
	 * Apply signature to the transaction output.
	 * Determines the separator (pipe if OP_RETURN exists, otherwise OP_RETURN).
	 * Replaces existing instance if targeting an occupied slot, otherwise appends.
	 */
	private _applySignature(signedAsm: string, sig: Sig): SignResponse {
		const sigmaScript = Script.fromASM(signedAsm)
		this._sig = sig

		let existingAsm = this.targetTxOut?.lockingScript.toASM()
		const containsOpReturn = existingAsm?.split(' ').includes('OP_RETURN')
		const separator = containsOpReturn ? '7c' : 'OP_RETURN'

		// Replace existing instance if one already exists at this index
		const existingSig = this.sig
		if (existingSig && this._sigmaInstance === this.getSigInstanceCount()) {
			const scriptChunks = existingAsm?.split(' ') || []
			const sigIndex = this.getSigInstancePosition()
			if (sigIndex !== -1) {
				scriptChunks.splice(sigIndex, 5, ...signedAsm.split(' '))
				existingAsm = scriptChunks.join(' ')
			}
		}

		const newScriptAsm = `${existingAsm} ${separator} ${signedAsm}`
		const newScript = Script.fromASM(newScriptAsm)

		const signedTx = new Transaction(
			this._transaction!.version,
			this._transaction!.inputs.map((i) => ({ ...i })),
			this._transaction!.outputs.map((o) => ({ ...o })),
		)
		signedTx.outputs[this._targetVout] = {
			satoshis: this.targetTxOut?.satoshis,
			lockingScript: newScript,
		} as TransactionOutput

		this._transaction = signedTx

		return { sigmaScript, signedTx, ...this._sig }
	}

	/** Internal BSM signing — builds hex ASM and applies to transaction */
	_sign(signature: Signature, address: string, recovery: number): SignResponse {
		if (recovery === undefined) {
			throw new Error('Failed recovery missing')
		}

		const vin = this._refVin === -1 ? this._targetVout : this._refVin
		const signedAsm = `${sigmaHex} ${toHex(toArray(SigmaAlgorithm.BSM))} ${toHex(toArray(address))} ${signature.toCompact(recovery, true, 'hex')} ${toHex(toArray(vin.toString()))}`

		const sig: Sig = {
			algorithm: SigmaAlgorithm.BSM,
			address,
			signature: signature.toCompact(recovery, true, 'base64') as string,
			vin,
			targetVout: this._targetVout,
		}

		return this._applySignature(signedAsm, sig)
	}

	/**
	 * Sign with SIGMA protocol.
	 * Computes the message hash from the transaction, signs, and mutates the output.
	 *
	 * @param privateKey - Signing key
	 * @param algorithm - BSM (default) or BRC77
	 * @param verifier - For BRC-77, optional public key of specific verifier
	 */
	sign(
		privateKey: PrivateKey,
		algorithm: SigmaAlgorithm = SigmaAlgorithm.BSM,
		verifier?: PublicKey,
	): SignResponse {
		const message = this.getMessageHash()

		if (algorithm === SigmaAlgorithm.BRC77) {
			return this._signBRC77(message, privateKey, verifier)
		}

		const signature = BSM.sign(message, privateKey, 'raw') as Signature
		const address = privateKey.toAddress()
		const h = new BigNumber(magicHash(message))
		const recovery = signature.CalculateRecoveryFactor(
			privateKey.toPublicKey(),
			h,
		)

		return this._sign(signature, address, recovery)
	}

	/** Internal BRC-77 signing */
	private _signBRC77(
		message: number[],
		privateKey: PrivateKey,
		verifier?: PublicKey,
	): SignResponse {
		const vin = this._refVin === -1 ? this._targetVout : this._refVin
		const address = privateKey.toAddress()
		const brc77Sig = SignedMessage.sign(message, privateKey, verifier)

		const signedAsm = `${sigmaHex} ${toHex(toArray(SigmaAlgorithm.BRC77))} ${toHex(toArray(address))} ${toHex(brc77Sig)} ${toHex(toArray(vin.toString()))}`

		const sig: Sig = {
			algorithm: SigmaAlgorithm.BRC77,
			address,
			signature: toBase64(brc77Sig),
			vin,
			targetVout: this._targetVout,
		}

		return this._applySignature(signedAsm, sig)
	}

	/**
	 * Sign via a remote signing server.
	 * POSTs the message hash to `keyHost/sign` and applies the returned signature.
	 */
	async remoteSign(
		keyHost: string,
		authToken?: AuthToken,
	): Promise<SignResponse> {
		const headers = authToken ? { [authToken.key]: authToken.value } : {}
		const url = `${keyHost}/sign${authToken?.type === 'query' ? `?${authToken.key}=${authToken.value}` : ''}`

		const requestBody = {
			message: toHex(this.getMessageHash()),
			encoding: 'hex',
		}

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					...headers,
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify(requestBody),
			})

			if (!response.ok) {
				const errorBody = await response.text()
				console.error('Response Error:', errorBody)
				throw new Error(`HTTP Error: ${response.status}`)
			}

			const data = (await response.json()) as RemoteSigningResponse
			const signature = Signature.fromCompact(data.sig, 'base64')
			return this._sign(signature, data.address, data.recovery)
		} catch (error) {
			console.error('Fetch Error:', error)
			throw error
		}
	}

	// -----------------------------------------------------------------------
	// Verification
	// -----------------------------------------------------------------------

	/**
	 * Verify the signature on the current transaction.
	 * For BRC-77 private signatures, pass the recipient's private key.
	 */
	verify = (recipientPrivateKey?: PrivateKey): boolean => {
		// Transaction-centric mode: compute hashes and verify
		if (this._transaction) {
			if (!this.sig) throw new Error('No signature data provided')
			const msgHash = this.getMessageHash()
			if (!msgHash) throw new Error('No tx data provided')

			if (this.sig.algorithm === SigmaAlgorithm.BRC77) {
				const sigBytes = toArray(this.sig.signature, 'base64')
				return SignedMessage.verify(msgHash, sigBytes, recipientPrivateKey)
			}

			const signature = Signature.fromCompact(this.sig.signature, 'base64')
			return deduceRecovery(signature, msgHash, this.sig.address) !== -1
		}

		// Data-container mode: return cached valid flag
		return this.data.valid === true
	}

	/**
	 * Verify SIGMA signature against externally-provided hashes.
	 * Used in data-container mode (from decode/static sign).
	 */
	verifyWithHashes(
		inputHash: number[],
		dataHash: number[],
		recipientPrivateKey?: PrivateKey,
	): boolean {
		try {
			const messageHash = [...inputHash, ...dataHash]

			if (this.data.algorithm === SigmaAlgorithm.BRC77) {
				this.data.valid = SignedMessage.verify(
					messageHash,
					this.data.signature,
					recipientPrivateKey,
				)
				return this.data.valid
			}

			const signatureBase64 = toBase64(this.data.signature)
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
					// try next
				}
			}

			this.data.valid = false
			return false
		} catch {
			this.data.valid = false
			return false
		}
	}

	// -----------------------------------------------------------------------
	// ScriptTemplate interface + BitCom integration (static utility layer)
	// -----------------------------------------------------------------------

	/** Extract SIGMA signatures from a BitCom-decoded transaction */
	static decode(bitcom: BitComDecoded): Sigma[] {
		const sigmas: Sigma[] = []
		if (!bitcom?.protocols?.length) return sigmas

		for (let protoIdx = 0; protoIdx < bitcom.protocols.length; protoIdx++) {
			const protocol = bitcom.protocols[protoIdx]
			if (protocol.protocol === SIGMA_PREFIX) {
				try {
					const script = Script.fromBinary(protocol.script)
					const chunks = script.chunks
					if (chunks?.length < 4) continue

					sigmas.push(
						new Sigma({
							bitcomIndex: protoIdx,
							algorithm: toUTF8(chunks[0].data ?? []) as SigmaAlgorithm,
							address: toUTF8(chunks[1].data ?? []),
							signature: Array.from(chunks[2].data ?? []),
							vin: Number.parseInt(toUTF8(chunks[3].data ?? []), 10),
							valid: undefined,
						}),
					)
				} catch {
					// skip malformed
				}
			}
		}

		return sigmas
	}

	/** Decode SIGMA signatures directly from a Script */
	static decodeFromScript(script: Script | LockingScript): Sigma[] {
		const bitcom = BitCom.decode(script)
		if (bitcom == null) return []
		return Sigma.decode(bitcom)
	}

	/**
	 * Create a SIGMA signature from pre-computed hashes (hash-level helper).
	 * Returns a data-container Sigma — does not require a transaction.
	 */
	static createSignature(
		inputHash: number[],
		dataHash: number[],
		privateKey: PrivateKey,
		options: SigmaOptions = {},
	): Sigma {
		const algorithm = options.algorithm ?? SigmaAlgorithm.BSM
		const vin = options.vin ?? 0
		const address = privateKey.toAddress().toString()
		const messageHash = [...inputHash, ...dataHash]

		let signatureArray: number[]

		if (algorithm === SigmaAlgorithm.BRC77) {
			signatureArray = SignedMessage.sign(
				messageHash,
				privateKey,
				options.verifier,
			)
		} else {
			const sig = BSM.sign(messageHash, privateKey, 'raw') as Signature
			const recovery = sig.CalculateRecoveryFactor(
				privateKey.toPublicKey(),
				new BigNumber(BSM.magicHash(messageHash)),
			)
			const compactSig = sig.toCompact(recovery, true, 'base64') as string
			signatureArray = Array.from(toArray(compactSig, 'base64'))
		}

		return new Sigma({
			algorithm,
			address,
			signature: signatureArray,
			vin,
			valid: true,
		})
	}

	/** Generate locking script for SIGMA within BitCom */
	lock(): LockingScript {
		const script = new Script()
		script.writeBin(toArray(this.data.algorithm, 'utf8'))
		script.writeBin(toArray(this.data.address, 'utf8'))
		script.writeBin(this.data.signature)
		script.writeBin(toArray(this.data.vin.toString(), 'utf8'))

		const protocols: Protocol[] = [
			{
				protocol: SIGMA_PREFIX,
				script: script.toBinary(),
				pos: 0,
			},
		]

		return new BitCom(protocols).lock()
	}

	/** SIGMA signatures cannot be unlocked */
	unlock(): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		throw new Error('SIGMA signatures cannot be unlocked')
	}
}
