import { ORD_LOCK_PREFIX, ORD_LOCK_SUFFIX } from '@1sat/types'
import {
	BigNumber,
	Hash,
	type LockingScript,
	OP,
	P2PKH,
	type PrivateKey,
	Script,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletInterface,
	type WalletProtocol,
} from '@bsv/sdk'

/**
 * OrdLock PREFIX as number array - sCrypt contract prefix shared with Lock template
 */
export const ORDLOCK_PREFIX = Utils.toArray(ORD_LOCK_PREFIX, 'hex')

/**
 * OrdLock SUFFIX as number array - contract validation script
 */
export const ORDLOCK_SUFFIX = Utils.toArray(ORD_LOCK_SUFFIX, 'hex')

/**
 * OrdLock decoded data structure
 */
export interface OrdLockData {
	/** Seller's address (base58check encoded) */
	seller: string
	/** Listing price in satoshis */
	price: bigint
	/** Raw payout output data */
	payout: number[]
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
 * OrdLock - Ordinal Lock template for marketplace listings
 *
 * OrdLock enables trustless ordinal/NFT sales by locking an output with a
 * contract that can only be unlocked by providing payment to a specified address.
 *
 * @example
 * ```typescript
 * // Decode an OrdLock from a script
 * const ordlock = OrdLock.decode(script);
 * if (ordlock) {
 *   console.log(`Seller: ${ordlock.seller}`);
 *   console.log(`Price: ${ordlock.price} satoshis`);
 * }
 * ```
 */
export default class OrdLock {
	/**
	 * Decodes an OrdLock from a script
	 *
	 * @param script - The script to decode
	 * @param mainnet - Whether to use mainnet address prefix (default: true)
	 * @returns Decoded OrdLock data or null if not found/invalid
	 */
	static decode(script: Script, mainnet = true): OrdLockData | null {
		try {
			const scriptBinary = script.toBinary()

			// Find PREFIX
			const prefixIndex = indexOf(scriptBinary, ORDLOCK_PREFIX)
			if (prefixIndex === -1) return null

			// Find SUFFIX after PREFIX
			const suffixIndex = indexOf(
				scriptBinary,
				ORDLOCK_SUFFIX,
				prefixIndex + ORDLOCK_PREFIX.length,
			)
			if (suffixIndex === -1) return null

			// Extract data between PREFIX and SUFFIX
			const dataBytes = scriptBinary.slice(
				prefixIndex + ORDLOCK_PREFIX.length,
				suffixIndex,
			)
			if (dataBytes.length === 0) return null

			// Parse the data as script chunks
			const dataScript = Script.fromBinary(dataBytes)
			const chunks = dataScript.chunks

			if (chunks.length < 2) return null

			// Chunk 0: seller PKHash (20 bytes)
			const sellerChunk = chunks[0]
			if (sellerChunk?.data == null || sellerChunk.data.length !== 20)
				return null

			// Chunk 1: payout TransactionOutput (satoshis + locking script)
			const payoutChunk = chunks[1]
			if (payoutChunk?.data == null || payoutChunk.data.length < 9) return null

			const payoutData = payoutChunk.data

			// Parse TransactionOutput: 8-byte LE satoshis + varint script length + script
			// Read 8-byte little-endian satoshis
			let price = BigInt(0)
			for (let i = 0; i < 8; i++) {
				price |= BigInt(payoutData[i]) << BigInt(i * 8)
			}

			// Convert PKHash to address
			const addressPrefix = mainnet ? [0x00] : [0x6f]
			const seller = Utils.toBase58Check(sellerChunk.data, addressPrefix)

			return {
				seller,
				price,
				payout: Array.from(payoutData),
			}
		} catch {
			return null
		}
	}

	/**
	 * Checks if a script contains an OrdLock pattern
	 *
	 * @param script - The script to check
	 * @returns true if the script contains OrdLock pattern
	 */
	static isOrdLock(script: Script): boolean {
		const scriptBinary = script.toBinary()
		const prefixIndex = indexOf(scriptBinary, ORDLOCK_PREFIX)
		if (prefixIndex === -1) return false
		const suffixIndex = indexOf(
			scriptBinary,
			ORDLOCK_SUFFIX,
			prefixIndex + ORDLOCK_PREFIX.length,
		)
		return suffixIndex !== -1
	}

	/**
	 * Checks if an unlocking script indicates a purchase (vs cancellation)
	 *
	 * @param unlockingScript - The unlocking script to check
	 * @returns true if the unlock represents a purchase
	 */
	static isPurchase(unlockingScript: Script): boolean {
		const scriptBinary = unlockingScript.toBinary()
		return indexOf(scriptBinary, ORDLOCK_SUFFIX) !== -1
	}

	/**
	 * Creates an OrdLock locking script for listing an ordinal
	 *
	 * @param cancelAddress - Address that can cancel the listing
	 * @param payAddress - Address that receives payment on purchase
	 * @param price - Listing price in satoshis
	 * @returns The OrdLock locking script
	 */
	static lock(
		cancelAddress: string,
		payAddress: string,
		price: number,
	): Script {
		const cancelPkh = Utils.fromBase58Check(cancelAddress).data as number[]
		const payPkh = Utils.fromBase58Check(payAddress).data as number[]

		return new Script()
			.writeScript(Script.fromBinary(ORDLOCK_PREFIX))
			.writeBin(cancelPkh)
			.writeBin(OrdLock.buildOutput(price, new P2PKH().lock(payPkh).toBinary()))
			.writeScript(Script.fromBinary(ORDLOCK_SUFFIX))
	}

	/**
	 * Builds a serialized transaction output (satoshis + script)
	 *
	 * @param satoshis - Output value
	 * @param script - Locking script as binary
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
	 * Creates an unlocking script for cancelling a listing
	 *
	 * @param privateKey - Private key for the cancel address
	 * @param signOutputs - Signature scope for outputs
	 * @param anyoneCanPay - Whether to use ANYONECANPAY
	 * @param sourceSatoshis - Input satoshis (optional if sourceTransaction provided)
	 * @param lockingScript - Input locking script (optional if sourceTransaction provided)
	 * @returns Unlock template with sign and estimateLength methods
	 */
	static cancelListing(
		privateKey: PrivateKey,
		signOutputs: 'all' | 'none' | 'single' = 'all',
		anyoneCanPay = false,
		sourceSatoshis?: number,
		lockingScript?: Script,
	): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		const p2pkh = new P2PKH().unlock(
			privateKey,
			signOutputs,
			anyoneCanPay,
			sourceSatoshis,
			lockingScript,
		)
		return {
			sign: async (tx: Transaction, inputIndex: number) => {
				return (await p2pkh.sign(tx, inputIndex)).writeOpCode(OP.OP_1)
			},
			estimateLength: async () => {
				return 107
			},
		}
	}

	/**
	 * Creates an unlocking script for cancelling a listing using a BRC-100 wallet.
	 *
	 * Uses wallet.createSignature and wallet.getPublicKey instead of a raw PrivateKey,
	 * enabling key derivation via protocolID/keyID.
	 *
	 * @param wallet - A BRC-100 WalletInterface
	 * @param protocolID - The protocol ID for key derivation
	 * @param keyID - The key ID for key derivation
	 * @param counterparty - The counterparty for key derivation (default: 'self')
	 * @returns Unlock template with sign and estimateLength methods
	 */
	static cancelWithWallet(
		wallet: WalletInterface,
		protocolID: WalletProtocol,
		keyID: string,
		counterparty = 'self',
	): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		return {
			sign: async (tx: Transaction, inputIndex: number) => {
				const signatureScope =
					TransactionSignature.SIGHASH_ALL |
					TransactionSignature.SIGHASH_ANYONECANPAY |
					TransactionSignature.SIGHASH_FORKID

				const input = tx.inputs[inputIndex]

				const sourceTXID =
					input.sourceTXID ?? input.sourceTransaction?.id('hex')
				if (!sourceTXID) {
					throw new Error(
						'The input sourceTXID or sourceTransaction is required for signing.',
					)
				}
				const sourceSatoshis =
					input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis
				if (!sourceSatoshis) {
					throw new Error(
						'The sourceSatoshis or input sourceTransaction is required for signing.',
					)
				}
				const lockingScript =
					input.sourceTransaction?.outputs[input.sourceOutputIndex]
						.lockingScript
				if (!lockingScript) {
					throw new Error(
						'The lockingScript or input sourceTransaction is required for signing.',
					)
				}

				const preimage = TransactionSignature.format({
					sourceTXID,
					sourceOutputIndex: input.sourceOutputIndex,
					sourceSatoshis,
					transactionVersion: tx.version,
					otherInputs: [],
					inputIndex,
					outputs: tx.outputs,
					inputSequence: input.sequence ?? 0xffffffff,
					subscript: lockingScript,
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

				return new UnlockingScript()
					.writeBin(sigWithHashtype)
					.writeBin(Utils.toArray(publicKey, 'hex'))
					.writeOpCode(OP.OP_1)
			},
			estimateLength: async () => {
				return 108
			},
		}
	}

	/**
	 * Creates an unlocking script for purchasing a listing
	 *
	 * The purchase path requires:
	 * - Output 0: The ordinal going to buyer
	 * - Output 1: Payment to seller (must match payout in OrdLock)
	 * - Output 2+: Additional outputs (marketplace fees, etc.)
	 *
	 * No signature is required - the contract validates the outputs match.
	 *
	 * @param sourceSatoshis - Input satoshis (optional if sourceTransaction provided)
	 * @param lockingScript - Input locking script (optional if sourceTransaction provided)
	 * @returns Unlock template with sign and estimateLength methods
	 */
	static purchaseListing(
		sourceSatoshis?: number,
		lockingScript?: Script,
	): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: (tx: Transaction, inputIndex: number) => Promise<number>
	} {
		const purchase = {
			sign: async (tx: Transaction, inputIndex: number) => {
				if (tx.outputs.length < 2) {
					throw new Error('Malformed transaction: requires at least 2 outputs')
				}
				const script = new UnlockingScript().writeBin(
					OrdLock.buildOutput(
						tx.outputs[0].satoshis ?? 0,
						tx.outputs[0].lockingScript.toBinary(),
					),
				)
				if (tx.outputs.length > 2) {
					const writer = new Utils.Writer()
					for (const output of tx.outputs.slice(2)) {
						writer.write(
							OrdLock.buildOutput(
								output.satoshis ?? 0,
								output.lockingScript.toBinary(),
							),
						)
					}
					script.writeBin(writer.toArray())
				} else {
					script.writeOpCode(OP.OP_0)
				}

				const input = tx.inputs[inputIndex]
				let sourceSats = sourceSatoshis as number
				if (!sourceSats && input.sourceTransaction != null) {
					sourceSats = input.sourceTransaction.outputs[input.sourceOutputIndex]
						.satoshis as number
				} else if (!sourceSatoshis) {
					throw new Error('sourceTransaction or sourceSatoshis is required')
				}

				const sourceTXID = (input.sourceTXID ??
					input.sourceTransaction?.id('hex')) as string
				let subscript = lockingScript as LockingScript
				if (!subscript) {
					subscript = input.sourceTransaction?.outputs[input.sourceOutputIndex]
						.lockingScript as LockingScript
				}
				const preimage = TransactionSignature.format({
					sourceTXID,
					sourceOutputIndex: input.sourceOutputIndex,
					sourceSatoshis: sourceSats,
					transactionVersion: tx.version,
					otherInputs: [],
					inputIndex,
					outputs: tx.outputs,
					inputSequence: input.sequence ?? 0xffffffff,
					subscript,
					lockTime: tx.lockTime,
					scope:
						TransactionSignature.SIGHASH_ALL |
						TransactionSignature.SIGHASH_ANYONECANPAY |
						TransactionSignature.SIGHASH_FORKID,
				})

				return script.writeBin(preimage).writeOpCode(OP.OP_0)
			},
			estimateLength: async (tx: Transaction, inputIndex: number) => {
				return (await purchase.sign(tx, inputIndex)).toBinary().length
			},
		}
		return purchase
	}
}
