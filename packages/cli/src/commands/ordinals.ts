/**
 * Ordinals commands — id-first wallet spends; external buy with outpoint/BEEF.
 */

import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import {
	burnOrdinals,
	buyOrdinal,
	cancelOrdinalListing,
	getDisplayValue,
	inscribe,
	listOrdinals,
	sellOrdinal,
	sendOrdinals,
} from '@1sat/actions'
import { Utils } from '@bsv/sdk'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args.js'
import { extractFlag, hasFlag } from '../args.js'
import { idFromTags, parseBeefFlag, parseToFlag } from '../beef.js'
import { loadContext } from '../context.js'
import { printCommandHelp } from '../help.js'
import { loadKey } from '../keys.js'
import { fatal, formatLabel, formatValue, output } from '../output.js'

export async function handleOrdinalsCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'list':
			return ordinalsList(rest, opts)
		case 'inscribe':
		case 'mint': // deprecated alias
			return ordinalsInscribe(rest, opts)
		case 'send':
		case 'transfer': // deprecated alias
			return ordinalsSend(rest, opts)
		case 'sell':
			return ordinalsSell(rest, opts)
		case 'cancel':
			return ordinalsCancel(rest, opts)
		case 'buy':
			return ordinalsBuy(rest, opts)
		case 'burn':
			return ordinalsBurn(rest, opts)
		default:
			printCommandHelp('ordinals', opts.json)
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

async function ordinalsList(args: string[], opts: GlobalFlags): Promise<void> {
	const limit = Number(extractFlag(args, '--limit') ?? '100')
	const offset = Number(extractFlag(args, '--offset') ?? '0')
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
		const result = await listOrdinals.execute(ctx, {
			limit,
			offset,
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
			output('No ordinals found.', opts)
			return
		}

		for (const o of result.outputs) {
			const id = idFromTags(o.tags) ?? ''
			const typeTag =
				o.tags?.find((t) => t.startsWith('type:'))?.slice(5) ?? 'unknown'
			const originTag =
				o.tags?.find((t) => t.startsWith('origin:'))?.slice(7) ?? ''
			const nameTag = getDisplayValue(o, 'name', 'name') ?? ''

			console.log(
				`  ${formatValue(id)}  ${formatValue(o.outpoint)}  ${formatLabel(typeTag)}${nameTag ? `  ${nameTag}` : ''}${originTag ? `  origin:${originTag}` : ''}`,
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

async function ordinalsInscribe(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const file = extractFlag(args, '--file')
	const type = extractFlag(args, '--type')
	const mapStr = extractFlag(args, '--map')
	const signWithBAP = hasFlag(args, '--sign-with-bap')
	const stream = hasFlag(args, '--stream')
	const streamChunkSize = extractFlag(args, '--stream-chunk-size')

	if (!file) fatal('Missing --file <path>')

	const contentType = type ?? MIME_TYPES[extname(file).toLowerCase()]
	if (!contentType) {
		fatal(
			`Cannot detect content type for ${basename(file)}. Use --type <mime-type>`,
		)
	}

	let map: Record<string, string> | undefined
	if (mapStr !== undefined) {
		let parsed: unknown
		try {
			parsed = JSON.parse(mapStr)
		} catch (err) {
			fatal(`--map must be valid JSON: ${(err as Error).message}`)
		}
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			fatal('--map must be a JSON object')
		}
		for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof v !== 'string') {
				fatal(`--map values must be strings (key "${k}" is ${typeof v})`)
			}
		}
		map = parsed as Record<string, string>
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
		if (isCancel(ok) || !ok) fatal('Inscription cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await inscribe.execute(ctx, {
			base64Content,
			contentType,
			...(map ? { map } : {}),
			...(signWithBAP ? { signWithBAP: true } : {}),
			...(stream ? { stream: true } : {}),
			...(streamChunkSize ? { streamChunkSize: Number(streamChunkSize) } : {}),
		})

		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function ordinalsSend(args: string[], opts: GlobalFlags): Promise<void> {
	const id = requireId(args)
	const to = extractFlag(args, '--to')
	if (!to) fatal('Missing --to <address|identityKey>')

	const dest = parseToFlag(to)

	if (!opts.yes) {
		const ok = await confirm({
			message: `Send ordinal id ${id} to ${to}?`,
		})
		if (isCancel(ok) || !ok) fatal('Send cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await sendOrdinals.execute(ctx, {
			transfers: [{ id, ...dest }],
		})
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function ordinalsSell(args: string[], opts: GlobalFlags): Promise<void> {
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
			message: `List ordinal id ${id} for sale at ${price} satoshis?`,
		})
		if (isCancel(ok) || !ok) fatal('Listing cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await sellOrdinal.execute(ctx, {
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

async function ordinalsCancel(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const id = requireId(args)

	if (!opts.yes) {
		const ok = await confirm({
			message: `Cancel listing for ordinal id ${id}?`,
		})
		if (isCancel(ok) || !ok) fatal('Cancellation cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await cancelOrdinalListing.execute(ctx, { id })
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function ordinalsBuy(args: string[], opts: GlobalFlags): Promise<void> {
	const outpoint = extractFlag(args, '--outpoint')
	const beef = parseBeefFlag(extractFlag(args, '--beef'))

	if (!outpoint) fatal('Missing --outpoint <txid.vout>')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Purchase ordinal listing ${outpoint}?`,
		})
		if (isCancel(ok) || !ok) fatal('Purchase cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await buyOrdinal.execute(ctx, {
			outpoint,
			...(beef && { inputBEEF: beef }),
		})
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

async function ordinalsBurn(args: string[], opts: GlobalFlags): Promise<void> {
	const idsStr = extractFlag(args, '--ids')
	if (!idsStr) fatal('Missing --ids <id1,id2,...>')
	const ids = idsStr
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
	if (!ids.length) fatal('--ids must include at least one id')

	if (!opts.yes) {
		const ok = await confirm({
			message: `Burn ${ids.length} ordinal(s) permanently? This cannot be undone.`,
		})
		if (isCancel(ok) || !ok) fatal('Burn cancelled.')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, { chain: opts.chain })

	try {
		const result = await burnOrdinals.execute(ctx, { ids })
		if (result.error) fatal(result.error)
		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}
