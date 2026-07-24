/**
 * BSV21 commands (group was `tokens`) — balances, list, send, deploy, buy.
 */

import {
	buyBsv21,
	deployBsv21Auth,
	deployBsv21Mint,
	getBsv21Balances,
	getDisplayValue,
	listBsv21,
	mintBsv21,
	sendBsv21,
} from '@1sat/actions'
import type { Destination } from '@1sat/types'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey } from '../keys'
import { fatal, formatLabel, formatValue, output } from '../output'

export async function handleBsv21Command(
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
		case 'deploy-mint':
			return tokenDeployMint(rest, opts)
		case 'deploy-auth':
			return tokenDeployAuth(rest, opts)
		case 'mint':
			return tokenMint(rest, opts)
		case 'buy':
			return tokenBuy(rest, opts)
		default:
			printCommandHelp('bsv21', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

/** @deprecated Use handleBsv21Command */
export const handleTokensCommand = handleBsv21Command

async function tokenBalances(
	_args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const privateKey = await loadKey()
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

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const outputs = await listBsv21.execute(ctx, { limit: 10000 })

		const filtered = tokenId
			? outputs.filter((o) => {
					const idTag = o.tags?.find((t) => t.startsWith('bsv21:'))
					return idTag && idTag.slice(6) === tokenId
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
				o.tags?.find((t) => t.startsWith('bsv21:'))?.slice(6) ?? 'unknown'
			const amtTag = o.tags?.find((t) => t.startsWith('amt:'))?.slice(4) ?? '0'
			const symTag = getDisplayValue(o, 'sym', 'sym') ?? ''

			console.log(
				`  ${formatValue(o.outpoint)}  ${formatLabel(symTag || idTag.slice(0, 12))}  ${formatLabel('amt:')} ${formatValue(amtTag)}`,
			)
		}

		console.log(`\n  ${filtered.length} token UTXO(s) found.`)
	} finally {
		await destroy()
	}
}

/**
 * Build a {@link Destination} from CLI flags. Only the first set wins.
 * Returns undefined when no flags are set — actions interpret that as 'self'.
 */
function destinationFromFlags(opts: {
	to?: string
	counterparty?: string
	lockingScript?: string
}): Destination | undefined {
	if (opts.lockingScript) return { lockingScript: opts.lockingScript }
	if (opts.counterparty) return { counterparty: opts.counterparty }
	if (opts.to) return { address: opts.to }
	return undefined
}

async function tokenSend(args: string[], opts: GlobalFlags): Promise<void> {
	const tokenId = extractFlag(args, '--token-id')
	const to = extractFlag(args, '--to')
	const counterparty = extractFlag(args, '--counterparty')
	const lockingScript = extractFlag(args, '--locking-script')
	const amountStr = extractFlag(args, '--amount')

	if (!tokenId) fatal('Missing --token-id <id>')
	if (!amountStr) fatal('Missing --amount <number>')

	const destination = destinationFromFlags({ to, counterparty, lockingScript })
	if (!destination) {
		fatal(
			'Missing destination — provide one of: --to <address>, --counterparty <pubkey>, --locking-script <hex>',
		)
	}

	const amount = BigInt(amountStr)
	if (amount <= 0n) {
		fatal('--amount must be a positive number')
	}

	if (!opts.yes) {
		const dest = to ?? counterparty ?? lockingScript ?? ''
		const ok = await confirm({
			message: `Send ${amountStr} tokens (${tokenId.slice(0, 12)}...) to ${dest.slice(0, 32)}?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Token send cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await sendBsv21.execute(ctx, {
			tokenId,
			recipients: [
				{ amount: amountStr, destination: destination as Destination },
			],
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function tokenDeployMint(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const symbol = extractFlag(args, '--symbol')
	const amountStr = extractFlag(args, '--amount')
	const decimalsStr = extractFlag(args, '--decimals')
	const icon = extractFlag(args, '--icon')
	const to = extractFlag(args, '--to')
	const counterparty = extractFlag(args, '--counterparty')
	const lockingScript = extractFlag(args, '--locking-script')

	if (!symbol) fatal('Missing --symbol <ticker>')
	if (!amountStr) fatal('Missing --amount <total-supply>')

	const amount = BigInt(amountStr)
	if (amount <= 0n) fatal('--amount must be a positive number')

	const decimals = decimalsStr ? Number.parseInt(decimalsStr, 10) : 0
	if (Number.isNaN(decimals) || decimals < 0 || decimals > 18) {
		fatal('--decimals must be an integer between 0 and 18')
	}

	if (!opts.yes) {
		const ok = await confirm({
			message: `Deploy ${symbol} with fixed supply ${amountStr} (decimals=${decimals})?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Deploy cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await deployBsv21Mint.execute(ctx, {
			symbol,
			amount: amountStr,
			decimals,
			icon,
			destination: destinationFromFlags({ to, counterparty, lockingScript }),
		})

		if (result.error) {
			fatal(result.error)
		}

		output(
			opts.json ? result : { txid: result.txid, tokenId: result.tokenId },
			opts,
		)
	} finally {
		await destroy()
	}
}

async function tokenDeployAuth(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const symbol = extractFlag(args, '--symbol')
	const decimalsStr = extractFlag(args, '--decimals')
	const icon = extractFlag(args, '--icon')
	const to = extractFlag(args, '--to')
	const counterparty = extractFlag(args, '--counterparty')
	const lockingScript = extractFlag(args, '--locking-script')

	if (!symbol) fatal('Missing --symbol <ticker>')

	const decimals = decimalsStr ? Number.parseInt(decimalsStr, 10) : 0
	if (Number.isNaN(decimals) || decimals < 0 || decimals > 18) {
		fatal('--decimals must be an integer between 0 and 18')
	}

	if (!opts.yes) {
		const ok = await confirm({
			message: `Deploy ${symbol} as a mintable token (decimals=${decimals})?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Deploy cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await deployBsv21Auth.execute(ctx, {
			symbol,
			decimals,
			icon,
			destination: destinationFromFlags({ to, counterparty, lockingScript }),
		})

		if (result.error) {
			fatal(result.error)
		}

		output(
			opts.json
				? result
				: {
						txid: result.txid,
						tokenId: result.tokenId,
						authOutpoint: result.authOutpoint,
					},
			opts,
		)
	} finally {
		await destroy()
	}
}

async function tokenMint(args: string[], opts: GlobalFlags): Promise<void> {
	const tokenId = extractFlag(args, '--token-id')
	const amountStr = extractFlag(args, '--amount')

	const mintTo = extractFlag(args, '--to')
	const mintCounterparty = extractFlag(args, '--counterparty')
	const mintLockingScript = extractFlag(args, '--locking-script')

	const authTo = extractFlag(args, '--auth-to')
	const authCounterparty = extractFlag(args, '--auth-counterparty')
	const authLockingScript = extractFlag(args, '--auth-locking-script')

	const endMinting = args.includes('--end-minting')

	if (!tokenId) fatal('Missing --token-id <id>')

	const mintDestination = destinationFromFlags({
		to: mintTo,
		counterparty: mintCounterparty,
		lockingScript: mintLockingScript,
	})
	const authDestination = destinationFromFlags({
		to: authTo,
		counterparty: authCounterparty,
		lockingScript: authLockingScript,
	})

	// At least one operation
	if (!amountStr && !authDestination && !endMinting) {
		fatal(
			'Provide either --amount (and optional mint destination) or auth destination, or --end-minting to burn authority',
		)
	}

	const mint = amountStr
		? {
				amount: amountStr,
				// Default mint destination to self when only amount is provided
				destination: mintDestination ?? ({} as Destination),
			}
		: undefined
	// Default auth destination to self when not ending minting. Symmetric
	// with the mint default above. The action treats omitted `auth` as
	// "burn authority" and requires `endMinting: true` for that, so leave
	// auth undefined only when the user explicitly opted into ending.
	const auth = endMinting
		? authDestination
			? { destination: authDestination }
			: undefined
		: { destination: authDestination ?? ({} as Destination) }

	if (!opts.yes) {
		const summary: string[] = []
		if (mint) summary.push(`mint ${amountStr}`)
		if (auth) summary.push('re-issue auth')
		if (!auth && endMinting) summary.push('END MINTING (burn auth)')
		const ok = await confirm({
			message: `${summary.join(' + ')} for token ${tokenId.slice(0, 12)}...?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Mint cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await mintBsv21.execute(ctx, {
			tokenId,
			mint,
			auth,
			endMinting: endMinting || undefined,
		})

		if (result.error) {
			fatal(result.error)
		}

		output(
			opts.json
				? result
				: { txid: result.txid, authOutpoint: result.authOutpoint },
			opts,
		)
	} finally {
		await destroy()
	}
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

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await buyBsv21.execute(ctx, {
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
