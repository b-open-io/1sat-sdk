import { Script, Spend, type Transaction } from '@bsv/sdk'

/** Apply and locally verify one unlocking script against its source output. */
export function assertValidInputUnlock(
	tx: Transaction,
	inputIndex: number,
	unlockingScriptHex: string,
): void {
	const input = tx.inputs[inputIndex]
	if (!input) throw new Error(`missing-input-${inputIndex}`)
	const sourceOutput = input.sourceTransaction?.outputs[input.sourceOutputIndex]
	if (!sourceOutput) {
		throw new Error(`missing-source-transaction-for-input-${inputIndex}`)
	}

	const unlockingScript = Script.fromHex(unlockingScriptHex)
	input.unlockingScript = unlockingScript
	const spend = new Spend({
		sourceTXID: input.sourceTXID ?? input.sourceTransaction?.id('hex') ?? '',
		sourceOutputIndex: input.sourceOutputIndex,
		lockingScript: sourceOutput.lockingScript,
		sourceSatoshis: sourceOutput.satoshis ?? 0,
		transactionVersion: tx.version,
		otherInputs: tx.inputs.filter((_, index) => index !== inputIndex),
		unlockingScript,
		inputSequence: input.sequence ?? 0xffffffff,
		inputIndex,
		outputs: tx.outputs,
		lockTime: tx.lockTime,
	})
	if (!spend.validate()) {
		throw new Error(`script-verification-failed-for-input-${inputIndex}`)
	}
}
