/**
 * MessageBox commands — pull paymail / P2P inbox into the wallet.
 *
 *   1sat messagebox sync [--url <host>] [--box <name>]
 */

import { syncMessages } from '@1sat/actions'
import type { GlobalFlags } from '../args.js'
import { extractFlag } from '../args.js'
import { loadContext } from '../context.js'
import { printCommandHelp } from '../help.js'
import { loadKey } from '../keys.js'
import { output } from '../output.js'

export async function handleMessageboxCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'sync':
			return messageboxSync(rest, opts)
		default:
			printCommandHelp('messagebox', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function messageboxSync(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const url = extractFlag(args, '--url')
	const box = extractFlag(args, '--box')

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await syncMessages.execute(ctx, {
			...(url ? { messageboxUrl: url } : {}),
			...(box ? { messageBox: box } : {}),
		})

		if (opts.json) {
			output(result, opts)
			return
		}

		console.log(`\nprocessed: ${result.processed}  failed: ${result.failed}\n`)
	} finally {
		await destroy()
	}
}
