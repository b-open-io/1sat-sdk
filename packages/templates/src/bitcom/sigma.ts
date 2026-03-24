import {
	BSM,
	BigNumber,
	Hash,
	type LockingScript,
	OP,
	type PrivateKey,
	type PublicKey,
	Script,
	type ScriptChunk,
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

/** SIGMA protocol identifier */
export const SIGMA_PREFIX = 'SIGMA'

/** Hex-encoded SIGMA prefix for ASM construction */
export const sigmaHex = '5349474d41'

export enum SigmaAlgorithm {
	BSM = 'BSM',
	BRC77 = 'BRC77',
}

export type Sig = {
	address: string
	/** Base64-encoded compact signature */
	signature: string
	algorithm: SigmaAlgorithm
	vin: number
	targetVout: number
}

export interface SignResponse extends Sig {
	sigmaScript: Script
	signedTx: Transaction
}

/**
 * Signature data for the data-container / ScriptTemplate mode.
 * Used by static decode/sign methods and the BitCom integration.
 */
export interface SigmaData {
	bitcomIndex?: number
	algorithm: SigmaAlgorithm
	address: string
	/** Raw signature bytes */
	signature: number[]
	vin: number
	valid?: boolean
}

export interface SigmaOptions {
	algorithm?: SigmaAlgorithm
	vin?: number
	verifier?: PublicKey
}

const ZERO_INPUT = new Array(32).fill(0)

const hexToBytes = (hex: string): number[] => {
	const bytes: number[] = []
	for (let i = 0; i < hex.length; i += 2) {
		bytes.push(Number.parseInt(hex.substring(i, i + 2), 16))
	}
	return bytes
}

const writeUint32LE = (value: number): number[] => [
	value & 0xff,
	(value >> 8) & 0xff,
	(value >> 16) & 0xff,
	(value >> 24) & 0xff,
]


/**
 * Try recovery factors 0–3 for a BSM signature.
 * Returns the first factor that recovers to the given address, or -1.
 */
function deduceRecovery(
	signature: Signature,
	message: number[],
	address: string,
): number {
	for (let recovery = 0; recovery < 4; recovery++) {
		try {
			const pubKey = signature.RecoverPublicKey(
				recovery,
				new BigNumber(magicHash(message)),
			)
			if (BSM.verify(message, signature, pubKey) && pubKey.toAddress() === address) {
				return recovery
			}
		} catch {}
	}
	return -1
}

function isSigmaChunk(chunk: ScriptChunk): boolean {
	return !!chunk.data && toUTF8(chunk.data) === SIGMA_PREFIX
}

function isEmbeddedOpReturn(chunk: ScriptChunk): boolean {
	return chunk.op === OP.OP_RETURN && !!chunk.data && chunk.data.length > 0
}

function tryParseSigAt(chunks: ScriptChunk[], i: number, targetVout: number): Sig | null {
	if (i + 4 >= chunks.length) return null
	const algo = chunks[i + 1]
	const addr = chunks[i + 2]
	const sig = chunks[i + 3]
	const vin = chunks[i + 4]
	if (!algo?.data || !addr?.data || !sig?.data || !vin?.data) return null
	return {
		algorithm: toUTF8(algo.data) as SigmaAlgorithm,
		address: toUTF8(addr.data),
		signature: toBase64(sig.data),
		vin: Number.parseInt(toUTF8(vin.data), 10),
		targetVout,
	}
}

function parseSigmaInstances(script: Script, targetVout: number): Sig[] {
	const instances: Sig[] = []
	const chunks = script.chunks

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i]

		if (isSigmaChunk(chunk)) {
			const parsed = tryParseSigAt(chunks, i, targetVout)
			if (parsed) {
				instances.push(parsed)
				i += 4
			}
		} else if (isEmbeddedOpReturn(chunk)) {
			try {
				const inner = Script.fromBinary(chunk.data!).chunks
				for (let j = 0; j < inner.length; j++) {
					if (isSigmaChunk(inner[j])) {
						const parsed = tryParseSigAt(inner, j, targetVout)
						if (parsed) {
							instances.push(parsed)
							j += 4
						}
					}
				}
			} catch {}
		}
	}

	return instances
}

function countSigmaInstances(script: Script): number {
	return parseSigmaInstances(script, 0).length
}

function findSigmaPosition(script: Script, instanceIndex: number): number {
	const chunks = script.chunks
	let n = 0

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i]

		if (isSigmaChunk(chunk)) {
			if (n === instanceIndex) return i
			n++
		} else if (isEmbeddedOpReturn(chunk)) {
			try {
				for (const ic of Script.fromBinary(chunk.data!).chunks) {
					if (isSigmaChunk(ic)) {
						if (n === instanceIndex) return i
						n++
					}
				}
			} catch {}
		}
	}

	return -1
}

/**
 * SIGMA (Secure Identity for Global Message Authentication)
 *
 * Combines an input hash (SHA256 of the outpoint from a specific input) with
 * a data hash (SHA256 of the script data before the SIGMA marker) to produce
 * a message signed with BSM or BRC-77.
 *
 * Supports multiple signatures per output, signature replacement for fee
 * estimation, remote signing via HTTP, and both BSM and BRC-77 algorithms.
 *
 * Two modes:
 * - Transaction-centric: `new Sigma(tx, targetVout, sigmaInstance, refVin)`
 * - Data-container: `new Sigma(sigmaData)` for BitCom decode/ScriptTemplate
 */
export default class Sigma implements ScriptTemplate {
	private _inputHash: number[] | null = null
	private _dataHash: number[] | null = null
	private _transaction: Transaction | null = null
	private _sigmaInstance = 0
	private _refVin = 0
	private _targetVout = 0
	private _sig: Sig | null = null

	public data: SigmaData

	constructor(transaction: Transaction, targetVout?: number, sigmaInstance?: number, refVin?: number)
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
			this.data = { algorithm: SigmaAlgorithm.BSM, address: '', signature: [], vin: refVin }
			this._sig = this.sig
			this.setHashes()
		} else {
			this.data = arg
			this._transaction = null
		}
	}

	setHashes(): void {
		this._inputHash = this.getInputHash()
		this._dataHash = this.getDataHash()
	}

	setTargetVout(targetVout: number): void {
		this._targetVout = targetVout
	}

	setSigmaInstance(sigmaInstance: number): void {
		this._sigmaInstance = sigmaInstance
		this.setHashes()
	}

	getMessageHash(): number[] {
		if (!this._inputHash || !this._dataHash) {
			throw new Error('Input hash and data hash must be set')
		}
		const combined = new Uint8Array(this._inputHash.length + this._dataHash.length)
		combined.set(this._inputHash, 0)
		combined.set(this._dataHash, this._inputHash.length)
		return Hash.sha256(Array.from(combined))
	}

	getInputHash(): number[] {
		if (!this._transaction) return Hash.sha256(ZERO_INPUT)
		// refVin === -1: use targetVout as input index for partially-signed transactions
		const vin = this._refVin === -1 ? this._targetVout : this._refVin
		return this._getInputHashByVin(vin)
	}

	private _getInputHashByVin(vin: number): number[] {
		const txIn = this._transaction?.inputs[vin]
		if (txIn?.sourceTXID) {
			return Hash.sha256([...hexToBytes(txIn.sourceTXID), ...writeUint32LE(txIn.sourceOutputIndex)])
		}
		return Hash.sha256(ZERO_INPUT)
	}

	/**
	 * Compute the data hash for the current sigma instance.
	 * Walks the target output script to find the Nth SIGMA marker,
	 * then hashes all script data before it.
	 */
	getDataHash(): number[] {
		if (!this._transaction) throw new Error('No transaction provided')

		const outputScript = this._transaction.outputs[this._targetVout].lockingScript
		const chunks = outputScript.chunks
		let n = 0

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i]

			if (isSigmaChunk(chunk)) {
				if (n === this._sigmaInstance) {
					// Slice before the separator (pipe or OP_RETURN before SIGMA)
					return Hash.sha256(new Script(chunks.slice(0, i - 1)).toBinary())
				}
				n++
			} else if (isEmbeddedOpReturn(chunk)) {
				try {
					for (const ic of Script.fromBinary(chunk.data!).chunks) {
						if (isSigmaChunk(ic)) {
							if (n === this._sigmaInstance) {
								// Slice before the OP_RETURN chunk itself
								return Hash.sha256(new Script(chunks.slice(0, i)).toBinary())
							}
							n++
						}
					}
				} catch {}
			}
		}

		return Hash.sha256(outputScript.toBinary())
	}

	get transaction(): Transaction {
		if (!this._transaction) throw new Error('No transaction — constructed in data-container mode')
		return this._transaction
	}

	get targetTxOut(): TransactionOutput | null {
		return this._transaction?.outputs[this._targetVout] ?? null
	}

	get sig(): Sig | null {
		if (!this._transaction) return this._sig
		const output = this._transaction.outputs[this._targetVout]
		if (!output?.lockingScript) return this._sig
		const instances = parseSigmaInstances(output.lockingScript, this._targetVout)
		return instances.length > 0 ? (instances[this._sigmaInstance] ?? null) : this._sig
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

	private _applySignature(signedAsm: string, sig: Sig): SignResponse {
		if (!this._transaction) throw new Error('No transaction set')

		const sigmaScript = Script.fromASM(signedAsm)
		this._sig = sig

		let existingAsm = this.targetTxOut?.lockingScript.toASM()
		const separator = existingAsm?.split(' ').includes('OP_RETURN') ? '7c' : 'OP_RETURN'

		const existingSig = this.sig
		if (existingSig && this._sigmaInstance === this.getSigInstanceCount()) {
			const asmTokens = existingAsm?.split(' ') || []
			const sigIndex = this.getSigInstancePosition()
			if (sigIndex !== -1) {
				asmTokens.splice(sigIndex, 5, ...signedAsm.split(' '))
				existingAsm = asmTokens.join(' ')
			}
		}

		const newScript = Script.fromASM(`${existingAsm} ${separator} ${signedAsm}`)

		const signedTx = new Transaction(
			this._transaction.version,
			this._transaction.inputs.map((i) => ({ ...i })),
			this._transaction.outputs.map((o) => ({ ...o })),
		)
		signedTx.outputs[this._targetVout] = {
			satoshis: this.targetTxOut?.satoshis,
			lockingScript: newScript,
		} as TransactionOutput

		this._transaction = signedTx
		return { sigmaScript, signedTx, ...this._sig }
	}

	private _sign(signature: Signature, address: string, recovery: number): SignResponse {
		if (recovery === undefined) throw new Error('Recovery factor missing')

		const vin = this._refVin === -1 ? this._targetVout : this._refVin
		const signedAsm = `${sigmaHex} ${toHex(toArray(SigmaAlgorithm.BSM))} ${toHex(toArray(address))} ${signature.toCompact(recovery, true, 'hex')} ${toHex(toArray(vin.toString()))}`

		return this._applySignature(signedAsm, {
			algorithm: SigmaAlgorithm.BSM,
			address,
			signature: signature.toCompact(recovery, true, 'base64') as string,
			vin,
			targetVout: this._targetVout,
		})
	}

	private _signBRC77(message: number[], privateKey: PrivateKey, verifier?: PublicKey): SignResponse {
		const vin = this._refVin === -1 ? this._targetVout : this._refVin
		const address = privateKey.toAddress()
		const brc77Sig = SignedMessage.sign(message, privateKey, verifier)

		const signedAsm = `${sigmaHex} ${toHex(toArray(SigmaAlgorithm.BRC77))} ${toHex(toArray(address))} ${toHex(brc77Sig)} ${toHex(toArray(vin.toString()))}`

		return this._applySignature(signedAsm, {
			algorithm: SigmaAlgorithm.BRC77,
			address,
			signature: toBase64(brc77Sig),
			vin,
			targetVout: this._targetVout,
		})
	}

	/**
	 * Sign with SIGMA protocol.
	 * Computes the message hash from the transaction, signs, and mutates the output.
	 */
	sign(privateKey: PrivateKey, algorithm: SigmaAlgorithm = SigmaAlgorithm.BSM, verifier?: PublicKey): SignResponse {
		const message = this.getMessageHash()

		if (algorithm === SigmaAlgorithm.BRC77) {
			return this._signBRC77(message, privateKey, verifier)
		}

		const signature = BSM.sign(message, privateKey, 'raw') as Signature
		const address = privateKey.toAddress()
		const recovery = signature.CalculateRecoveryFactor(
			privateKey.toPublicKey(),
			new BigNumber(magicHash(message)),
		)

		return this._sign(signature, address, recovery)
	}

	/**
	 * Verify the signature. In transaction mode, computes hashes from the tx.
	 * In data-container mode, returns the cached valid flag.
	 * For BRC-77 private signatures, pass the recipient's private key.
	 */
	verify(recipientPrivateKey?: PrivateKey): boolean {
		if (this._transaction) {
			if (!this.sig) throw new Error('No signature data provided')
			const msgHash = this.getMessageHash()

			if (this.sig.algorithm === SigmaAlgorithm.BRC77) {
				return SignedMessage.verify(msgHash, toArray(this.sig.signature, 'base64'), recipientPrivateKey)
			}

			return deduceRecovery(Signature.fromCompact(this.sig.signature, 'base64'), msgHash, this.sig.address) !== -1
		}

		return this.data.valid === true
	}

	/**
	 * Verify against externally-provided hashes (data-container mode).
	 */
	verifyWithHashes(inputHash: number[], dataHash: number[], recipientPrivateKey?: PrivateKey): boolean {
		try {
			const messageHash = [...inputHash, ...dataHash]

			if (this.data.algorithm === SigmaAlgorithm.BRC77) {
				this.data.valid = SignedMessage.verify(messageHash, this.data.signature, recipientPrivateKey)
				return this.data.valid
			}

			const sig = Signature.fromCompact(toBase64(this.data.signature), 'base64')
			this.data.valid = deduceRecovery(sig, messageHash, this.data.address) !== -1
			return this.data.valid
		} catch {
			this.data.valid = false
			return false
		}
	}

	static decode(bitcom: BitComDecoded): Sigma[] {
		const sigmas: Sigma[] = []
		if (!bitcom?.protocols?.length) return sigmas

		for (let protoIdx = 0; protoIdx < bitcom.protocols.length; protoIdx++) {
			const protocol = bitcom.protocols[protoIdx]
			if (protocol.protocol === SIGMA_PREFIX) {
				try {
					const chunks = Script.fromBinary(protocol.script).chunks
					if (chunks?.length < 4) continue

					sigmas.push(new Sigma({
						bitcomIndex: protoIdx,
						algorithm: toUTF8(chunks[0].data ?? []) as SigmaAlgorithm,
						address: toUTF8(chunks[1].data ?? []),
						signature: Array.from(chunks[2].data ?? []),
						vin: Number.parseInt(toUTF8(chunks[3].data ?? []), 10),
						valid: undefined,
					}))
				} catch {}
			}
		}

		return sigmas
	}

	static decodeFromScript(script: Script | LockingScript): Sigma[] {
		const bitcom = BitCom.decode(script)
		if (bitcom == null) return []
		return Sigma.decode(bitcom)
	}

	/**
	 * Create a SIGMA signature from pre-computed hashes.
	 * Returns a data-container Sigma — does not require a transaction.
	 */
	static createSignature(inputHash: number[], dataHash: number[], privateKey: PrivateKey, options: SigmaOptions = {}): Sigma {
		const algorithm = options.algorithm ?? SigmaAlgorithm.BSM
		const vin = options.vin ?? 0
		const address = privateKey.toAddress().toString()
		const messageHash = [...inputHash, ...dataHash]

		let signatureArray: number[]

		if (algorithm === SigmaAlgorithm.BRC77) {
			signatureArray = SignedMessage.sign(messageHash, privateKey, options.verifier)
		} else {
			const sig = BSM.sign(messageHash, privateKey, 'raw') as Signature
			const recovery = sig.CalculateRecoveryFactor(
				privateKey.toPublicKey(),
				new BigNumber(BSM.magicHash(messageHash)),
			)
			signatureArray = Array.from(toArray(sig.toCompact(recovery, true, 'base64') as string, 'base64'))
		}

		return new Sigma({ algorithm, address, signature: signatureArray, vin, valid: true })
	}

	lock(): LockingScript {
		const script = new Script()
		script.writeBin(toArray(this.data.algorithm, 'utf8'))
		script.writeBin(toArray(this.data.address, 'utf8'))
		script.writeBin(this.data.signature)
		script.writeBin(toArray(this.data.vin.toString(), 'utf8'))

		return new BitCom([{ protocol: SIGMA_PREFIX, script: script.toBinary(), pos: 0 }]).lock()
	}

	unlock(): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		throw new Error('SIGMA signatures cannot be unlocked')
	}
}
