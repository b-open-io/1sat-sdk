/**
 * Lock commands - info, lock, unlock.
 */

import { getLockData, lockBsv, unlockBsv } from '@1sat/actions'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey } from '../keys'
import { fatal, output, printKeyValue } from '../output'

export async function handleLocksCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'info':
			return locksInfo(rest, opts)
		case 'lock':
			return locksLock(rest, opts)
		case 'unlock':
			return locksUnlock(rest, opts)
		default:
			printCommandHelp('locks', {
				info: 'Show lock information and maturity status',
				lock: 'Time-lock BSV (--sats <amount> --blocks <n>)',
				unlock: 'Unlock matured BSV locks',
			})
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function locksInfo(_args: string[], opts: GlobalFlags): Promise<void> {
	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const data = await getLockData.execute(ctx, {})

		if (opts.json) {
			output(data, opts)
			return
		}

		printKeyValue({
			'Total Locked (sats)': data.totalLocked,
			'Unlockable (sats)': data.unlockable,
			'Next Unlock Block': data.nextUnlock || 'none',
		})
	} finally {
		await destroy()
	}
}

async function locksLock(args: string[], opts: GlobalFlags): Promise<void> {
	const satsStr = extractFlag(args, '--sats')
	const blocksStr = extractFlag(args, '--blocks')

	if (!satsStr) fatal('Missing --sats <amount>')
	if (!blocksStr) fatal('Missing --blocks <n>')

	const satoshis = Number(satsStr)
	if (!Number.isFinite(satoshis) || satoshis <= 0) {
		fatal('--sats must be a positive number')
	}

	const until = Number(blocksStr)
	if (!Number.isFinite(until) || until <= 0) {
		fatal('--blocks must be a positive block height')
	}

	if (!opts.yes) {
		const ok = await confirm({
			message: `Lock ${satoshis} satoshis until block ${until}?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Lock cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await lockBsv.execute(ctx, {
			requests: [{ satoshis, until }],
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function locksUnlock(_args: string[], opts: GlobalFlags): Promise<void> {
	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await unlockBsv.execute(ctx, {})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}
