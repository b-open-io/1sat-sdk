/**
 * MessageBox commands — pull the paymail / P2P inbox and the
 * `transaction-delivery` box (BRC-232 deliveries, 1Color tokens, BRC-169
 * handle payments) into the wallet.
 *
 *   1sat messagebox sync [--url <host>] [--box <name>] [--overlay <url>]
 */

import { syncMessages, syncTransactionInbox } from '@1sat/actions'
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
	const overlay = extractFlag(args, '--overlay')

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await syncMessages.execute(ctx, {
			...(url ? { messageboxUrl: url } : {}),
			...(box ? { messageBox: box } : {}),
		})
		// 1Color receipts need an overlay to submit to; without one they stay
		// in the box (overlay-required) and everything else is processed.
		const metanet = await syncTransactionInbox.execute(ctx, {
			...(url ? { messageboxUrl: url } : {}),
			...(overlay ? { overlay } : {}),
		})

		if (opts.json) {
			output({ ...result, metanet }, opts)
			return
		}

		console.log(`\nprocessed: ${result.processed}  failed: ${result.failed}`)
		console.log(
			`transaction-delivery: received ${metanet.received.length}  skipped ${metanet.skipped.length}${metanet.error ? `  error: ${metanet.error}` : ''}`,
		)
		for (const s of metanet.skipped) {
			console.log(`  skipped ${s.messageId}: ${s.reason}`)
		}
		console.log()
	} finally {
		await destroy()
	}
}
