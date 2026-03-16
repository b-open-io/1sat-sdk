/**
 * Wallet commands - balance, address, send, send-all, info.
 */

import { deriveDepositAddresses, sendAllBsv, sendBsv } from '@1sat/actions'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey, resolvePassword } from '../keys'
import { fatal, formatValue, output, printKeyValue } from '../output'

export async function handleWalletCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'balance':
			return walletBalance(rest, opts)
		case 'address':
			return walletAddress(rest, opts)
		case 'send':
			return walletSend(rest, opts)
		case 'send-all':
			return walletSendAll(rest, opts)
		case 'info':
			return walletInfo(rest, opts)
		default:
			printCommandHelp('wallet', {
				balance: 'Show wallet balance in satoshis',
				address: 'Show deposit address',
				send: 'Send BSV to an address (--to <addr> --sats <amount>)',
				'send-all': 'Send all BSV to an address (--to <addr>)',
				info: 'Show wallet info (address, balance, network)',
			})
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function walletBalance(
	_args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await ctx.wallet.listOutputs({
			basket: 'default',
			include: 'locking scripts',
			limit: 10000,
		})

		const totalSatoshis = result.outputs.reduce((sum, o) => sum + o.satoshis, 0)

		output(
			opts.json
				? { satoshis: totalSatoshis, utxos: result.outputs.length }
				: `${formatValue(totalSatoshis)} satoshis (${result.outputs.length} UTXOs)`,
			opts,
		)
	} finally {
		await destroy()
	}
}

async function walletAddress(
	_args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await deriveDepositAddresses.execute(ctx, {
			prefix: '1sat',
			count: 1,
		})

		const primary = result.derivations[0]
		if (!primary) {
			fatal('Failed to derive deposit address')
		}

		output(opts.json ? primary : primary.address, opts)
	} finally {
		await destroy()
	}
}

async function walletSend(args: string[], opts: GlobalFlags): Promise<void> {
	const to = extractFlag(args, '--to')
	const satsStr = extractFlag(args, '--sats')

	if (!to) fatal('Missing --to <address>')
	if (!satsStr) fatal('Missing --sats <amount>')

	const satoshis = Number(satsStr)
	if (!Number.isFinite(satoshis) || satoshis <= 0) {
		fatal('--sats must be a positive number')
	}

	if (!opts.yes) {
		const ok = await confirm({
			message: `Send ${satoshis} satoshis to ${to}?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Send cancelled.')
		}
	}

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await sendBsv.execute(ctx, {
			requests: [{ address: to, satoshis }],
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function walletSendAll(args: string[], opts: GlobalFlags): Promise<void> {
	const to = extractFlag(args, '--to')

	if (!to) fatal('Missing --to <address>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Send ALL BSV to ${to}? This will empty your wallet.`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Send cancelled.')
		}
	}

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await sendAllBsv.execute(ctx, { destination: to })

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function walletInfo(_args: string[], opts: GlobalFlags): Promise<void> {
	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const [addressResult, balanceResult, identityResult] = await Promise.all([
			deriveDepositAddresses.execute(ctx, { prefix: '1sat', count: 1 }),
			ctx.wallet.listOutputs({
				basket: 'default',
				include: 'locking scripts',
				limit: 10000,
			}),
			ctx.wallet.getPublicKey({ identityKey: true }),
		])

		const address = addressResult.derivations[0]?.address ?? 'unknown'
		const totalSatoshis = balanceResult.outputs.reduce(
			(sum, o) => sum + o.satoshis,
			0,
		)

		const info = {
			chain: opts.chain,
			address,
			identityKey: identityResult.publicKey,
			balance: totalSatoshis,
			utxos: balanceResult.outputs.length,
		}

		if (opts.json) {
			output(info, opts)
		} else {
			printKeyValue({
				Chain: info.chain,
				Address: info.address,
				'Identity Key': info.identityKey,
				'Balance (sats)': info.balance,
				UTXOs: info.utxos,
			})
		}
	} finally {
		await destroy()
	}
}
