/**
 * Wallet commands - balance, address, send, send-all, info.
 * BRC-100 interface commands - list-outputs, relinquish-output, list-actions, etc.
 */

import {
	deriveDepositAddresses,
	sendAllBsv,
	sendBsv,
	syncAddresses,
} from '@1sat/actions'
import type { WalletInterface } from '@bsv/sdk'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { extractFlag, extractFlags } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey } from '../keys'
import { fatal, formatValue, output, printKeyValue } from '../output'

/**
 * BRC-100 methods reached by passing the method's own args as one JSON
 * argument. The commands above wrap the handful that benefit from flags and
 * formatting; these keep the rest of the interface reachable rather than
 * leaving it to one-off scripts.
 */
const PASSTHROUGH_METHODS = {
	'get-public-key': 'getPublicKey',
	encrypt: 'encrypt',
	decrypt: 'decrypt',
	'create-hmac': 'createHmac',
	'verify-hmac': 'verifyHmac',
	'create-signature': 'createSignature',
	'verify-signature': 'verifySignature',
	'internalize-action': 'internalizeAction',
	'acquire-certificate': 'acquireCertificate',
	'prove-certificate': 'proveCertificate',
	'discover-by-identity-key': 'discoverByIdentityKey',
	'discover-by-attributes': 'discoverByAttributes',
	'get-height': 'getHeight',
	'get-header-for-height': 'getHeaderForHeight',
	'get-network': 'getNetwork',
	'get-version': 'getVersion',
} as const satisfies Record<string, keyof WalletInterface>

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
		case 'sync':
			return walletSync(rest, opts)
		case 'info':
			return walletInfo(rest, opts)
		case 'list-outputs':
			return walletListOutputs(rest, opts)
		case 'relinquish-output':
			return walletRelinquishOutput(rest, opts)
		case 'list-actions':
			return walletListActions(rest, opts)
		case 'create-action':
			return walletCreateAction(rest, opts)
		case 'sign-action':
			return walletSignAction(rest, opts)
		case 'abort-action':
			return walletAbortAction(rest, opts)
		case 'list-certificates':
			return walletListCertificates(rest, opts)
		case 'relinquish-certificate':
			return walletRelinquishCertificate(rest, opts)
		default: {
			const method =
				PASSTHROUGH_METHODS[subcommand as keyof typeof PASSTHROUGH_METHODS]
			if (method) return walletPassthrough(method, rest, opts)
			printCommandHelp('wallet', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
		}
	}
}

/** Calls a BRC-100 method with parsed JSON args; no args means `{}`. */
async function walletPassthrough(
	method: keyof WalletInterface,
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const jsonInput = args[0]
	let methodArgs: unknown = {}
	if (jsonInput) {
		try {
			methodArgs = JSON.parse(jsonInput)
		} catch {
			fatal(`Invalid JSON: ${jsonInput}`)
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const call = ctx.wallet[method] as (a: unknown) => Promise<unknown>
		output(await call.call(ctx.wallet, methodArgs), opts)
	} finally {
		await destroy()
	}
}

async function walletBalance(
	_args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const privateKey = await loadKey()
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

async function walletAddress(args: string[], opts: GlobalFlags): Promise<void> {
	const prefix = extractFlag(args, '--prefix') ?? '1sat'
	const startIndexStr = extractFlag(args, '--start-index')
	const countStr = extractFlag(args, '--count')

	const startIndex = startIndexStr === undefined ? 0 : Number(startIndexStr)
	const count = countStr === undefined ? 1 : Number(countStr)

	if (!Number.isInteger(startIndex) || startIndex < 0) {
		fatal('--start-index must be a non-negative integer')
	}
	if (!Number.isInteger(count) || count < 1) {
		fatal('--count must be a positive integer')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await deriveDepositAddresses.execute(ctx, {
			prefix,
			startIndex,
			count,
		})

		if (!result.derivations.length) {
			fatal('Failed to derive deposit address')
		}

		if (opts.json) {
			output(count === 1 ? result.derivations[0] : result.derivations, opts)
		} else if (!opts.quiet) {
			for (const d of result.derivations) {
				console.log(d.address)
			}
		}
	} finally {
		await destroy()
	}
}

async function walletSend(args: string[], opts: GlobalFlags): Promise<void> {
	const to = extractFlag(args, '--to')
	const script = extractFlag(args, '--script')
	const dataAsm = extractFlag(args, '--data-asm')
	const satsStr = extractFlag(args, '--sats')

	const modes = [to, script, dataAsm].filter((v) => v !== undefined).length
	if (modes === 0) {
		fatal(
			'Specify one of --to <address>, --script <hex>, or --data-asm "<asm>"',
		)
	}
	if (modes > 1) {
		fatal('--to, --script, and --data-asm are mutually exclusive')
	}

	let request: {
		address?: string
		script?: string
		data?: string[]
		satoshis: number
	}
	let confirmMessage: string

	if (dataAsm !== undefined) {
		if (satsStr !== undefined) {
			fatal(
				'--sats is not allowed with --data-asm (OP_RETURN outputs are 0 sats)',
			)
		}
		request = { data: [dataAsm], satoshis: 0 }
		confirmMessage = `Publish OP_RETURN data "${dataAsm}"?`
	} else {
		if (!satsStr) fatal('Missing --sats <amount>')
		const satoshis = Number(satsStr)
		if (!Number.isFinite(satoshis) || satoshis <= 0) {
			fatal('--sats must be a positive number')
		}
		if (script !== undefined) {
			if (!/^[0-9a-fA-F]*$/.test(script) || script.length % 2 !== 0) {
				fatal('--script must be a hex string')
			}
			request = { script, satoshis }
			confirmMessage = `Send ${satoshis} satoshis to custom script?`
		} else {
			request = { address: to, satoshis }
			confirmMessage = `Send ${satoshis} satoshis to ${to}?`
		}
	}

	if (!opts.yes) {
		const ok = await confirm({ message: confirmMessage })
		if (isCancel(ok) || !ok) {
			fatal('Send cancelled.')
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await sendBsv.execute(ctx, { requests: [request] })

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

	const privateKey = await loadKey()
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

async function walletSync(args: string[], opts: GlobalFlags): Promise<void> {
	const prefix = extractFlag(args, '--prefix')
	const startIndexRaw = extractFlag(args, '--start-index')
	const countRaw = extractFlag(args, '--count')

	const startIndex =
		startIndexRaw !== undefined ? Number.parseInt(startIndexRaw, 10) : undefined
	const count =
		countRaw !== undefined ? Number.parseInt(countRaw, 10) : undefined

	if (
		startIndex !== undefined &&
		(!Number.isFinite(startIndex) || startIndex < 0)
	) {
		fatal('--start-index must be a non-negative integer')
	}
	if (count !== undefined && (!Number.isFinite(count) || count < 1)) {
		fatal('--count must be a positive integer')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await syncAddresses.execute(ctx, {
			...(prefix ? { prefix } : {}),
			...(startIndex !== undefined ? { startIndex } : {}),
			...(count !== undefined ? { count } : {}),
		})

		if (opts.json) {
			output(result, opts)
			return
		}

		console.log(
			`\nprocessed: ${result.processed}  failed: ${result.failed}  lastScore: ${result.lastScore}`,
		)
		if (result.addresses.length > 0) {
			console.log('addresses:')
			for (const addr of result.addresses) console.log(`  ${addr}`)
		}
		console.log()
	} finally {
		await destroy()
	}
}

async function walletInfo(_args: string[], opts: GlobalFlags): Promise<void> {
	const privateKey = await loadKey()
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

// BRC-100 Interface Commands

async function walletListOutputs(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const basket = extractFlag(args, '--basket')
	if (!basket) fatal('Missing required --basket <name>')

	const tags = extractFlags(args, '--tags')
	const limitStr = extractFlag(args, '--limit')
	const limit = limitStr ? Number.parseInt(limitStr, 10) : 10
	if (!Number.isFinite(limit) || limit < 1 || limit > 10000) {
		fatal('--limit must be between 1 and 10000')
	}

	const includeTags = args.includes('--include-tags')
	const include = extractFlag(args, '--include')

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const listArgs: Parameters<typeof ctx.wallet.listOutputs>[0] = {
			basket,
			limit,
			includeTags,
			include,
		}
		if (tags.length > 0) {
			listArgs.tags = tags
		}

		const result = await ctx.wallet.listOutputs(listArgs)

		if (opts.json) {
			output(result, opts)
		} else {
			console.log(
				`\n${result.totalOutputs} total outputs in basket '${basket}':\n`,
			)
			for (const out of result.outputs) {
				const tags = out.tags?.join(', ') || 'none'
				console.log(`  ${out.outpoint} | ${out.satoshis} sats | tags: ${tags}`)
			}
			console.log()
		}
	} finally {
		await destroy()
	}
}

async function walletRelinquishOutput(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const basket = extractFlag(args, '--basket')
	const outpoint = extractFlag(args, '--output')

	if (!basket) fatal('Missing required --basket <name>')
	if (!outpoint) fatal('Missing required --output <txid.vout>')

	// Validate output format (txid.vout)
	if (!outpoint.includes('.') || outpoint.split('.').length !== 2) {
		fatal('Invalid --output format. Expected: txid.vout (e.g., abc123...0)')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await ctx.wallet.relinquishOutput({
			basket,
			output: outpoint,
		})

		if (opts.json) {
			output(result, opts)
		} else {
			output({ relinquished: true, basket, output: outpoint }, opts)
		}
	} finally {
		await destroy()
	}
}

async function walletListActions(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const labels = extractFlags(args, '--labels')
	const limitStr = extractFlag(args, '--limit')
	const limit = limitStr ? Number.parseInt(limitStr, 10) : 10
	if (!Number.isFinite(limit) || limit < 1 || limit > 10000) {
		fatal('--limit must be between 1 and 10000')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const listArgs: Parameters<typeof ctx.wallet.listActions>[0] = {
			labels: labels.length > 0 ? labels : [],
			limit,
		}

		const result = await ctx.wallet.listActions(listArgs)

		if (opts.json) {
			output(result, opts)
		} else {
			console.log(`\n${result.totalActions} total actions:\n`)
			for (const action of result.actions) {
				console.log(`  ${action.txid || 'pending'} | status: ${action.status}`)
			}
			console.log()
		}
	} finally {
		await destroy()
	}
}

async function walletCreateAction(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const jsonInput = args[0]

	if (!jsonInput)
		fatal("Missing JSON arguments. Usage: wallet create-action '{...}'")

	let actionArgs: Parameters<typeof ctx.wallet.createAction>[0]
	try {
		actionArgs = JSON.parse(jsonInput)
	} catch {
		fatal(`Invalid JSON: ${jsonInput}`)
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await ctx.wallet.createAction(actionArgs)
		output(result, opts)
	} finally {
		await destroy()
	}
}

async function walletSignAction(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const jsonInput = args[0]

	if (!jsonInput)
		fatal("Missing JSON arguments. Usage: wallet sign-action '{...}'")

	let signArgs: Parameters<typeof ctx.wallet.signAction>[0]
	try {
		signArgs = JSON.parse(jsonInput)
	} catch {
		fatal(`Invalid JSON: ${jsonInput}`)
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await ctx.wallet.signAction(signArgs)
		output(result, opts)
	} finally {
		await destroy()
	}
}

async function walletAbortAction(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const reference = extractFlag(args, '--reference')

	if (!reference) fatal('Missing required --reference <ref>')

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await ctx.wallet.abortAction({ reference })
		output(result, opts)
	} finally {
		await destroy()
	}
}

async function walletListCertificates(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const certifiers = extractFlags(args, '--certifiers')
	const types = extractFlags(args, '--types')
	const limitStr = extractFlag(args, '--limit')
	const limit = limitStr ? Number.parseInt(limitStr, 10) : 10

	if (!Number.isFinite(limit) || limit < 1 || limit > 10000) {
		fatal('--limit must be between 1 and 10000')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const listArgs: Parameters<typeof ctx.wallet.listCertificates>[0] = {
			certifiers: certifiers.length > 0 ? certifiers : [],
			types: types.length > 0 ? types : [],
			limit,
		}

		const result = await ctx.wallet.listCertificates(listArgs)

		if (opts.json) {
			output(result, opts)
		} else {
			console.log(`\n${result.totalCertificates} total certificates:\n`)
			for (const cert of result.certificates) {
				console.log(`  ${cert.type} | ${cert.serialNumber} | ${cert.certifier}`)
			}
			console.log()
		}
	} finally {
		await destroy()
	}
}

async function walletRelinquishCertificate(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const type = extractFlag(args, '--type')
	const serialNumber = extractFlag(args, '--serialNumber')
	const certifier = extractFlag(args, '--certifier')

	if (!type) fatal('Missing required --type <type>')
	if (!serialNumber) fatal('Missing required --serialNumber <serial>')
	if (!certifier) fatal('Missing required --certifier <certifier>')

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await ctx.wallet.relinquishCertificate({
			type,
			serialNumber,
			certifier,
		})

		if (opts.json) {
			output(result, opts)
		} else {
			output({ relinquished: true, type, serialNumber, certifier }, opts)
		}
	} finally {
		await destroy()
	}
}
