/**
 * Wallet storage server: the `@bsv/wallet-toolbox` `StorageServer`, run
 * standalone. Nothing of ours is in its request path; this only chooses its
 * session store and the options where our clients need more than the
 * upstream defaults.
 */

import {
	type StorageProvider,
	StorageServer,
	type Wallet,
	type WalletStorageServerOptions,
} from '@bsv/wallet-toolbox'
import {
	type SessionStoreConfig,
	createSessionManager,
} from './sessions/redisSessionManager.js'

export interface StorageServerConfig {
	storage: StorageProvider
	/** Server identity: signs BRC-104 responses. */
	wallet: Wallet
	listen: { port: number; host?: string }
	/**
	 * Redis-shared BRC-104 sessions for multi-instance deployments behind a
	 * load balancer. Unset = in-memory sessions (single instance).
	 */
	sessionStore?: SessionStoreConfig
	/**
	 * Express `trust proxy`, which the pre-auth IP rate limit depends on.
	 * Set it behind a reverse proxy (e.g. `"loopback"` for nginx on the same
	 * host); unset, every request counts against the proxy's address.
	 */
	trustProxy?: WalletStorageServerOptions['trustProxy']
}

export function createStorageServer(
	config: StorageServerConfig,
): StorageServer {
	return new StorageServer(config.storage, {
		wallet: config.wallet,
		port: config.listen.port,
		host: config.listen.host,
		monetize: false,
		sessionManager: createSessionManager(config.sessionStore),
		trustProxy: config.trustProxy,
		// BRC-100 allows list limits up to 10,000; the upstream default (1,000)
		// rejects larger ones.
		maxRpcListLimit: 10_000,
		// Clients without binary requests send transactions as number[]; an
		// 8 MiB JSON body holds at most ~4M array items, so no request the body
		// limit admits is rejected for array length (upstream default: 1M).
		maxRpcArrayItems: 4 * 1024 * 1024,
	})
}
