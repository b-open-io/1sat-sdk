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
import BitCom, { type BitComDecoded } from './bitcom.js'

const { magicHash } = BSM
const { toHex, toArray, toUTF8, toBase64 } = Utils

export const SIGMA_PREFIX = 'SIGMA'
export const sigmaHex = '5349474d41'

export enum SigmaAlgorithm {
	BSM = 'BSM',
	BRC77 = 'BRC77',
}

export interface SigmaData {
	bitcomIndex?: number
	algorithm: SigmaAlgorithm
	address: string
	signature: number[]
	vin: number
	targetVout?: number
	valid?: boolean
}

export type Sig = {
	address: string
	signature: string
	algorithm: SigmaAlgorithm
	vin: number
	targetVout: number
}

export interface SignResponse extends Sig {
	sigmaScript: Script
	signedTx: Transaction
}

export interface SigmaOptions {
	algorithm?: SigmaAlgorithm
	vin?: number
	verifier?: PublicKey
}

const EMPTY_OUTPOINT = new Array(32).fill(0)

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
			if (
				BSM.verify(message, signature, pubKey) &&
				pubKey.toAddress() === address
			) {
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

function tryParseSigAt(
	chunks: ScriptChunk[],
	i: number,
	targetVout: number,
): Sig | null {
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

/**
 * SIGMA (Secure Identity for Global Message Authentication)
 *
 * Combines an input hash (SHA256 of an outpoint) with a data hash (SHA256 of
 * script data before the SIGMA marker) to produce a message signed with BSM
 * or BRC-77. Supports multiple signatures per output and both algorithms.
 *
 * Follows the same pattern as AIP: one data shape, static factories for
 * transaction operations, instance methods for ScriptTemplate integration.
 */
export default class Sigma implements ScriptTemplate {
	public data: SigmaData

	constructor(data: SigmaData) {
		this.data = data
	}

	static computeInputHash(
		txidOrTx: string | Transaction,
		voutOrVin: number,
		sourceOutputIndex?: number,
	): number[] {
		if (typeof txidOrTx === 'string') {
			return Hash.sha256([
				...hexToBytes(txidOrTx),
				...writeUint32LE(sourceOutputIndex ?? 0),
			])
		}
		const txIn = txidOrTx.inputs[voutOrVin]
		if (txIn?.sourceTXID) {
			return Hash.sha256([
				...hexToBytes(txIn.sourceTXID),
				...writeUint32LE(txIn.sourceOutputIndex),
			])
		}
		return Hash.sha256(EMPTY_OUTPOINT)
	}

	static computeDataHash(script: Script, sigmaInstance = 0): number[] {
		const chunks = script.chunks
		let n = 0

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i]

			if (isSigmaChunk(chunk)) {
				if (n === sigmaInstance) {
					return Hash.sha256(new Script(chunks.slice(0, i - 1)).toBinary())
				}
				n++
			} else if (isEmbeddedOpReturn(chunk)) {
				try {
					for (const ic of Script.fromBinary(chunk.data!).chunks) {
						if (isSigmaChunk(ic)) {
							if (n === sigmaInstance) {
								return Hash.sha256(new Script(chunks.slice(0, i)).toBinary())
							}
							n++
						}
					}
				} catch {}
			}
		}

		return Hash.sha256(script.toBinary())
	}

	static computeMessageHash(inputHash: number[], dataHash: number[]): number[] {
		const combined = new Uint8Array(inputHash.length + dataHash.length)
		combined.set(inputHash, 0)
		combined.set(dataHash, inputHash.length)
		return Hash.sha256(Array.from(combined))
	}

	static parseFromScript(script: Script, targetVout = 0): Sig[] {
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

	static countInstances(script: Script): number {
		return Sigma.parseFromScript(script).length
	}

	static findPosition(script: Script, instanceIndex: number): number {
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

	static signTransaction(
		tx: Transaction,
		privateKey: PrivateKey,
		options: {
			targetVout?: number
			sigmaInstance?: number
			refVin?: number
			algorithm?: SigmaAlgorithm
			verifier?: PublicKey
		} = {},
	): SignResponse {
		const targetVout = options.targetVout ?? 0
		const sigmaInstance = options.sigmaInstance ?? 0
		const refVin = options.refVin ?? 0
		const algorithm = options.algorithm ?? SigmaAlgorithm.BSM
		const vin = refVin === -1 ? targetVout : refVin

		const inputHash = Sigma.computeInputHash(tx, vin)
		const dataHash = Sigma.computeDataHash(
			tx.outputs[targetVout].lockingScript,
			sigmaInstance,
		)
		const messageHash = Sigma.computeMessageHash(inputHash, dataHash)

		let signedAsm: string
		let sig: Sig

		if (algorithm === SigmaAlgorithm.BRC77) {
			const address = privateKey.toAddress()
			const brc77Sig = SignedMessage.sign(
				messageHash,
				privateKey,
				options.verifier,
			)
			signedAsm = `${sigmaHex} ${toHex(toArray(SigmaAlgorithm.BRC77))} ${toHex(toArray(address))} ${toHex(brc77Sig)} ${toHex(toArray(vin.toString()))}`
			sig = {
				algorithm: SigmaAlgorithm.BRC77,
				address,
				signature: toBase64(brc77Sig),
				vin,
				targetVout,
			}
		} else {
			const signature = BSM.sign(messageHash, privateKey, 'raw') as Signature
			const address = privateKey.toAddress()
			const recovery = signature.CalculateRecoveryFactor(
				privateKey.toPublicKey(),
				new BigNumber(magicHash(messageHash)),
			)
			signedAsm = `${sigmaHex} ${toHex(toArray(SigmaAlgorithm.BSM))} ${toHex(toArray(address))} ${signature.toCompact(recovery, true, 'hex')} ${toHex(toArray(vin.toString()))}`
			sig = {
				algorithm: SigmaAlgorithm.BSM,
				address,
				signature: signature.toCompact(recovery, true, 'base64') as string,
				vin,
				targetVout,
			}
		}

		return Sigma.applyToTransaction(
			tx,
			targetVout,
			sigmaInstance,
			signedAsm,
			sig,
		)
	}

	static verifyTransaction(
		tx: Transaction,
		targetVout = 0,
		sigmaInstance = 0,
		recipientPrivateKey?: PrivateKey,
	): boolean {
		const output = tx.outputs[targetVout]
		if (!output?.lockingScript) return false

		const instances = Sigma.parseFromScript(output.lockingScript, targetVout)
		const sig = instances[sigmaInstance]
		if (!sig) return false

		const inputHash = Sigma.computeInputHash(tx, sig.vin)
		const dataHash = Sigma.computeDataHash(output.lockingScript, sigmaInstance)
		const messageHash = Sigma.computeMessageHash(inputHash, dataHash)

		if (sig.algorithm === SigmaAlgorithm.BRC77) {
			return SignedMessage.verify(
				messageHash,
				toArray(sig.signature, 'base64'),
				recipientPrivateKey,
			)
		}

		return (
			deduceRecovery(
				Signature.fromCompact(sig.signature, 'base64'),
				messageHash,
				sig.address,
			) !== -1
		)
	}

	private static applyToTransaction(
		tx: Transaction,
		targetVout: number,
		sigmaInstance: number,
		signedAsm: string,
		sig: Sig,
	): SignResponse {
		const sigmaScript = Script.fromASM(signedAsm)
		const output = tx.outputs[targetVout]

		let existingAsm = output.lockingScript.toASM()
		const separator = existingAsm.split(' ').includes('OP_RETURN')
			? '7c'
			: 'OP_RETURN'

		const existingCount = Sigma.countInstances(output.lockingScript)
		if (existingCount > 0 && sigmaInstance === existingCount) {
			const asmTokens = existingAsm.split(' ')
			const pos = Sigma.findPosition(output.lockingScript, sigmaInstance)
			if (pos !== -1) {
				asmTokens.splice(pos, 5, ...signedAsm.split(' '))
				existingAsm = asmTokens.join(' ')
			}
		}

		const signedTx = new Transaction(
			tx.version,
			tx.inputs.map((i) => ({ ...i })),
			tx.outputs.map((o) => ({ ...o })),
		)
		signedTx.outputs[targetVout] = {
			satoshis: output.satoshis,
			lockingScript: Script.fromASM(`${existingAsm} ${separator} ${signedAsm}`),
		} as TransactionOutput

		return { sigmaScript, signedTx, ...sig }
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
			signatureArray = Array.from(
				toArray(sig.toCompact(recovery, true, 'base64') as string, 'base64'),
			)
		}

		return new Sigma({
			algorithm,
			address,
			signature: signatureArray,
			vin,
			valid: true,
		})
	}

	verify(): boolean {
		return this.data.valid === true
	}

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

			const sig = Signature.fromCompact(toBase64(this.data.signature), 'base64')
			this.data.valid =
				deduceRecovery(sig, messageHash, this.data.address) !== -1
			return this.data.valid
		} catch {
			this.data.valid = false
			return false
		}
	}

	lock(): LockingScript {
		const script = new Script()
		script.writeBin(toArray(this.data.algorithm, 'utf8'))
		script.writeBin(toArray(this.data.address, 'utf8'))
		script.writeBin(this.data.signature)
		script.writeBin(toArray(this.data.vin.toString(), 'utf8'))
		return new BitCom([
			{ protocol: SIGMA_PREFIX, script: script.toBinary(), pos: 0 },
		]).lock()
	}

	unlock(): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		throw new Error('SIGMA signatures cannot be unlocked')
	}
}
