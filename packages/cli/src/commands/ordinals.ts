/**
 * Ordinals commands - list, mint, transfer, sell, cancel, buy.
 */

import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import {
	cancelListing,
	deriveDepositAddresses,
	getOrdinals,
	inscribe,
	listOrdinal,
	purchaseOrdinal,
	transferOrdinals,
} from '@1sat/actions'
import { Utils } from '@bsv/sdk'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey, resolvePassword } from '../keys'
import { fatal, formatLabel, formatValue, output } from '../output'

export async function handleOrdinalsCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'list':
			return ordinalsList(rest, opts)
		case 'mint':
			return ordinalsMint(rest, opts)
		case 'transfer':
			return ordinalsTransfer(rest, opts)
		case 'sell':
			return ordinalsSell(rest, opts)
		case 'cancel':
			return ordinalsCancel(rest, opts)
		case 'buy':
			return ordinalsBuy(rest, opts)
		default:
			printCommandHelp('ordinals', {
				list: 'List owned ordinals/inscriptions',
				mint: 'Mint a new ordinal inscription (--file <path> --type <mime>)',
				transfer: 'Transfer an ordinal (--outpoint <op> --to <addr>)',
				sell: 'List an ordinal for sale (--outpoint <op> --price <sats>)',
				cancel: 'Cancel an ordinal listing (--outpoint <op>)',
				buy: 'Purchase a listed ordinal (--outpoint <op>)',
			})
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function ordinalsList(_args: string[], opts: GlobalFlags): Promise<void> {
	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await getOrdinals.execute(ctx, {
			limit: 100,
			offset: 0,
		})

		if (opts.json) {
			output(result.outputs, opts)
			return
		}

		if (result.outputs.length === 0) {
			output('No ordinals found.', opts)
			return
		}

		for (const o of result.outputs) {
			const typeTag =
				o.tags?.find((t) => t.startsWith('type:'))?.slice(5) ?? 'unknown'
			const originTag =
				o.tags?.find((t) => t.startsWith('origin:'))?.slice(7) ?? ''
			const nameTag = o.tags?.find((t) => t.startsWith('name:'))?.slice(5) ?? ''

			console.log(
				`  ${formatValue(o.outpoint)}  ${formatLabel(typeTag)}${nameTag ? `  ${nameTag}` : ''}${originTag ? `  origin:${originTag}` : ''}`,
			)
		}

		console.log(`\n  ${result.outputs.length} ordinal(s) found.`)
	} finally {
		await destroy()
	}
}

const MIME_TYPES: Record<string, string> = {
	'.txt': 'text/plain',
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.xml': 'application/xml',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.pdf': 'application/pdf',
}

async function ordinalsMint(args: string[], opts: GlobalFlags): Promise<void> {
	const file = extractFlag(args, '--file')
	const type = extractFlag(args, '--type')

	if (!file) fatal('Missing --file <path>')

	const contentType = type ?? MIME_TYPES[extname(file).toLowerCase()]
	if (!contentType) {
		fatal(
			`Cannot detect content type for ${basename(file)}. Use --type <mime-type>`,
		)
	}

	let fileBytes: Uint8Array
	try {
		fileBytes = readFileSync(file)
	} catch (err) {
		fatal(`Failed to read file: ${(err as Error).message}`)
	}

	const base64Content = Utils.toBase64(Array.from(fileBytes))

	if (!opts.yes) {
		const ok = await confirm({
			message: `Inscribe ${basename(file)} (${contentType}, ${fileBytes.length} bytes)?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Inscription cancelled.')
		}
	}

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await inscribe.execute(ctx, {
			base64Content,
			contentType,
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function ordinalsTransfer(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')
	const to = extractFlag(args, '--to')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')
	if (!to) fatal('Missing --to <address>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Transfer ordinal ${outpoint} to ${to}?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Transfer cancelled.')
		}
	}

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		// Look up the ordinal from the wallet
		const ordinalsResult = await getOrdinals.execute(ctx, { limit: 10000 })
		const ordinal = ordinalsResult.outputs.find((o) => o.outpoint === outpoint)
		if (!ordinal) {
			fatal(`Ordinal not found in wallet: ${outpoint}`)
		}

		const result = await transferOrdinals.execute(ctx, {
			transfers: [{ ordinal, address: to }],
			inputBEEF: ordinalsResult.BEEF as number[] | undefined,
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function ordinalsSell(args: string[], opts: GlobalFlags): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')
	const priceStr = extractFlag(args, '--price')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')
	if (!priceStr) fatal('Missing --price <satoshis>')

	const price = Number(priceStr)
	if (!Number.isFinite(price) || price <= 0) {
		fatal('--price must be a positive number')
	}

	if (!opts.yes) {
		const ok = await confirm({
			message: `List ordinal ${outpoint} for sale at ${price} satoshis?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Listing cancelled.')
		}
	}

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		// Look up the ordinal from the wallet
		const ordinalsResult = await getOrdinals.execute(ctx, { limit: 10000 })
		const ordinal = ordinalsResult.outputs.find((o) => o.outpoint === outpoint)
		if (!ordinal) {
			fatal(`Ordinal not found in wallet: ${outpoint}`)
		}

		// Derive a BRC-29 address to receive payment
		const addressResult = await deriveDepositAddresses.execute(ctx, {
			prefix: '1sat',
			count: 1,
		})
		const payAddress = addressResult.derivations[0]?.address
		if (!payAddress) {
			fatal('Failed to derive pay address')
		}

		const result = await listOrdinal.execute(ctx, {
			ordinal,
			price,
			payAddress,
			inputBEEF: ordinalsResult.BEEF as number[] | undefined,
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function ordinalsCancel(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Cancel listing for ordinal ${outpoint}?`,
		})
		if (isCancel(ok) || !ok) {
			fatal('Cancellation cancelled.')
		}
	}

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		// Look up the listing from the wallet (listings are in ordinals basket with ordlock tag)
		const ordinalsResult = await getOrdinals.execute(ctx, { limit: 10000 })
		const listing = ordinalsResult.outputs.find((o) => o.outpoint === outpoint)
		if (!listing) {
			fatal(`Listing not found in wallet: ${outpoint}`)
		}

		const result = await cancelListing.execute(ctx, {
			listing,
			inputBEEF: ordinalsResult.BEEF as number[] | undefined,
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function ordinalsBuy(args: string[], opts: GlobalFlags): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Purchase ordinal listing ${outpoint}?`,
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
		const result = await purchaseOrdinal.execute(ctx, { outpoint })

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}
