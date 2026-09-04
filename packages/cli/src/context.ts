/**
 * OneSatContext factory for CLI commands.
 *
 * Creates a fully initialized wallet context with services. Monitor work is
 * not run in-process (avoids toolbox/console noise on the TTY). After the
 * wallet is destroyed, a detached `__monitor-once` child may run against the
 * same storage with logs in <dataDir>/monitor.log.
 */

import { type OneSatContext, createContext } from '@1sat/actions'
import { type NodeWalletResult, createNodeWallet } from '@1sat/wallet-node'
import type { PrivateKey } from '@bsv/sdk'
import { ensureDataDir, loadConfig } from './config.js'
import { spawnDetachedMonitorOnce } from './monitor-once.js'

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
 * - No in-process monitor.runOnce(); a background once-run is scheduled on
 *   destroy when local storage is active and no other monitor owner is live.
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
		storage: {
			provider: 'bun-sqlite',
			filename: `${dataDir}/wallet-${opts.chain}.db`,
		},
		activeRemote: config.activeRemote,
		backups: config.backups,
		// Monitor runs in a detached child after destroy, or in `1sat serve`.
		skipInitialMonitor: true,
	})

	const ctx = createContext(walletResult.wallet, {
		services: walletResult.services,
		chain: opts.chain,
		dataDir,
		// Real base wallet — action runs apply before createAction.
		isBaseWallet: true,
	})

	return {
		ctx,
		walletResult,
		destroy: async () => {
			await walletResult.destroy()
			spawnDetachedMonitorOnce({
				dataDir,
				chain: opts.chain,
				privateKeyWif: privateKey.toWif(),
				activeRemote: config.activeRemote,
			})
		},
	}
}
