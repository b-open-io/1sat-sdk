/**
 * MessageBox commands — pull paymail / P2P inbox and BRC-169 handle
 * payments (`metanet_inbox`) into the wallet.
 *
 *   1sat messagebox sync [--url <host>] [--box <name>]
 */

import { syncMessages, syncMetanetInbox } from '@1sat/actions'
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
		const metanet = await syncMetanetInbox.execute(ctx, {
			...(url ? { messageboxUrl: url } : {}),
		})

		if (opts.json) {
			output({ ...result, metanet }, opts)
			return
		}

		console.log(`\nprocessed: ${result.processed}  failed: ${result.failed}`)
		console.log(
			`metanet_inbox: received ${metanet.received.length}  skipped ${metanet.skipped.length}${metanet.error ? `  error: ${metanet.error}` : ''}`,
		)
		for (const s of metanet.skipped) {
			console.log(`  skipped ${s.messageId}: ${s.reason}`)
		}
		console.log()
	} finally {
		await destroy()
	}
}
