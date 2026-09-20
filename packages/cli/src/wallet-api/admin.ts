/**
 * The CLI acting as the wallet itself.
 *
 * `LocalWalletPermissionsManager` lets its admin originator bypass every
 * permission check, so `CLI_ADMIN_ORIGINATOR` must only ever be used by
 * in-process code. The wallet-api router rejects any HTTP request whose
 * origin normalizes to it, so an app cannot claim it. It is a
 * hostname-shaped string that is stable under the manager's originator
 * normalization (lowercase, no scheme, no port).
 *
 * The CLI's own commands go through a manager too, rather than the raw
 * toolbox wallet. That is what keeps their output readable now that apps
 * on `1sat serve wallet-api` write encrypted transaction metadata: the
 * manager decrypts descriptions and custom instructions on the way back
 * (`decryptListActionsMetadata` / `maybeDecryptMetadata`, which return
 * values that were never encrypted unchanged), while the admin originator
 * skips every grant check.
 */

import {
	type IPermissionStore,
	LocalWalletPermissionsManager,
} from '@1sat/wallet'
import type { WalletInterface } from '@bsv/sdk'

export const CLI_ADMIN_ORIGINATOR = '1sat-cli.internal'

/**
 * Wrap the toolbox wallet in a permissions manager the CLI calls as the
 * admin originator.
 *
 * Every method is invoked with `CLI_ADMIN_ORIGINATOR` as the originator —
 * the manager requires one for its checks and would otherwise throw
 * "Originator is required for permission checks" on calls the CLI's own
 * actions make without one.
 *
 * Writes stay in plaintext (`encryptWalletMetadata: false`). The CLI is
 * not the only reader of this storage — `1sat serve wallet` hands the same
 * records to remote clients — so the CLI does not start encrypting what it
 * writes. Decryption is not gated on that flag, so app-written metadata
 * still comes back readable.
 */
export function adminWallet(
	wallet: WalletInterface,
	store: IPermissionStore,
): WalletInterface {
	const manager = new LocalWalletPermissionsManager(
		wallet,
		CLI_ADMIN_ORIGINATOR,
		{ encryptWalletMetadata: false },
		{ store },
	)
	return withAdminOriginator(manager)
}

/**
 * A `WalletInterface` view of `manager` that passes the admin originator on
 * every call. BRC-100 methods all take `(args, originator?)`, so one proxy
 * covers the surface without a per-method wrapper that would go stale as
 * the interface grows.
 */
export function withAdminOriginator(manager: WalletInterface): WalletInterface {
	return new Proxy(manager, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver)
			if (typeof value !== 'function') return value
			return (args: unknown) =>
				(value as (a: unknown, o: string) => unknown).call(
					target,
					args,
					CLI_ADMIN_ORIGINATOR,
				)
		},
	})
}
