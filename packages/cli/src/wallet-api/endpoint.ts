/**
 * The app-facing BRC-100 endpoint `1sat serve wallet-api` runs.
 *
 * The served wallet is a `LocalWalletPermissionsManager` around the CLI's
 * toolbox wallet: each app origin gets only what has been granted to it in
 * the file store, and anything else is denied immediately — there is no
 * prompt and no auto-approve. The denial names the `1sat permissions grant
 * …` command that would allow the call, so the agent driving the app can
 * read the fix out of the app's own error output. The manager's admin
 * originator is reserved for the process itself; the router rejects it on
 * the wire.
 */

import { LocalWalletPermissionsManager } from '@1sat/wallet'
import {
	type BRC100ServerHandle,
	type BRC100WalletHandle,
	startBRC100Server,
} from '@1sat/wallet-server'
import type { WalletInterface } from '@bsv/sdk'
import type { PermissionsManagerConfig } from '@bsv/wallet-toolbox'
import { CLI_ADMIN_ORIGINATOR } from './admin.js'
import { bindPermissionDenials, withDenialMessage } from './deny.js'
import { FilePermissionStore } from './permission-store.js'

export interface WalletApiOptions {
	/** The underlying (admin-surface) wallet; never served directly. */
	wallet: WalletInterface
	/** Path of the JSON grant store (see `permissionStorePath`). */
	storePath: string
	host: string
	port: number
	/**
	 * Command a denial tells the caller to run, minus origin and selectors.
	 * Defaults to `1sat permissions grant`; `serve` adds `--chain test`
	 * where it matters.
	 */
	grantCommandPrefix?: string
	/** Extra permissions-manager configuration (tests disable manifest lookups). */
	managerConfig?: PermissionsManagerConfig
	/** Request log sink. Defaults to `console.log`. */
	log?: (line: string) => void
}

export interface WalletApiHandle {
	server: BRC100ServerHandle
	close(): Promise<void>
}

/**
 * Expose a `WalletInterface` as a BRC100WalletHandle. The wallet handed in
 * is the permissions manager, so every call is checked against the
 * originator's grants before it reaches the toolbox wallet. A refusal
 * leaves the manager as `Permission denied.`; `withDenialMessage` replaces
 * it with the grant command recorded while the call was in flight.
 */
export function walletApiHandle(wallet: WalletInterface): BRC100WalletHandle {
	return {
		async call(method, args, origin) {
			const fn = (wallet as unknown as Record<string, unknown>)[method] as (
				a: unknown,
				o: string,
			) => Promise<unknown>
			if (typeof fn !== 'function') {
				throw new Error(`Method not available: ${method}`)
			}
			return withDenialMessage(() => fn.call(wallet, args, origin))
		},
	}
}

/** Wrap the wallet in a permissions manager and serve it over HTTP. */
export async function startWalletApi(
	options: WalletApiOptions,
): Promise<WalletApiHandle> {
	const log = options.log ?? ((line: string) => console.log(line))
	const manager = new LocalWalletPermissionsManager(
		options.wallet,
		CLI_ADMIN_ORIGINATOR,
		// Metadata encryption stays at the toolbox default (on): descriptions
		// an app writes through this endpoint are encrypted at rest. The CLI's
		// own commands read through a manager too (see `adminWallet`), which
		// decrypts them again.
		{ ...options.managerConfig },
		{ store: new FilePermissionStore(options.storePath) },
	)
	bindPermissionDenials(manager, {
		grantCommandPrefix: options.grantCommandPrefix,
		log,
	})

	const server = await startBRC100Server({
		host: options.host,
		port: options.port,
		adminOriginator: CLI_ADMIN_ORIGINATOR,
		wallet: walletApiHandle(manager),
		onEvent: (event) => {
			if (event.event !== 'brc100_call') return
			const line = `[wallet-api] ${event.method} from ${event.origin || '(no origin)'} -> ${event.status}`
			log(event.error ? `${line}: ${event.error}` : line)
		},
	})

	return {
		server,
		close: () => server.close(),
	}
}
