/**
 * Lock commands — list, bsv (lock), unlock.
 */

import { listLocks, lockBsv, unlockBsv } from '@1sat/actions'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args.js'
import { extractFlag } from '../args.js'
import { idFromTags } from '../beef.js'
import { loadContext } from '../context.js'
import { printCommandHelp } from '../help.js'
import { loadKey } from '../keys.js'
import { fatal, formatLabel, formatValue, output } from '../output.js'

export async function handleLocksCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'list':
		case 'info': // deprecated alias — still summary-friendly
			return locksList(rest, opts)
		case 'bsv':
		case 'lock': // deprecated alias
			return locksBsv(rest, opts)
		case 'unlock':
			return locksUnlock(rest, opts)
		default:
			printCommandHelp('locks', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function locksList(_args: string[], opts: GlobalFlags): Promise<void> {
	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await listLocks.execute(ctx, {})

		if (opts.json) {
			output(result.outputs, opts)
			return
		}

		if (result.outputs.length === 0) {
			output('No locks found.', opts)
			return
		}

		let total = 0
		for (const o of result.outputs) {
			const id = idFromTags(o.tags) ?? ''
			const until = o.tags?.find((t) => t.startsWith('until:'))?.slice(6) ?? '?'
			total += o.satoshis
			console.log(
				`  ${formatValue(id)}  ${formatValue(String(o.satoshis))} sats  until ${formatLabel(until)}  ${formatValue(o.outpoint)}`,
			)
		}
		console.log(`\n  ${result.outputs.length} lock(s), ${total} sats total.`)
	} finally {
		await destroy()
	}
}

async function locksBsv(args: string[], opts: GlobalFlags): Promise<void> {
	const satsStr = extractFlag(args, '--sats')
	const untilStr = extractFlag(args, '--until') ?? extractFlag(args, '--blocks')

	if (!satsStr) fatal('Missing --sats <amount>')
	if (!untilStr) fatal('Missing --until <block-height>')

	const satoshis = Number(satsStr)
	if (!Number.isFinite(satoshis) || satoshis <= 0) {
		fatal('--sats must be a positive number')
	}

	const until = Number(untilStr)
	if (!Number.isFinite(until) || until <= 0) {
		fatal('--until must be a positive block height')
	}

	if (!opts.yes) {
		const ok = await confirm({
			message: `Lock ${satoshis} satoshis until block ${until}?`,
		})
		if (isCancel(ok) || !ok) fatal('Lock cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await lockBsv.execute(ctx, {
			requests: [{ satoshis, until }],
		})
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function locksUnlock(args: string[], opts: GlobalFlags): Promise<void> {
	const ids = extractFlag(args, '--ids')
		?.split(',')
		.map((s) => s.trim())
		.filter(Boolean)

	if (!opts.yes) {
		const ok = await confirm({
			message: ids?.length
				? `Unlock ${ids.length} lock(s)?`
				: 'Unlock all matured locks?',
		})
		if (isCancel(ok) || !ok) fatal('Unlock cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await unlockBsv.execute(ctx, {
			...(ids?.length ? { ids } : {}),
		})
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}
