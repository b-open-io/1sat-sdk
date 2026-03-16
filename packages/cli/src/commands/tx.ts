/**
 * Transaction utility commands - decode.
 */

import { Transaction } from '@bsv/sdk'
import type { GlobalFlags } from '../args'
import { printCommandHelp } from '../help'
import { fatal, output } from '../output'

export async function handleTxCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'decode':
			return txDecode(rest, opts)
		default:
			printCommandHelp('tx', {
				decode: 'Decode a raw transaction hex',
			})
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function txDecode(args: string[], opts: GlobalFlags): Promise<void> {
	const hex = args[0]

	if (!hex) fatal('Missing transaction hex. Usage: 1sat tx decode <hex>')

	let tx: Transaction
	try {
		tx = Transaction.fromHex(hex)
	} catch (e) {
		fatal(
			`Failed to decode transaction: ${e instanceof Error ? e.message : String(e)}`,
		)
	}

	const decoded = {
		txid: tx.id('hex'),
		version: tx.version,
		lockTime: tx.lockTime,
		inputs: tx.inputs.map((input, i) => ({
			index: i,
			sourceTXID: input.sourceTXID,
			sourceOutputIndex: input.sourceOutputIndex,
			sequence: input.sequence,
			scriptLength: input.unlockingScript?.toBinary().length ?? 0,
		})),
		outputs: tx.outputs.map((out, i) => ({
			index: i,
			satoshis: out.satoshis,
			scriptLength: out.lockingScript.toBinary().length,
			scriptHex:
				out.lockingScript.toHex().slice(0, 80) +
				(out.lockingScript.toHex().length > 80 ? '...' : ''),
		})),
	}

	output(decoded, opts)
}
