/**
 * OneSatContext factory for CLI commands.
 *
 * Creates a fully initialized wallet context with services and monitor.
 */

import { type OneSatContext, createContext } from '@1sat/actions'
import { type NodeWalletResult, createNodeWallet } from '@1sat/wallet-node'
import type { PrivateKey } from '@bsv/sdk'
import { ensureDataDir, loadConfig } from './config'

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
 * - Monitor for transaction lifecycle
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
			client: 'better-sqlite3',
			connection: {
				filename: `${dataDir}/wallet-${opts.chain}.db`,
			},
			useNullAsDefault: true,
		},
		activeRemote: config.activeRemote,
	})

	walletResult.monitor?.startTasks()

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
