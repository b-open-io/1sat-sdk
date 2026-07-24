/**
 * OpNS commands — id-first wallet spends; external buy with outpoint/BEEF.
 */

import {
	buyOpns,
	cancelOpnsListing,
	deregisterOpns,
	getDisplayValue,
	internalizeOpns,
	listOpns,
	registerOpns,
	sellOpns,
	sendOpns,
} from '@1sat/actions'
import { P1SAT_PROTOCOL } from '@1sat/types'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { idFromTags, parseBeefFlag, parseToFlag } from '../beef'
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
		case 'sell':
			return opnsSell(rest, opts)
		case 'buy':
			return opnsBuy(rest, opts)
		case 'cancel-listing':
			return opnsCancelListingCmd(rest, opts)
		case 'send':
			return opnsSend(rest, opts)
		case 'internalize':
			return opnsInternalize(rest, opts)
		default:
			printCommandHelp('opns', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

function requireId(args: string[]): string {
	const id = extractFlag(args, '--id')
	if (!id) fatal('Missing --id <tracking-id>')
	return id
}

async function opnsRegister(args: string[], opts: GlobalFlags): Promise<void> {
	const id = requireId(args)

	if (!opts.yes) {
		const ok = await confirm({
			message: `Register identity on OpNS id ${id}?`,
		})
		if (isCancel(ok) || !ok) fatal('Registration cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await registerOpns.execute(ctx, { id })
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function opnsDeregister(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const id = requireId(args)

	if (!opts.yes) {
		const ok = await confirm({
			message: `Deregister identity from OpNS id ${id}?`,
		})
		if (isCancel(ok) || !ok) fatal('Deregistration cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await deregisterOpns.execute(ctx, { id })
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function opnsLookup(args: string[], opts: GlobalFlags): Promise<void> {
	const limit = Number(extractFlag(args, '--limit') ?? '100')
	const offset = Number(extractFlag(args, '--offset') ?? '0')
	const names = extractFlag(args, '--names')?.split(',').filter(Boolean)
	const ids = extractFlag(args, '--ids')?.split(',').filter(Boolean)
	const tags = extractFlag(args, '--tags')?.split(',').filter(Boolean)
	const tagQueryMode = extractFlag(args, '--tag-query-mode') as
		| 'all'
		| 'any'
		| undefined
	const include = extractFlag(args, '--include') as
		| 'locking scripts'
		| 'entire transactions'
		| undefined

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await listOpns.execute(ctx, {
			limit,
			offset,
			names,
			ids,
			tags,
			tagQueryMode,
			include,
		})

		if (opts.json) {
			output(result.outputs, opts)
			return
		}

		if (result.outputs.length === 0) {
			output('No OpNS names found.', opts)
			return
		}

		for (const o of result.outputs) {
			const id = idFromTags(o.tags) ?? ''
			const nameTag = getDisplayValue(o, 'name', 'name') ?? ''
			const publishedTag = o.tags?.find((t) => t === 'opns:published')
			const status = publishedTag ? 'registered' : 'unregistered'
			const price = o.tags?.some((t) => t === 'ordlock')
				? (o.tags
						?.find((t) => t.startsWith('price:'))
						?.slice('price:'.length) ?? '?')
				: undefined
			const listed = price ? `  ${formatLabel(`listed @ ${price}`)}` : ''

			console.log(
				`  ${formatValue(id)}  ${formatValue(o.outpoint)}  ${nameTag ? formatValue(nameTag) : ''}  ${formatLabel(status)}${listed}`,
			)
		}

		console.log(`\n  ${result.outputs.length} OpNS name(s) found.`)
	} finally {
		await destroy()
	}
}

async function opnsCancelListingCmd(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const id = requireId(args)

	if (!opts.yes) {
		const ok = await confirm({
			message: `Cancel listing for OpNS id ${id}?`,
		})
		if (isCancel(ok) || !ok) fatal('Cancellation cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await cancelOpnsListing.execute(ctx, { id })
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function opnsSell(args: string[], opts: GlobalFlags): Promise<void> {
	const id = requireId(args)
	const priceStr = extractFlag(args, '--price')
	const payAddress = extractFlag(args, '--pay-address')

	if (!priceStr) fatal('Missing --price <satoshis>')
	const price = Number(priceStr)
	if (!Number.isFinite(price) || price <= 0) {
		fatal('--price must be a positive number')
	}

	if (!opts.yes) {
		const ok = await confirm({
			message: `List OpNS id ${id} for sale at ${price} satoshis?`,
		})
		if (isCancel(ok) || !ok) fatal('Listing cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await sellOpns.execute(ctx, {
			id,
			price,
			...(payAddress && { payAddress }),
		})
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function opnsSend(args: string[], opts: GlobalFlags): Promise<void> {
	const id = requireId(args)
	const to = extractFlag(args, '--to')
	if (!to) fatal('Missing --to <address|identityKey>')

	const dest = parseToFlag(to)

	if (!opts.yes) {
		const ok = await confirm({
			message: `Send OpNS id ${id} to ${to}?`,
		})
		if (isCancel(ok) || !ok) fatal('Send cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await sendOpns.execute(ctx, { id, ...dest })
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function opnsBuy(args: string[], opts: GlobalFlags): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')
	const beef = parseBeefFlag(extractFlag(args, '--beef'))
	const name = extractFlag(args, '--name')
	const origin = extractFlag(args, '--origin')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Purchase OpNS listing ${outpoint}?`,
		})
		if (isCancel(ok) || !ok) fatal('Purchase cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await buyOpns.execute(ctx, {
			outpoint,
			...(beef && { inputBEEF: beef }),
			...(name && { name }),
			...(origin && { origin }),
		})
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function opnsInternalize(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const beef = parseBeefFlag(extractFlag(args, '--beef'))
	const keyID = extractFlag(args, '--key-id') ?? '1sat 0'

	if (!beef) fatal('Missing --beef <file|hex|base64>')

	if (!opts.yes) {
		const ok = await confirm({
			message: 'Internalize OpNS mint AtomicBEEF into wallet?',
		})
		if (isCancel(ok) || !ok) fatal('Internalize cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await internalizeOpns.execute(ctx, {
			tx: beef,
			protocolID: P1SAT_PROTOCOL,
			keyID,
		})
		if (result.error) fatal(result.error)
		output(opts.json ? result : result, opts)
	} finally {
		await destroy()
	}
}
