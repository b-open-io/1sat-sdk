/**
 * OneSatContext factory for CLI commands.
 *
 * Creates a fully initialized wallet context with services and monitor.
 */

import { type OneSatContext, createContext } from '@1sat/actions'
import { type NodeWalletResult, createNodeWallet } from '@1sat/wallet-node'
import type { PrivateKey } from '@bsv/sdk'
import {
	ensureDataDir,
	loadConfig,
	loadMonitorState,
	saveMonitorState,
} from './config'

/** Extended context that includes cleanup */
export interface CliContext {
	ctx: OneSatContext
	walletResult: NodeWalletResult
	destroy: () => Promise<void>
}

/**
 * Run the monitor once if the interval has elapsed.
 * This is called lazily by commands that need current state.
 */
async function runMonitorIfStale(
	walletResult: NodeWalletResult,
	intervalMinutes: number,
): Promise<void> {
	if (!walletResult.monitor) return // remote active, monitor runs remotely
	if (intervalMinutes === 0) return // disabled by user

	const state = loadMonitorState()
	const now = Date.now()
	const elapsed = now - state.lastMonitorRun
	const intervalMs = intervalMinutes * 60 * 1000

	if (elapsed >= intervalMs) {
		const originalLog = console.log
		const originalInfo = console.info
		const originalWarn = console.warn
		console.log = () => {}
		console.info = () => {}
		console.warn = () => {}

		try {
			await walletResult.monitor.runOnce()
		} finally {
			console.log = originalLog
			console.info = originalInfo
			console.warn = originalWarn
		}
		saveMonitorState({ lastMonitorRun: Date.now() })
	}
}

/**
 * Create a fully initialized OneSatContext for CLI use.
 *
 * Sets up:
 * - Node wallet with SQLite storage
 * - 1Sat services for API access
 * - Monitor for transaction lifecycle (lazy, interval-based)
 */
export async function loadContext(
	privateKey: PrivateKey,
	opts: { chain: 'main' | 'test' },
): Promise<CliContext> {
	const config = loadConfig()
	const dataDir = ensureDataDir()

	const storageIdentityKey = config.storageIdentityKey ?? '1sat-cli-default'

	const walletResult = await createNodeWallet({
		privateKey,
		chain: opts.chain,
		storageIdentityKey,
		filename: `${dataDir}/wallet-${opts.chain}.db`,
		activeRemote: config.activeRemote,
		backups: config.backups,
	})

	// Run monitor once if interval has elapsed (lazy refresh)
	await runMonitorIfStale(walletResult, config.monitorIntervalMinutes)

	const ctx = createContext(walletResult.wallet, {
		services: walletResult.services,
		chain: opts.chain,
		dataDir,
	})

	return {
		ctx,
		walletResult,
		destroy: walletResult.destroy,
	}
}
