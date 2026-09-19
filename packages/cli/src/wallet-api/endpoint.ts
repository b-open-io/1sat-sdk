/**
 * The app-facing BRC-100 endpoint `1sat serve wallet-api` runs.
 *
 * The served wallet is a `LocalWalletPermissionsManager` around the CLI's
 * toolbox wallet: each app origin gets only what the user has granted it,
 * grants live in a file store, and a missing grant is put to the terminal
 * as a y/N question. The manager's admin originator is reserved for the
 * process itself; the router rejects it on the wire.
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
import { FilePermissionStore } from './permission-store.js'
import {
	NOT_INTERACTIVE_MESSAGE,
	type PermissionPromptOptions,
	type PermissionPrompts,
	bindPermissionPrompts,
} from './prompts.js'

export interface WalletApiOptions {
	/** The underlying (admin-surface) wallet; never served directly. */
	wallet: WalletInterface
	/** Path of the JSON grant store (see `permissionStorePath`). */
	storePath: string
	host: string
	port: number
	/** Prompt wiring; defaults to the process TTY. */
	prompts?: PermissionPromptOptions
	/** Extra permissions-manager configuration (tests disable manifest lookups). */
	managerConfig?: PermissionsManagerConfig
	/** Request log sink. Defaults to `console.log`. */
	log?: (line: string) => void
}

export interface WalletApiHandle {
	server: BRC100ServerHandle
	prompts: PermissionPrompts
	close(): Promise<void>
}

/**
 * Expose a `WalletInterface` as a BRC100WalletHandle. The wallet handed in
 * is the permissions manager, so every call is checked against the
 * originator's grants before it reaches the toolbox wallet. When no
 * terminal is attached the manager's denial is reworded so the app learns
 * why nothing can be approved.
 */
export function walletApiHandle(
	wallet: WalletInterface,
	prompts: PermissionPrompts,
): BRC100WalletHandle {
	return {
		async call(method, args, origin) {
			const fn = (wallet as unknown as Record<string, unknown>)[method] as (
				a: unknown,
				o: string,
			) => Promise<unknown>
			if (typeof fn !== 'function') {
				throw new Error(`Method not available: ${method}`)
			}
			try {
				return await fn.call(wallet, args, origin)
			} catch (err) {
				const code = (err as { code?: unknown })?.code
				if (code === 'ERR_PERMISSION_DENIED' && !prompts.interactive) {
					const denied = new Error(
						`Permission denied. ${NOT_INTERACTIVE_MESSAGE}`,
					) as Error & { code?: string }
					denied.code = 'ERR_PERMISSION_DENIED'
					throw denied
				}
				throw err
			}
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
		{
			// The CLI's own commands read this storage through the raw wallet;
			// encrypted descriptions would show up as ciphertext there.
			encryptWalletMetadata: false,
			...options.managerConfig,
		},
		{ store: new FilePermissionStore(options.storePath) },
	)
	const prompts = bindPermissionPrompts(manager, {
		log,
		...options.prompts,
	})

	const server = await startBRC100Server({
		host: options.host,
		port: options.port,
		adminOriginator: CLI_ADMIN_ORIGINATOR,
		wallet: walletApiHandle(manager, prompts),
		onEvent: (event) => {
			if (event.event !== 'brc100_call') return
			const line = `[wallet-api] ${event.method} from ${event.origin || '(no origin)'} -> ${event.status}`
			log(event.error ? `${line}: ${event.error}` : line)
		},
	})

	return {
		server,
		prompts,
		close: () => server.close(),
	}
}
