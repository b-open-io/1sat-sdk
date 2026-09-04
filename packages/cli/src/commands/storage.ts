/**
 * Storage maintenance commands — operate directly on the serve wallet's
 * storage database (config under server.storage in config.json).
 */

import { join } from 'node:path'
import { StorageBunSqlite, nominateInvalidReqs } from '@1sat/wallet-node'
import { StorageProvider } from '@bsv/wallet-toolbox'
import type { GlobalFlags } from '../args.js'
import { extractFlag } from '../args.js'
import { ensureDataDir, loadConfig } from '../config.js'
import { printCommandHelp } from '../help.js'
import { fatal, output } from '../output.js'

export async function handleStorageCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'unfail':
			return storageUnfail(rest, opts)
		default:
			printCommandHelp('storage', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

/**
 * Nominate invalid proven_tx_reqs for recovery. Writes only the `unfail`
 * status; the running monitor's TaskUnFail verifies each txid against
 * the chain, restores the ones that actually mined, and returns the rest
 * to `invalid`. Safe to run against a live serve instance — same
 * single-field status update the monitor's own review tasks perform.
 */
async function storageUnfail(args: string[], opts: GlobalFlags): Promise<void> {
	const rawWindow = extractFlag(args, '--window')
	if (!rawWindow) {
		fatal(
			"--window is required: 'all' for every invalid record (one-time cleanup), or a duration like 30d / 12h / 90m",
		)
	}
	const windowMsecs = parseWindow(rawWindow)

	const storage = await openServeStorage(opts)
	try {
		const { nominated } = await nominateInvalidReqs(storage, windowMsecs)

		if (opts.json) {
			output({ nominated }, opts)
			return
		}

		if (nominated.length === 0) {
			console.log('No invalid reqs in window — nothing nominated.')
			return
		}
		console.log(
			`Nominated ${nominated.length} invalid req(s) for unfail review:`,
		)
		for (const n of nominated) {
			console.log(`  ${n.provenTxReqId}  ${n.txid}`)
		}
		console.log(
			'The running monitor (1sat serve / serve monitor) processes these on its next TaskUnFail tick: mined transactions are restored, the rest return to invalid.',
		)
	} finally {
		await storage.destroy()
	}
}

function parseWindow(raw: string): number | undefined {
	if (raw === 'all') return undefined
	const m = raw.match(/^(\d+)([dhm])$/)
	if (!m) {
		fatal(
			`--window must be 'all' or a duration like 30d, 12h, 90m — got: ${raw}`,
		)
	}
	const units: Record<string, number> = {
		d: 24 * 60 * 60 * 1000,
		h: 60 * 60 * 1000,
		m: 60 * 1000,
	}
	return Number(m[1]) * units[m[2]]
}

/** Open the serve wallet's storage exactly as `1sat serve` resolves it. */
async function openServeStorage(opts: GlobalFlags): Promise<StorageProvider> {
	const config = loadConfig()
	const chain = opts.chain ?? config.chain ?? 'main'
	const storageConfig = config.server?.storage ?? { provider: 'bun-sqlite' }
	const baseOptions = StorageProvider.createStorageBaseOptions(chain)

	let storage: StorageProvider
	if (storageConfig.provider === 'pg') {
		if (!storageConfig.dbUrl) {
			fatal(
				'server.storage.provider is pg but server.storage.dbUrl is not set.',
			)
		}
		const { StoragePg } = await import('@1sat/wallet-node')
		storage = new StoragePg({ ...baseOptions, dbUrl: storageConfig.dbUrl })
	} else {
		storage = new StorageBunSqlite({
			...baseOptions,
			filename: join(ensureDataDir(), `wallet-${chain}.db`),
		})
	}

	await storage.makeAvailable()
	return storage
}
