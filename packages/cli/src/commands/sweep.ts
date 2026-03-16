/**
 * Sweep commands - scan, import.
 *
 * Sweep assets from external wallets into the BRC-100 wallet.
 */

import {
	prepareSweepInputs,
	scanAddressUtxos,
	sweepBsv,
	sweepBsv21,
	sweepOrdinals,
} from '@1sat/actions'
import { PrivateKey } from '@bsv/sdk'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey, resolvePassword } from '../keys'
import { fatal, formatLabel, formatValue, output } from '../output'

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
			printCommandHelp('sweep', {
				scan: 'Scan an address for UTXOs (--wif <key>)',
				import: 'Import UTXOs into wallet (--wif <key>)',
			})
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

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		if (!ctx.services) {
			fatal('Services required for sweep scan')
		}

		const result = await scanAddressUtxos(ctx.services, address)

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
					`    ${formatValue(f.outpoint)}  ${formatLabel(`${f.satoshis} sats`)}`,
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
					`    ${formatValue(t.symbol ?? t.tokenId.slice(0, 12))}  ${formatLabel('amount:')} ${formatValue(t.totalAmount)}  ${formatLabel('UTXOs:')} ${t.inputs.length}  ${formatLabel('dec:')} ${t.decimals}`,
				)
			}
		}

		const total =
			result.funding.length +
			result.ordinals.length +
			result.bsv21Tokens.reduce((n, t) => n + t.inputs.length, 0)
		console.log(`\n  ${total} total UTXO(s) found.`)
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

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		if (!ctx.services) {
			fatal('Services required for sweep import')
		}

		// Scan first to discover what's available
		const scan = await scanAddressUtxos(ctx.services, address)

		const hasFunding = scan.funding.length > 0
		const hasOrdinals = scan.ordinals.length > 0
		const hasTokens = scan.bsv21Tokens.length > 0

		if (!hasFunding && !hasOrdinals && !hasTokens) {
			fatal(`No UTXOs found at ${address}`)
		}

		// Summarize what will be swept
		const parts: string[] = []
		if (hasFunding)
			parts.push(`${scan.totalFundingSats} sats (${scan.funding.length} UTXOs)`)
		if (hasOrdinals) parts.push(`${scan.ordinals.length} ordinal(s)`)
		if (hasTokens) {
			for (const t of scan.bsv21Tokens) {
				parts.push(
					`${t.totalAmount} ${t.symbol ?? t.tokenId.slice(0, 12)} token(s)`,
				)
			}
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

		// Convert SweepInput to IndexedOutput shape for prepareSweepInputs
		const toIndexed = (items: Array<{ outpoint: string; satoshis: number }>) =>
			items.map((item) => ({
				outpoint: item.outpoint,
				satoshis: item.satoshis,
				score: 0,
			}))

		// Sweep BSV funding UTXOs
		if (hasFunding) {
			const inputs = await prepareSweepInputs(ctx, toIndexed(scan.funding))

			const result = await sweepBsv.execute(ctx, { inputs, wif })
			if (result.error) {
				fatal(`BSV sweep failed: ${result.error}`)
			}
			if (result.txid) txids.push(result.txid)
		}

		// Sweep ordinals
		if (hasOrdinals) {
			const inputs = await prepareSweepInputs(ctx, toIndexed(scan.ordinals))

			const result = await sweepOrdinals.execute(ctx, { inputs, wif })
			if (result.error) {
				fatal(`Ordinals sweep failed: ${result.error}`)
			}
			if (result.txid) txids.push(result.txid)
		}

		// Sweep BSV-21 tokens (one sweep per tokenId)
		if (hasTokens) {
			for (const tokenGroup of scan.bsv21Tokens) {
				const inputs = await prepareSweepInputs(
					ctx,
					toIndexed(tokenGroup.inputs),
				)

				const sweepInputs = inputs.map((inp, idx) => ({
					...inp,
					tokenId: tokenGroup.inputs[idx].tokenId,
					amount: tokenGroup.inputs[idx].amount,
				}))

				const result = await sweepBsv21.execute(ctx, {
					inputs: sweepInputs,
					wif,
				})
				if (result.error) {
					fatal(
						`Token sweep failed (${tokenGroup.symbol ?? tokenGroup.tokenId.slice(0, 12)}): ${result.error}`,
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
