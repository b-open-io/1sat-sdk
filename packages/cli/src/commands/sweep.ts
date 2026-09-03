/**
 * Sweep commands - scan, import.
 *
 * Sweep assets from external wallets into the BRC-100 wallet.
 */

import {
	prepareSweepInputs,
	scanAddress,
	sweepBsv,
	sweepBsv21,
	sweepOrdinals,
} from '@1sat/actions'
import { PrivateKey } from '@bsv/sdk'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args.js'
import { extractFlag } from '../args.js'
import { loadContext } from '../context.js'
import { printCommandHelp } from '../help.js'
import { loadKey } from '../keys.js'
import { fatal, formatLabel, formatValue, output } from '../output.js'

export async function handleSweepCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'scan':
			return sweepScan(rest, opts)
		case 'import':
			return sweepImport(rest, opts)
		default:
			printCommandHelp('sweep', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function sweepScan(args: string[], opts: GlobalFlags): Promise<void> {
	const wif = extractFlag(args, '--wif')

	if (!wif) fatal('Missing --wif <private-key>')

	let address: string
	try {
		const pk = PrivateKey.fromWif(wif)
		address = pk.toPublicKey().toAddress()
	} catch {
		fatal('Invalid WIF private key')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		if (!ctx.services) {
			fatal('Services required for sweep scan')
		}

		const result = await scanAddress(ctx.services, address)

		if (opts.json) {
			output(result, opts)
			return
		}

		console.log(`\n  Scan results for ${formatValue(address)}:\n`)

		console.log(`  ${formatLabel('Funding UTXOs:')} ${result.funding.length}`)
		if (result.funding.length > 0) {
			console.log(
				`  ${formatLabel('Total funding:')} ${formatValue(result.totalFundingSats)} satoshis`,
			)
			for (const f of result.funding) {
				console.log(
					`    ${formatValue(f.outpoint)}  ${formatLabel(`${f.satoshis ?? 0} sats`)}`,
				)
			}
		}

		console.log(
			`\n  ${formatLabel('Ordinal UTXOs:')} ${result.ordinals.length}`,
		)
		if (result.ordinals.length > 0) {
			for (const o of result.ordinals) {
				console.log(`    ${formatValue(o.outpoint)}`)
			}
		}

		console.log(
			`\n  ${formatLabel('BSV-21 Tokens:')} ${result.bsv21Tokens.length}`,
		)
		if (result.bsv21Tokens.length > 0) {
			for (const t of result.bsv21Tokens) {
				console.log(
					`    ${formatValue(t.symbol ?? t.tokenId.slice(0, 12))}  ${formatLabel('amount:')} ${formatValue(t.totalAmount.toString())}  ${formatLabel('UTXOs:')} ${t.outputs.length}  ${formatLabel('dec:')} ${t.decimals}`,
				)
			}
		}

		console.log(`\n  ${formatLabel('RUN Tokens:')} ${result.run.length}`)
		if (result.run.length > 0) {
			const runSats = result.run.reduce((sum, r) => sum + (r.satoshis ?? 0), 0)
			console.log(
				`  ${formatLabel('Total locked:')} ${formatValue(runSats)} satoshis (not sweepable)`,
			)
			for (const r of result.run) {
				console.log(
					`    ${formatValue(r.outpoint)}  ${formatLabel(`${r.satoshis ?? 0} sats`)}`,
				)
			}
		}

		const total =
			result.funding.length +
			result.ordinals.length +
			result.bsv21Tokens.reduce((n, t) => n + t.outputs.length, 0)
		console.log(`\n  ${total} sweepable UTXO(s) found.`)
		if (result.run.length > 0) {
			console.log(`  ${result.run.length} RUN token output(s) excluded.`)
		}
	} finally {
		await destroy()
	}
}

async function sweepImport(args: string[], opts: GlobalFlags): Promise<void> {
	const wif = extractFlag(args, '--wif')

	if (!wif) fatal('Missing --wif <private-key>')

	let address: string
	try {
		const pk = PrivateKey.fromWif(wif)
		address = pk.toPublicKey().toAddress()
	} catch {
		fatal('Invalid WIF private key')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		if (!ctx.services) {
			fatal('Services required for sweep import')
		}

		const scan = await scanAddress(ctx.services, address)

		const hasFunding = scan.funding.length > 0
		const hasOrdinals = scan.ordinals.length > 0
		const hasTokens = scan.bsv21Tokens.some(
			(t) => t.isActive && t.outputs.length > 0,
		)

		if (!hasFunding && !hasOrdinals && !hasTokens) {
			if (scan.run.length > 0) {
				fatal(
					`No sweepable UTXOs found at ${address} (${scan.run.length} RUN token output(s) excluded)`,
				)
			}
			fatal(`No UTXOs found at ${address}`)
		}

		const parts: string[] = []
		if (hasFunding)
			parts.push(`${scan.totalFundingSats} sats (${scan.funding.length} UTXOs)`)
		if (hasOrdinals) parts.push(`${scan.ordinals.length} ordinal(s)`)
		if (hasTokens) {
			for (const t of scan.bsv21Tokens) {
				if (t.isActive && t.outputs.length > 0) {
					parts.push(
						`${t.totalAmount} ${t.symbol ?? t.tokenId.slice(0, 12)} token(s)`,
					)
				}
			}
		}
		if (scan.run.length > 0) {
			parts.push(`${scan.run.length} RUN token output(s) excluded`)
		}

		if (!opts.yes) {
			const ok = await confirm({
				message: `Sweep ${parts.join(', ')} from ${address}?`,
			})
			if (isCancel(ok) || !ok) {
				fatal('Sweep cancelled.')
			}
		}

		const txids: string[] = []

		// Sweep BSV funding UTXOs
		if (hasFunding) {
			const inputs = await prepareSweepInputs(ctx, scan.funding)
			const result = await sweepBsv.execute(ctx, { inputs, wif })
			if (result.error) {
				fatal(`BSV sweep failed: ${result.error}`)
			}
			if (result.txid) txids.push(result.txid)
		}

		// Sweep ordinals
		if (hasOrdinals) {
			const inputs = await prepareSweepInputs(ctx, scan.ordinals)
			const result = await sweepOrdinals.execute(ctx, { inputs, wif })
			if (result.error) {
				fatal(`Ordinals sweep failed: ${result.error}`)
			}
			if (result.txid) txids.push(result.txid)
		}

		// Sweep BSV-21 tokens (one sweep per active tokenId)
		if (hasTokens) {
			for (const token of scan.bsv21Tokens) {
				if (!token.isActive || token.outputs.length === 0) continue

				const inputs = token.outputs.map((out) => ({
					outpoint: out.outpoint,
					tokenId: token.tokenId,
					amount: token.amounts.get(out.outpoint) ?? '0',
				}))

				const result = await sweepBsv21.execute(ctx, { inputs, wif })
				if (result.error) {
					fatal(
						`Token sweep failed (${token.symbol ?? token.tokenId.slice(0, 12)}): ${result.error}`,
					)
				}
				if (result.txid) txids.push(result.txid)
			}
		}

		output(
			opts.json
				? { txids, swept: parts }
				: `Sweep complete. ${txids.length} transaction(s): ${txids.join(', ')}`,
			opts,
		)
	} finally {
		await destroy()
	}
}
