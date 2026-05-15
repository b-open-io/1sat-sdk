import {
	LOCK_PREFIX as LOCK_PREFIX_HEX,
	LOCK_SUFFIX as LOCK_SUFFIX_HEX,
} from '@1sat/types'
import {
	Hash,
	P2PKH,
	type PrivateKey,
	Script,
	type Transaction,
	TransactionSignature,
	type UnlockingScript,
	Utils,
	type WalletInterface,
	type WalletProtocol,
} from '@bsv/sdk'

/**
 * Lock PREFIX as number array - sCrypt contract prefix shared with OrdLock template
 */
export const LOCK_PREFIX = Utils.toArray(LOCK_PREFIX_HEX, 'hex')

/**
 * Lock SUFFIX as number array - time-lock contract validation script
 */
export const LOCK_SUFFIX = Utils.toArray(LOCK_SUFFIX_HEX, 'hex')

/**
 * Lock decoded data structure
 */
export interface LockData {
	/** Owner's address (base58check encoded) */
	address: string
	/** Block height or timestamp until which the output is locked */
	until: number
}

/**
 * Finds the index of a subarray within an array
 */
function indexOf(arr: number[], subArr: number[], fromIndex = 0): number {
	for (let i = fromIndex; i <= arr.length - subArr.length; i++) {
		let found = true
		for (let j = 0; j < subArr.length; j++) {
			if (arr[i + j] !== subArr[j]) {
				found = false
				break
			}
		}
		if (found) return i
	}
	return -1
}

/**
 * Checks if an array contains a subarray
 */
function contains(arr: number[], subArr: number[], fromIndex = 0): boolean {
	return indexOf(arr, subArr, fromIndex) !== -1
}

/**
 * Lock - Time-lock template for locking outputs until a specific block height or timestamp
 *
 * The Lock template enables creating outputs that can only be spent after a certain
 * block height or Unix timestamp has been reached.
 *
 * @example
 * ```typescript
 * // Decode a Lock from a script
 * const lock = Lock.decode(script);
 * if (lock) {
 *   console.log(`Address: ${lock.address}`);
 *   console.log(`Locked until: ${lock.until}`);
 * }
 * ```
 */
export default class Lock {
	/**
	 * Decodes a Lock from a script
	 *
	 * @param script - The script to decode
	 * @param mainnet - Whether to use mainnet address prefix (default: true)
	 * @returns Decoded Lock data or null if not found/invalid
	 */
	static decode(script: Script, mainnet = true): LockData | null {
		try {
			const scriptBinary = script.toBinary()

			// Find PREFIX
			const prefixIndex = indexOf(scriptBinary, LOCK_PREFIX)
			if (prefixIndex === -1) return null

			// Check that SUFFIX exists somewhere after PREFIX
			if (!contains(scriptBinary, LOCK_SUFFIX, prefixIndex)) return null

			// Extract data starting after PREFIX
			const pos = prefixIndex + LOCK_PREFIX.length

			// Parse the data as script chunks
			const remainingBytes = scriptBinary.slice(pos)
			const dataScript = Script.fromBinary(remainingBytes)
			const chunks = dataScript.chunks

			if (chunks.length < 2) return null

			// Chunk 0: address PKHash (20 bytes)
			const addressChunk = chunks[0]
			if (addressChunk?.data == null || addressChunk.data.length !== 20)
				return null

			// Chunk 1: until value (variable length, little-endian)
			const untilChunk = chunks[1]
			if (untilChunk?.data == null) return null

			// Read little-endian uint32 (pad to 4 bytes if needed)
			const untilData = untilChunk.data
			const padded = new Uint8Array(4)
			for (let i = 0; i < Math.min(untilData.length, 4); i++) {
				padded[i] = untilData[i]
			}
			const until =
				padded[0] | (padded[1] << 8) | (padded[2] << 16) | (padded[3] << 24)

			// Convert PKHash to address
			const addressPrefix = mainnet ? [0x00] : [0x6f]
			const address = Utils.toBase58Check(addressChunk.data, addressPrefix)

			return {
				address,
				until: until >>> 0, // Ensure unsigned
			}
		} catch {
			return null
		}
	}

	/**
	 * Checks if a script contains a Lock pattern
	 *
	 * @param script - The script to check
	 * @returns true if the script contains Lock pattern
	 */
	static isLock(script: Script): boolean {
		const scriptBinary = script.toBinary()
		const prefixIndex = indexOf(scriptBinary, LOCK_PREFIX)
		if (prefixIndex === -1) return false
		return contains(scriptBinary, LOCK_SUFFIX, prefixIndex)
	}

	/**
	 * Creates a Lock locking script
	 *
	 * @param address - The address whose PKH is embedded in the lock
	 * @param until - Block height until which the output is locked
	 * @returns The locking script
	 */
	static lock(address: string, until: number): Script {
		const pkh = Utils.fromBase58Check(address).data as number[]
		return new Script()
			.writeScript(Script.fromBinary(LOCK_PREFIX))
			.writeBin(pkh)
			.writeNumber(until)
			.writeScript(Script.fromBinary(LOCK_SUFFIX))
	}

	/**
	 * Creates an unlocking script template for spending a Lock output.
	 *
	 * @param privateKey - The private key corresponding to the locked address
	 * @param sighashType - Sighash type ('all', 'none', 'single')
	 * @param anyoneCanPay - Whether SIGHASH_ANYONECANPAY is set
	 * @param sourceSatoshis - Satoshis of the source output (optional if sourceTransaction is on the input)
	 * @param lockingScript - Locking script of the source output (optional if sourceTransaction is on the input)
	 * @returns Object with sign and estimateLength methods
	 */
	static unlock(
		privateKey: PrivateKey,
		sighashType: 'all' | 'none' | 'single' = 'all',
		anyoneCanPay = false,
		sourceSatoshis?: number,
		lockingScript?: Script,
	): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: (tx: Transaction, inputIndex: number) => Promise<number>
	} {
		const unlock = {
			sign: async (tx: Transaction, inputIndex: number) => {
				let signatureScope = TransactionSignature.SIGHASH_FORKID
				if (sighashType === 'all') {
					signatureScope |= TransactionSignature.SIGHASH_ALL
				}
				if (sighashType === 'none') {
					signatureScope |= TransactionSignature.SIGHASH_NONE
				}
				if (sighashType === 'single') {
					signatureScope |= TransactionSignature.SIGHASH_SINGLE
				}
				if (anyoneCanPay) {
					signatureScope |= TransactionSignature.SIGHASH_ANYONECANPAY
				}
				const input = tx.inputs[inputIndex]

				const otherInputs = tx.inputs.filter((_, index) => index !== inputIndex)

				const sourceTXID = input.sourceTXID
					? input.sourceTXID
					: input.sourceTransaction?.id('hex')
				if (!sourceTXID) {
					throw new Error(
						'The input sourceTXID or sourceTransaction is required for transaction signing.',
					)
				}
				sourceSatoshis ||=
					input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis
				if (!sourceSatoshis) {
					throw new Error(
						'The sourceSatoshis or input sourceTransaction is required for transaction signing.',
					)
				}
				lockingScript ||=
					input.sourceTransaction?.outputs[input.sourceOutputIndex]
						.lockingScript
				if (!lockingScript) {
					throw new Error(
						'The lockingScript or input sourceTransaction is required for transaction signing.',
					)
				}

				const preimage = TransactionSignature.format({
					sourceTXID,
					sourceOutputIndex: input.sourceOutputIndex,
					sourceSatoshis,
					transactionVersion: tx.version,
					otherInputs,
					outputs: tx.outputs,
					inputIndex,
					subscript: lockingScript,
					inputSequence:
						input.sequence === undefined ? 0xffffffff : input.sequence,
					lockTime: tx.lockTime,
					scope: signatureScope,
				})

				const p2pkh = new P2PKH().unlock(
					privateKey,
					sighashType,
					anyoneCanPay,
					sourceSatoshis,
					lockingScript,
				)
				return (await p2pkh.sign(tx, inputIndex)).writeBin(preimage)
			},
			estimateLength: async (tx: Transaction, inputIndex: number) => {
				return (await unlock.sign(tx, inputIndex)).toBinary().length
			},
		}
		return unlock
	}

	/**
	 * Creates an unlocking script template using a BRC-100 wallet for signing.
	 *
	 * Uses wallet.createSignature and wallet.getPublicKey instead of a raw PrivateKey,
	 * enabling key derivation via protocolID/keyID.
	 *
	 * @param wallet - A BRC-100 WalletInterface with createSignature and getPublicKey
	 * @param protocolID - The protocol ID for key derivation
	 * @param keyID - The key ID for key derivation
	 * @param counterparty - The counterparty for key derivation (default: 'self')
	 * @param sighashType - Sighash type ('all', 'none', 'single')
	 * @param anyoneCanPay - Whether SIGHASH_ANYONECANPAY is set
	 * @returns Object with sign and estimateLength methods
	 */
	static unlockWithWallet(
		wallet: WalletInterface,
		protocolID: WalletProtocol,
		keyID: string,
		counterparty = 'self',
		sighashType: 'all' | 'none' | 'single' = 'all',
		anyoneCanPay = false,
	): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: (tx: Transaction, inputIndex: number) => Promise<number>
	} {
		const unlock = {
			sign: async (tx: Transaction, inputIndex: number) => {
				let signatureScope = TransactionSignature.SIGHASH_FORKID
				if (sighashType === 'all') {
					signatureScope |= TransactionSignature.SIGHASH_ALL
				}
				if (sighashType === 'none') {
					signatureScope |= TransactionSignature.SIGHASH_NONE
				}
				if (sighashType === 'single') {
					signatureScope |= TransactionSignature.SIGHASH_SINGLE
				}
				if (anyoneCanPay) {
					signatureScope |= TransactionSignature.SIGHASH_ANYONECANPAY
				}
				const input = tx.inputs[inputIndex]

				const otherInputs = tx.inputs.filter((_, index) => index !== inputIndex)

				const sourceTXID = input.sourceTXID
					? input.sourceTXID
					: input.sourceTransaction?.id('hex')
				if (!sourceTXID) {
					throw new Error(
						'The input sourceTXID or sourceTransaction is required for transaction signing.',
					)
				}
				const sourceSatoshis =
					input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis
				if (!sourceSatoshis) {
					throw new Error(
						'The sourceSatoshis or input sourceTransaction is required for transaction signing.',
					)
				}
				const lockingScript =
					input.sourceTransaction?.outputs[input.sourceOutputIndex]
						.lockingScript
				if (!lockingScript) {
					throw new Error(
						'The lockingScript or input sourceTransaction is required for transaction signing.',
					)
				}

				const preimage = TransactionSignature.format({
					sourceTXID,
					sourceOutputIndex: input.sourceOutputIndex,
					sourceSatoshis,
					transactionVersion: tx.version,
					otherInputs,
					outputs: tx.outputs,
					inputIndex,
					subscript: lockingScript,
					inputSequence:
						input.sequence === undefined ? 0xffffffff : input.sequence,
					lockTime: tx.lockTime,
					scope: signatureScope,
				})

				const sighash = Hash.sha256(Hash.sha256(preimage))

				// Pass the full BIP-143 preimage as `data` so the 1Sat permission
				// module can extract hashOutputs + outpoint and auto-grant against
				// the commitment captured at createAction time. `hashToDirectlySign`
				// remains the 32-byte input the wallet actually signs.
				const { signature } = await wallet.createSignature({
					protocolID,
					keyID,
					counterparty,
					data: Array.from(preimage),
					hashToDirectlySign: Array.from(sighash),
				})

				const { publicKey } = await wallet.getPublicKey({
					protocolID,
					keyID,
					counterparty,
					forSelf: true,
				})

				const sigWithHashtype = [...signature, signatureScope]

				return new Script()
					.writeBin(sigWithHashtype)
					.writeBin(Utils.toArray(publicKey, 'hex'))
					.writeBin(Array.from(preimage))
			},
			estimateLength: async (tx: Transaction, inputIndex: number) => {
				return (await unlock.sign(tx, inputIndex)).toBinary().length
			},
		}
		return unlock
	}
}
