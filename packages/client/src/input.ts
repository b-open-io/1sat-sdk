/**
 * UTXO to TransactionInput conversion utilities
 */

import type { Utxo } from '@1sat/types'
import {
	type Transaction,
	type TransactionInput,
	type UnlockingScript,
	Utils,
	fromUtxo,
} from '@bsv/sdk'

const { toHex, toArray } = Utils

/** Standard P2PKH unlocking script size in bytes */
const P2PKH_UNLOCK_SIZE = 107

/**
 * Unlocking script template interface
 */
export interface UnlockTemplate {
	sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
	estimateLength: (tx: Transaction, inputIndex: number) => Promise<number>
}

/**
 * Convert a UTXO with base64-encoded script to a TransactionInput
 *
 * @param utxo - UTXO with base64-encoded script
 * @param unlockTemplate - Optional unlocking script template. When omitted,
 *   creates an input for external signing (signInputs: false mode)
 * @returns TransactionInput ready to add to a transaction
 */
export function inputFromUtxo(
	utxo: Utxo,
	unlockTemplate?: UnlockTemplate,
): TransactionInput {
	// Convert script from base64 to hex for fromUtxo
	const scriptBytes = toArray(utxo.script, 'base64')
	const utxoHex = {
		...utxo,
		script: toHex(scriptBytes),
	}

	if (unlockTemplate) {
		return fromUtxo(utxoHex, unlockTemplate)
	}

	// For signInputs: false mode - create input that supports fee estimation
	// but must be signed externally (e.g., by wallet)
	return fromUtxo(utxoHex, {
		estimateLength: async () => P2PKH_UNLOCK_SIZE,
		sign: async () => {
			throw new Error(
				'Cannot sign input: transaction was built with signInputs: false. ' +
					'This input must be signed externally (e.g., by a wallet).',
			)
		},
	})
}

/**
 * Convert multiple UTXOs to TransactionInputs
 *
 * @param utxos - Array of UTXOs with base64-encoded scripts
 * @param unlockTemplate - Optional unlocking script template
 * @returns Array of TransactionInputs
 */
export function inputsFromUtxos(
	utxos: Utxo[],
	unlockTemplate?: UnlockTemplate,
): TransactionInput[] {
	return utxos.map((utxo) => inputFromUtxo(utxo, unlockTemplate))
}
