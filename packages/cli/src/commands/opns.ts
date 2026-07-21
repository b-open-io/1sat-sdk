/**
 * OpNS commands - register, deregister, lookup, sell, buy, cancel-listing.
 *
 * Manage OpNS names: payment identity bindings and market listings. Paid
 * mining is product code on 1sat.name.
 */

import {
	cancelListing,
	deriveDepositAddresses,
	getDisplayValue,
	getOpnsNames,
	listOrdinal,
	opnsDeregister as opnsDeregisterAction,
	opnsRegister as opnsRegisterAction,
	purchaseOrdinal,
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
		case 'sell':
			return opnsSell(rest, opts)
		case 'buy':
			return opnsBuy(rest, opts)
		case 'cancel-listing':
			return opnsCancelListing(rest, opts)
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
			const price = o.tags?.some((t) => t === 'ordlock')
				? (o.tags
						?.find((t) => t.startsWith('price:'))
						?.slice('price:'.length) ?? '?')
				: undefined
			const listed = price ? `  ${formatLabel(`listed @ ${price}`)}` : ''

			console.log(
				`  ${formatValue(o.outpoint)}  ${nameTag ? formatValue(nameTag) : ''}  ${formatLabel(status)}${listed}`,
			)
		}

		console.log(`\n  ${result.outputs.length} OpNS name(s) found.`)
	} finally {
		await destroy()
	}
}

async function opnsCancelListing(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Cancel listing for OpNS name ${outpoint}?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Cancellation cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const namesResult = await getOpnsNames.execute(ctx, { limit: 10000 })
		const listing = namesResult.outputs.find((o) => o.outpoint === outpoint)
		if (!listing) {
			fatal(`Listing not found in wallet OpNS basket: ${outpoint}`)
		}

		const result = await cancelListing.execute(ctx, {
			listing,
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

async function opnsSell(args: string[], opts: GlobalFlags): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')
	const priceStr = extractFlag(args, '--price')
	const payAddressFlag = extractFlag(args, '--pay-address')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')
	if (!priceStr) fatal('Missing --price <satoshis>')

	const price = Number(priceStr)
	if (!Number.isFinite(price) || price <= 0) {
		fatal('--price must be a positive number')
	}

	if (!opts.yes) {
		const ok = await confirm({
			message: `List OpNS name ${outpoint} for sale at ${price} satoshis?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Listing cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const namesResult = await getOpnsNames.execute(ctx, { limit: 10000 })
		const ordinal = namesResult.outputs.find((o) => o.outpoint === outpoint)
		if (!ordinal) {
			fatal(`OpNS name not found in wallet: ${outpoint}`)
		}

		let payAddress = payAddressFlag
		if (!payAddress) {
			const addressResult = await deriveDepositAddresses.execute(ctx, {
				prefix: '1sat',
				count: 1,
			})
			payAddress = addressResult.derivations[0]?.address
			if (!payAddress) {
				fatal('Failed to derive pay address')
			}
		}

		const result = await listOrdinal.execute(ctx, {
			ordinal,
			price,
			payAddress,
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

async function opnsBuy(args: string[], opts: GlobalFlags): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Purchase OpNS name listing ${outpoint}?`,
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
		const result = await purchaseOrdinal.execute(ctx, { outpoint })

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}
