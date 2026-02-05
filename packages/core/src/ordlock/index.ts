/**
 * OrdLock (Ordinal Lock) contract for 1Sat Ordinals marketplace
 *
 * Implements the OrdLock script template for creating, canceling, and purchasing listings
 */

import { ORD_LOCK_PREFIX, ORD_LOCK_SUFFIX } from '@1sat/types'
import type { Inscription } from '@1sat/types'
import {
	BigNumber,
	type LockingScript,
	OP,
	P2PKH,
	type PrivateKey,
	Script,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
} from '@bsv/sdk'

const { toArray, toHex } = Utils

/** Convert UTF-8 string to hex */
const utf8ToHex = (str: string): string => toHex(toArray(str, 'utf8'))

/**
 * Build a serialized output for OrdLock contract
 * @param satoshis - Amount in satoshis
 * @param script - Locking script as byte array
 * @returns Serialized output as byte array
 */
export function buildOutput(satoshis: number, script: number[]): number[] {
	const writer = new Utils.Writer()
	writer.writeUInt64LEBn(new BigNumber(satoshis))
	writer.writeVarIntNum(script.length)
	writer.write(script)
	return writer.toArray()
}

/**
 * OrdLock class implementing ScriptTemplate for marketplace listings
 *
 * Provides methods for creating, canceling, and purchasing ordinal listings
 */
export class OrdLock {
	/**
	 * Creates a 1Sat Ordinal Lock script for marketplace listing
	 *
	 * @param ordAddress - Address that can cancel the listing (seller's address)
	 * @param payAddress - Address to receive payment on purchase
	 * @param price - Listing price in satoshis
	 * @param inscription - Optional inscription to include in the listing
	 * @returns Locking script for the ordinal lock
	 */
	lock(
		ordAddress: string,
		payAddress: string,
		price: number,
		inscription?: Inscription,
	): Script {
		const cancelPkh = Utils.fromBase58Check(ordAddress).data as number[]
		const payPkh = Utils.fromBase58Check(payAddress).data as number[]

		let script = new Script()

		// Add inscription envelope if provided
		if (
			inscription?.dataB64 !== undefined &&
			inscription?.contentType !== undefined
		) {
			const ordHex = utf8ToHex('ord')
			const fileBytes = toArray(inscription.dataB64, 'base64')
			const fileHex = toHex(fileBytes).trim()

			if (!fileHex) {
				throw new Error('Invalid file data')
			}

			const contentTypeHex = utf8ToHex(inscription.contentType)
			if (!contentTypeHex) {
				throw new Error('Invalid content type')
			}

			script = Script.fromASM(
				`OP_0 OP_IF ${ordHex} OP_1 ${contentTypeHex} OP_0 ${fileHex} OP_ENDIF`,
			)
		}

		// Build the OrdLock script
		return script
			.writeScript(Script.fromHex(ORD_LOCK_PREFIX))
			.writeBin(cancelPkh)
			.writeBin(buildOutput(price, new P2PKH().lock(payPkh).toBinary()))
			.writeScript(Script.fromHex(ORD_LOCK_SUFFIX))
	}

	/**
	 * Create an unlocking script template for canceling a listing
	 *
	 * @param privateKey - Private key for the cancel address
	 * @param signOutputs - Which outputs to sign ('all', 'none', 'single')
	 * @param anyoneCanPay - Whether to use ANYONECANPAY sighash flag
	 * @param sourceSatoshis - Source output satoshis (optional if sourceTransaction available)
	 * @param lockingScript - Source locking script (optional if sourceTransaction available)
	 * @returns Unlock template with sign and estimateLength methods
	 */
	cancelListing(
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
	 * Create an unlocking script template for purchasing a listing
	 *
	 * @param sourceSatoshis - Source output satoshis (optional if sourceTransaction available)
	 * @param lockingScript - Source locking script (optional if sourceTransaction available)
	 * @returns Unlock template with sign and estimateLength methods
	 */
	purchaseListing(
		sourceSatoshis?: number,
		lockingScript?: Script,
	): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: (tx: Transaction, inputIndex: number) => Promise<number>
	} {
		const purchase = {
			sign: async (tx: Transaction, inputIndex: number) => {
				if (tx.outputs.length < 2) {
					throw new Error('Malformed transaction - requires at least 2 outputs')
				}

				// Build unlocking script with output data
				const script = new UnlockingScript().writeBin(
					buildOutput(
						tx.outputs[0].satoshis || 0,
						tx.outputs[0].lockingScript.toBinary(),
					),
				)

				// Add additional outputs (royalties, etc.) or OP_0 if none
				if (tx.outputs.length > 2) {
					const writer = new Utils.Writer()
					for (const output of tx.outputs.slice(2)) {
						writer.write(
							buildOutput(
								output.satoshis || 0,
								output.lockingScript.toBinary(),
							),
						)
					}
					script.writeBin(writer.toArray())
				} else {
					script.writeOpCode(OP.OP_0)
				}

				// Get source satoshis
				const input = tx.inputs[inputIndex]
				let sourceSats = sourceSatoshis as number
				if (!sourceSats && input.sourceTransaction) {
					sourceSats = input.sourceTransaction.outputs[input.sourceOutputIndex]
						.satoshis as number
				} else if (!sourceSatoshis) {
					throw new Error('sourceTransaction or sourceSatoshis is required')
				}

				// Get source TXID and subscript
				const sourceTXID = (input.sourceTXID ||
					input.sourceTransaction?.id('hex')) as string
				let subscript = lockingScript as LockingScript
				if (!subscript) {
					subscript = input.sourceTransaction?.outputs[input.sourceOutputIndex]
						.lockingScript as LockingScript
				}

				// Build preimage for signature verification
				const preimage = TransactionSignature.format({
					sourceTXID,
					sourceOutputIndex: input.sourceOutputIndex,
					sourceSatoshis: sourceSats,
					transactionVersion: tx.version,
					otherInputs: [],
					inputIndex,
					outputs: tx.outputs,
					inputSequence: input.sequence || 0xffffffff,
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

/**
 * Create an OrdLock locking script directly
 * Convenience function that doesn't require instantiating OrdLock
 */
export function createOrdLockScript(
	ordAddress: string,
	payAddress: string,
	price: number,
	inscription?: Inscription,
): Script {
	return new OrdLock().lock(ordAddress, payAddress, price, inscription)
}

/**
 * Check if a script is an OrdLock script
 * @param script - Script to check
 * @returns True if the script is an OrdLock script
 */
export function isOrdLockScript(script: Script): boolean {
	const hex = script.toHex()
	return hex.includes(ORD_LOCK_PREFIX) && hex.includes(ORD_LOCK_SUFFIX)
}
