import type { Utxo } from '@1sat/types'
import {
	LockingScript,
	Transaction,
	type TransactionInput,
	Utils,
} from '@bsv/sdk'

type UnlockingScriptTemplate = TransactionInput['unlockingScriptTemplate']

/**
 * Convert a UTXO into a TransactionInput with a synthetic source transaction.
 * The locking script is derived from the base64 script on the UTXO.
 */
export function inputFromUtxo(
	utxo: Utxo,
	unlockingScriptTemplate?: UnlockingScriptTemplate,
): TransactionInput {
	const rawScript = Uint8Array.from(Utils.toArray(utxo.script, 'base64'))
	const lockingScript = new LockingScript([], rawScript, undefined, false)
	const sourceTransaction = new Transaction(0, [], [], 0)
	const outputs = Array(utxo.vout + 1).fill(
		null,
	) as unknown as Transaction['outputs']
	outputs[utxo.vout] = { satoshis: utxo.satoshis, lockingScript }
	sourceTransaction.outputs = outputs

	return {
		sourceTransaction,
		sourceTXID: utxo.txid,
		sourceOutputIndex: utxo.vout,
		unlockingScriptTemplate,
		sequence: 0xffffffff,
	}
}

export function inputsFromUtxos(
	utxos: Utxo[],
	unlockingScriptTemplate?: UnlockingScriptTemplate,
): TransactionInput[] {
	return utxos.map((utxo) => inputFromUtxo(utxo, unlockingScriptTemplate))
}
