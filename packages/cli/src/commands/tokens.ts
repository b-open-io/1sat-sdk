/**
 * Token commands - balances, list, send, deploy, buy.
 */

import {
	getBsv21Balances,
	listTokens,
	purchaseBsv21,
	sendBsv21,
} from '@1sat/actions'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey, resolvePassword } from '../keys'
import { fatal, formatLabel, formatValue, output } from '../output'

export async function handleTokensCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'balances':
			return tokenBalances(rest, opts)
		case 'list':
			return tokenList(rest, opts)
		case 'send':
			return tokenSend(rest, opts)
		case 'deploy':
			return tokenDeploy(rest, opts)
		case 'buy':
			return tokenBuy(rest, opts)
		default:
			printCommandHelp('tokens', {
				balances: 'Show token balances by token ID',
				list: 'List owned token UTXOs (--token-id <id>)',
				send: 'Transfer tokens (--token-id <id> --to <addr> --amount <n>)',
				deploy: 'Deploy a new BSV21 token (not yet available)',
				buy: 'Purchase listed tokens (--outpoint <op> --token-id <id> --amount <n>)',
			})
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function tokenBalances(
	_args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const balances = await getBsv21Balances.execute(ctx, {})

		if (opts.json) {
			output(balances, opts)
			return
		}

		if (balances.length === 0) {
			output('No token balances found.', opts)
			return
		}

		for (const b of balances) {
			const symbol = b.sym ?? b.id.slice(0, 12)
			console.log(
				`  ${formatValue(symbol)}  ${formatLabel('amount:')} ${formatValue(b.amt)}  ${formatLabel('id:')} ${b.id}  ${formatLabel('dec:')} ${b.dec}`,
			)
		}
	} finally {
		await destroy()
	}
}

async function tokenList(args: string[], opts: GlobalFlags): Promise<void> {
	const tokenId = extractFlag(args, '--token-id')

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const outputs = await listTokens.execute(ctx, { limit: 10000 })

		const filtered = tokenId
			? outputs.filter((o) => {
					const idTag = o.tags?.find((t) => t.startsWith('id:'))
					return idTag && idTag.slice(3) === tokenId
				})
			: outputs

		if (opts.json) {
			output(filtered, opts)
			return
		}

		if (filtered.length === 0) {
			output(
				tokenId
					? `No token UTXOs found for token ${tokenId}.`
					: 'No token UTXOs found.',
				opts,
			)
			return
		}

		for (const o of filtered) {
			const idTag =
				o.tags?.find((t) => t.startsWith('id:'))?.slice(3) ?? 'unknown'
			const amtTag = o.tags?.find((t) => t.startsWith('amt:'))?.slice(4) ?? '0'
			const symTag = o.tags?.find((t) => t.startsWith('sym:'))?.slice(4) ?? ''

			console.log(
				`  ${formatValue(o.outpoint)}  ${formatLabel(symTag || idTag.slice(0, 12))}  ${formatLabel('amt:')} ${formatValue(amtTag)}`,
			)
		}

		console.log(`\n  ${filtered.length} token UTXO(s) found.`)
	} finally {
		await destroy()
	}
}

async function tokenSend(args: string[], opts: GlobalFlags): Promise<void> {
	const tokenId = extractFlag(args, '--token-id')
	const to = extractFlag(args, '--to')
	const amountStr = extractFlag(args, '--amount')

	if (!tokenId) fatal('Missing --token-id <id>')
	if (!to) fatal('Missing --to <address>')
	if (!amountStr) fatal('Missing --amount <number>')

	const amount = BigInt(amountStr)
	if (amount <= 0n) {
		fatal('--amount must be a positive number')
	}

	if (!opts.yes) {
		const ok = await confirm({
			message: `Send ${amountStr} tokens (${tokenId.slice(0, 12)}...) to ${to}?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Token send cancelled.')
		}
	}

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await sendBsv21.execute(ctx, {
			tokenId,
			amount: amountStr,
			address: to,
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function tokenDeploy(_args: string[], _opts: GlobalFlags): Promise<void> {
	fatal(
		'tokens deploy is not yet available. No deploy action exists in the actions package.',
	)
}

async function tokenBuy(args: string[], opts: GlobalFlags): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')
	const tokenId = extractFlag(args, '--token-id')
	const amountStr = extractFlag(args, '--amount')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')
	if (!tokenId) fatal('Missing --token-id <id>')
	if (!amountStr) fatal('Missing --amount <token-amount>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Purchase ${amountStr} tokens (${tokenId.slice(0, 12)}...) from listing ${outpoint}?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Purchase cancelled.')
		}
	}

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await purchaseBsv21.execute(ctx, {
			tokenId,
			outpoint,
			amount: amountStr,
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}
