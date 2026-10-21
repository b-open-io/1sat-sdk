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
import { loadConfig } from '../config.js'
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
	const overlay = extractFlag(args, '--overlay') ?? loadConfig().colorOverlayUrl

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await syncMessages.execute(ctx, {
			...(url ? { messageboxUrl: url } : {}),
			...(box ? { messageBox: box } : {}),
		})
		// 1Color receipts are submitted to an overlay before they are
		// internalized; there is no default overlay.
		const delivery = overlay
			? await syncTransactionInbox.execute(ctx, {
					...(url ? { messageboxUrl: url } : {}),
					overlay,
				})
			: undefined

		if (opts.json) {
			output({ ...result, transactionDelivery: delivery ?? null }, opts)
			return
		}

		console.log(`\nprocessed: ${result.processed}  failed: ${result.failed}`)
		if (delivery) {
			console.log(
				`transaction-delivery: received ${delivery.received.length}  skipped ${delivery.skipped.length}${delivery.error ? `  error: ${delivery.error}` : ''}`,
			)
			for (const s of delivery.skipped) {
				console.log(`  skipped ${s.messageId}: ${s.reason}`)
			}
		} else {
			console.log(
				'transaction-delivery: not pulled (no overlay: pass --overlay <url> or run `1sat config set colorOverlayUrl <url>`)',
			)
		}
		console.log()
	} finally {
		await destroy()
	}
}
