/**
 * OpNS commands - register, deregister, lookup, mine.
 *
 * Manage OpNS name identity bindings and paid mining jobs.
 */

import {
	getDisplayValue,
	getOpnsNames,
	opnsDeregister as opnsDeregisterAction,
	opnsMine as opnsMineAction,
	opnsMineRefund as opnsMineRefundAction,
	opnsMineStatus as opnsMineStatusAction,
	opnsRegister as opnsRegisterAction,
} from '@1sat/actions'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey } from '../keys'
import { fatal, formatLabel, formatValue, output } from '../output'

export async function handleOpnsCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'register':
			return opnsRegister(rest, opts)
		case 'deregister':
			return opnsDeregister(rest, opts)
		case 'lookup':
			return opnsLookup(rest, opts)
		case 'mine':
			return opnsMine(rest, opts)
		case 'mine-status':
			return opnsMineStatus(rest, opts)
		case 'mine-refund':
			return opnsMineRefund(rest, opts)
		default:
			printCommandHelp('opns', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function opnsRegister(args: string[], opts: GlobalFlags): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Register identity on OpNS name ${outpoint}?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Registration cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		// Look up the OpNS ordinal from the wallet
		const namesResult = await getOpnsNames.execute(ctx, { limit: 10000 })
		const ordinal = namesResult.outputs.find((o) => o.outpoint === outpoint)
		if (!ordinal) {
			fatal(`OpNS name not found in wallet: ${outpoint}`)
		}

		const result = await opnsRegisterAction.execute(ctx, {
			ordinal,
			inputBEEF: namesResult.BEEF as number[] | undefined,
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function opnsDeregister(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Deregister identity from OpNS name ${outpoint}?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Deregistration cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		// Look up the OpNS ordinal from the wallet
		const namesResult = await getOpnsNames.execute(ctx, { limit: 10000 })
		const ordinal = namesResult.outputs.find((o) => o.outpoint === outpoint)
		if (!ordinal) {
			fatal(`OpNS name not found in wallet: ${outpoint}`)
		}

		const result = await opnsDeregisterAction.execute(ctx, {
			ordinal,
			inputBEEF: namesResult.BEEF as number[] | undefined,
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function opnsMine(args: string[], opts: GlobalFlags): Promise<void> {
	const name = extractFlag(args, '--name')
	const serviceUrl = extractFlag(args, '--service')
	const receiveAddress = extractFlag(args, '--receive-address')
	const timeout = extractFlag(args, '--timeout')

	if (!name) fatal('Missing --name <name>')
	if (!serviceUrl) fatal('Missing --service <url>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Pay ${serviceUrl} to mine "${name}"? The full price is charged upfront.`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Mine cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await opnsMineAction.execute(ctx, {
			name,
			serviceUrl,
			receiveAddress: receiveAddress ?? undefined,
			timeoutMs: timeout ? Number.parseInt(timeout, 10) : undefined,
		})
		if (result.error && !result.jobId) {
			fatal(result.error)
		}
		output(
			opts.json
				? result
				: {
						jobId: result.jobId,
						state: result.state,
						txid: result.txid,
						...(result.error ? { error: result.error } : {}),
					},
			opts,
		)
	} finally {
		await destroy()
	}
}

async function opnsMineStatus(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const jobId = extractFlag(args, '--job')
	const serviceUrl = extractFlag(args, '--service')

	if (!jobId) fatal('Missing --job <paymentTxid>')
	if (!serviceUrl) fatal('Missing --service <url>')

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await opnsMineStatusAction.execute(ctx, {
			jobId,
			serviceUrl,
		})
		if (result.error && !result.state) {
			fatal(result.error)
		}
		output(result, opts)
	} finally {
		await destroy()
	}
}

async function opnsMineRefund(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const jobId = extractFlag(args, '--job')
	const serviceUrl = extractFlag(args, '--service')

	if (!jobId) fatal('Missing --job <paymentTxid>')
	if (!serviceUrl) fatal('Missing --service <url>')

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await opnsMineRefundAction.execute(ctx, {
			jobId,
			serviceUrl,
		})
		if (result.error) {
			fatal(result.error)
		}
		output(result, opts)
	} finally {
		await destroy()
	}
}

async function opnsLookup(_args: string[], opts: GlobalFlags): Promise<void> {
	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await getOpnsNames.execute(ctx, { limit: 100 })

		if (opts.json) {
			output(result.outputs, opts)
			return
		}

		if (result.outputs.length === 0) {
			output('No OpNS names found.', opts)
			return
		}

		for (const o of result.outputs) {
			const nameTag = getDisplayValue(o, 'name', 'name') ?? ''
			const publishedTag = o.tags?.find((t) => t === 'opns:published')
			const status = publishedTag ? 'registered' : 'unregistered'

			console.log(
				`  ${formatValue(o.outpoint)}  ${nameTag ? formatValue(nameTag) : ''}  ${formatLabel(status)}`,
			)
		}

		console.log(`\n  ${result.outputs.length} OpNS name(s) found.`)
	} finally {
		await destroy()
	}
}
