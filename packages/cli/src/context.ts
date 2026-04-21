/**
 * OneSatContext factory for CLI commands.
 *
 * Creates a fully initialized wallet context with services and monitor.
 */

import { type OneSatContext, createContext } from '@1sat/actions'
import { type NodeWalletResult, createNodeWallet } from '@1sat/wallet-node'
import type { PrivateKey } from '@bsv/sdk'
import { ensureDataDir, loadConfig } from './config'
import { readLiveMonitorPid } from './monitor-lock'

/** Extended context that includes cleanup */
export interface CliContext {
	ctx: OneSatContext
	walletResult: NodeWalletResult
	destroy: () => Promise<void>
}

/**
 * Create a fully initialized OneSatContext for CLI use.
 *
 * Sets up:
 * - Node wallet with SQLite storage
 * - 1Sat services for API access
 * - Monitor for transaction lifecycle. When local storage is the active
 *   store, the wallet factory fires `monitor.runOnce()` internally on
 *   creation; individual tasks self-throttle via their own intervals, so
 *   repeated CLI invocations are cheap.
 */
export async function loadContext(
	privateKey: PrivateKey,
	opts: { chain: 'main' | 'test' },
): Promise<CliContext> {
	const config = loadConfig()
	const dataDir = ensureDataDir()

	const storageIdentityKey = config.storageIdentityKey ?? '1sat-cli-default'

	const skipInitialMonitor = readLiveMonitorPid(dataDir) !== undefined

	const walletResult = await createNodeWallet({
		privateKey,
		chain: opts.chain,
		storageIdentityKey,
		storage: {
			provider: 'bun-sqlite',
			filename: `${dataDir}/wallet-${opts.chain}.db`,
		},
		activeRemote: config.activeRemote,
		backups: config.backups,
		skipInitialMonitor,
	})

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
