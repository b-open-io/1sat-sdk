/**
 * Sweep commands - scan, import.
 *
 * Sweep assets from external wallets into the BRC-100 wallet.
 */

import {
	SWEEP_BATCH_SIZE,
	bsv21SweepBatches,
	groupBsv20Tokens,
	prepareSweepInputs,
	scanAddress,
	sweepBsv,
	sweepBsv20,
	sweepBsv21,
	sweepOrdinals,
} from '@1sat/actions'
import { PrivateKey } from '@bsv/sdk'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args.js'
import { extractFlag, hasFlag } from '../args.js'
import { loadContext } from '../context.js'
import { printCommandHelp } from '../help.js'
import { loadKey } from '../keys.js'
import {
	fatal,
	formatLabel,
	formatValue,
	formatWarning,
	output,
} from '../output.js'
import { type SweepClass, selectedSweepClasses } from './sweep-classes.js'
import {
	type SweepPlan,
	buildSweepPlan,
	describePlan,
	planHasWork,
} from './sweep-plan.js'

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

function loadSweepKey(args: string[]): { wif: string; address: string } {
	const wif = extractFlag(args, '--wif')
	if (!wif) fatal('Missing --wif <private-key>')
	try {
		const pk = PrivateKey.fromWif(wif)
		return { wif, address: pk.toPublicKey().toAddress() }
	} catch {
		fatal('Invalid WIF private key')
	}
}

function loadClasses(args: string[]): Set<SweepClass> {
	try {
		return selectedSweepClasses(
			extractFlag(args, '--only'),
			extractFlag(args, '--skip'),
		)
	} catch (error) {
		fatal(error instanceof Error ? error.message : String(error))
	}
}

function leftoverLines(plan: SweepPlan): string[] {
	const lines: string[] = []
	if (plan.leftover.locked)
		lines.push(`${plan.leftover.locked} locked output(s) (not swept)`)
	if (plan.leftover.run)
		lines.push(`${plan.leftover.run} RUN token output(s) (not sweepable)`)
	if (plan.leftover.inactiveBsv21)
		lines.push(
			`${plan.leftover.inactiveBsv21} BSV-21 UTXO(s) with no parseable amount`,
		)
	if (plan.leftover.unparsedBsv20)
		lines.push(
			`${plan.leftover.unparsedBsv20} BSV-20 UTXO(s) with no parseable tick/amt`,
		)
	return lines
}

function printInventory(
	address: string,
	plan: SweepPlan,
	opts: GlobalFlags,
	mode: 'scan' | 'dry-run',
): void {
	if (opts.json) {
		output(
			{
				address,
				mode,
				classes: plan.classes,
				wouldSweep: {
					bsv: plan.bsv,
					ordinals: plan.ordinals,
					opns: plan.opns,
					bsv20: plan.bsv20,
					bsv21: plan.bsv21,
				},
				leftover: plan.leftover,
			},
			opts,
		)
		return
	}

	const title = mode === 'dry-run' ? 'Dry run' : 'Scan'
	console.log(`\n  ${title} for ${formatValue(address)}\n`)
	console.log(
		`  ${formatLabel('Classes:')} ${formatValue(plan.classes.join(', ') || '(none)')}`,
	)

	console.log(`\n  ${formatLabel('Funding UTXOs:')} ${plan.bsv.count}`)
	if (plan.bsv.count > 0) {
		console.log(
			`  ${formatLabel('Total funding:')} ${formatValue(plan.bsv.sats)} satoshis`,
		)
	}

	console.log(`\n  ${formatLabel('Ordinal UTXOs:')} ${plan.ordinals.count}`)
	if (plan.ordinals.listed)
		console.log(`  ${formatLabel('Listed:')} ${plan.ordinals.listed}`)

	console.log(`\n  ${formatLabel('OpNS names:')} ${plan.opns.count}`)
	if (plan.opns.listed)
		console.log(`  ${formatLabel('Listed:')} ${plan.opns.listed}`)

	console.log(`\n  ${formatLabel('BSV-20:')} ${plan.bsv20.length} ticker(s)`)
	for (const t of plan.bsv20) {
		const listed = t.listed ? `  ${formatLabel(`listed ${t.listed}`)}` : ''
		console.log(
			`    ${formatValue(t.tick)}  ${formatLabel('amount:')} ${formatValue(t.amount)}  ${formatLabel('UTXOs:')} ${t.count}${listed}`,
		)
	}

	console.log(`\n  ${formatLabel('BSV-21:')} ${plan.bsv21.length} token(s)`)
	for (const t of plan.bsv21) {
		const listed = t.listed ? `  ${formatLabel(`listed ${t.listed}`)}` : ''
		console.log(
			`    ${formatValue(t.symbol ?? t.tokenId.slice(0, 12))}  ${formatLabel('amount:')} ${formatValue(t.amount)}  ${formatLabel('UTXOs:')} ${t.count}${listed}`,
		)
	}

	const leftover = leftoverLines(plan)
	if (leftover.length) {
		console.log(`\n  ${formatLabel('Leftover:')}`)
		for (const line of leftover) console.log(`    ${formatWarning(line)}`)
	}

	const transferable =
		plan.bsv.count +
		plan.ordinals.count +
		plan.opns.count +
		plan.bsv20.reduce((n, t) => n + t.count, 0) +
		plan.bsv21.reduce((n, t) => n + t.count, 0)
	console.log(`\n  ${transferable} transferable UTXO(s) in selected classes.`)
}

async function sweepScan(args: string[], opts: GlobalFlags): Promise<void> {
	const { address } = loadSweepKey(args)
	const classes = loadClasses(args)

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		if (!ctx.services) fatal('Services required for sweep scan')
		const scan = await scanAddress(ctx.services, address)
		printInventory(address, buildSweepPlan(scan, classes), opts, 'scan')
	} finally {
		await destroy()
	}
}

async function sweepImport(args: string[], opts: GlobalFlags): Promise<void> {
	const { wif, address } = loadSweepKey(args)
	const classes = loadClasses(args)
	const dryRun = hasFlag(args, '--dry-run')
	const sweepKey = PrivateKey.fromWif(wif)

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})
	let failed = false

	try {
		if (!ctx.services) fatal('Services required for sweep import')

		const scan = await scanAddress(ctx.services, address)
		const plan = buildSweepPlan(scan, classes)

		if (dryRun) {
			printInventory(address, plan, opts, 'dry-run')
			return
		}

		if (!planHasWork(plan)) {
			const leftover = leftoverLines(plan)
			const extra = leftover.length ? ` (${leftover.join('; ')})` : ''
			fatal(`No transferable UTXOs found at ${address}${extra}`)
		}

		const parts = describePlan(plan)
		for (const line of leftoverLines(plan)) parts.push(line)

		if (!opts.yes) {
			const ok = await confirm({
				message: `Sweep ${parts.join(', ')} from ${address}?`,
			})
			if (isCancel(ok) || !ok) fatal('Sweep cancelled.')
		}

		const txids: string[] = []
		const errors: string[] = []

		const run = async (
			label: string,
			fn: () => Promise<{ txid?: string; error?: string }>,
		): Promise<boolean> => {
			try {
				const result = await fn()
				if (result.error) {
					errors.push(`${label}: ${result.error}`)
					return false
				}
				if (result.txid) txids.push(result.txid)
				return true
			} catch (error) {
				errors.push(
					`${label}: ${error instanceof Error ? error.message : String(error)}`,
				)
				return false
			}
		}

		const keysFor = (inputs: { outpoint: string }[]) =>
			inputs.map(() => sweepKey)

		const runOrdinalBatches = async (
			label: string,
			outputs: typeof scan.ordinals,
		): Promise<void> => {
			for (
				let offset = 0;
				offset < outputs.length;
				offset += SWEEP_BATCH_SIZE
			) {
				const batch = outputs.slice(offset, offset + SWEEP_BATCH_SIZE)
				const ok = await run(
					outputs.length <= SWEEP_BATCH_SIZE
						? label
						: `${label} (${offset + 1}–${offset + batch.length} of ${outputs.length})`,
					async () => {
						const inputs = await prepareSweepInputs(ctx, batch)
						return sweepOrdinals.execute(ctx, {
							inputs,
							keys: keysFor(inputs),
						})
					},
				)
				if (!ok) break
			}
		}

		if (plan.bsv.count) {
			await run('BSV', async () => {
				const inputs = await prepareSweepInputs(ctx, scan.funding)
				return sweepBsv.execute(ctx, {
					inputs,
					keys: keysFor(inputs),
				})
			})
		}

		if (plan.ordinals.count) {
			await runOrdinalBatches('Ordinals', scan.ordinals)
		}

		if (plan.opns.count) {
			await runOrdinalBatches('OpNS', scan.opnsNames)
		}

		if (plan.bsv20.length) {
			const grouped = groupBsv20Tokens(scan.bsv20Tokens)
			for (const token of grouped) {
				await run(`BSV-20 ${token.tick}`, async () => {
					const base = await prepareSweepInputs(ctx, token.outputs)
					const inputs = base.map((b) => ({
						...b,
						tick: token.tick,
						amount: token.amounts.get(b.outpoint) ?? '0',
					}))
					return sweepBsv20.execute(ctx, {
						inputs,
						keys: inputs.map(() => sweepKey),
					})
				})
			}
		}

		if (plan.bsv21.length) {
			for (const token of scan.bsv21Tokens) {
				if (token.outputs.length === 0) continue
				const name = token.symbol ?? token.tokenId.slice(0, 12)
				for (const batch of bsv21SweepBatches(token.outputs)) {
					await run(`BSV-21 ${name}`, async () => {
						const base = await prepareSweepInputs(ctx, batch)
						const inputs = base.map((b) => ({
							...b,
							tokenId: token.tokenId,
							amount: token.amounts.get(b.outpoint) ?? '0',
						}))
						return sweepBsv21.execute(ctx, {
							inputs,
							keys: inputs.map(() => sweepKey),
						})
					})
				}
			}
		}

		if (opts.json) {
			output({ txids, errors, swept: parts }, opts)
		} else if (errors.length) {
			console.log(
				`Sweep finished with errors. ${txids.length} transaction(s): ${txids.join(', ') || '(none)'}`,
			)
			for (const err of errors) console.error(formatWarning(err))
		} else {
			output(
				`Sweep complete. ${txids.length} transaction(s): ${txids.join(', ')}`,
				opts,
			)
		}

		if (errors.length) failed = true
	} finally {
		await destroy()
	}
	if (failed) process.exit(1)
}
