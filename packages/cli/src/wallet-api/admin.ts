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
 * toolbox wallet. That is what keeps their output readable now that
 * transaction metadata is encrypted at rest: the manager decrypts
 * descriptions and custom instructions on the way back
 * (`decryptListActionsMetadata` / `maybeDecryptMetadata`, which return
 * values that were never encrypted unchanged), while the admin originator
 * skips every grant check.
 */

import { PERMISSION_SCHEME_IDS } from '@1sat/types'
import {
	type IPermissionStore,
	LocalWalletPermissionsManager,
} from '@1sat/wallet'
import type { WalletInterface } from '@bsv/sdk'

export const CLI_ADMIN_ORIGINATOR = '1sat-cli.internal'

/**
 * Pass-through permission modules for every scheme the actions package can
 * label with.
 *
 * `buildInputAssetLabel` puts `p <scheme> input id <id>` on any action that
 * spends a basket asset, unconditionally — there is no opt-out on the action.
 * The manager routes a `p ` label to `config.permissionModules[scheme]` and
 * throws `Unsupported P-module scheme` when none is registered, so the CLI's
 * own commands would fail on a label they have always emitted.
 *
 * A real module exists to describe an intent and apply it once a person
 * approves. The admin originator bypasses every check and has no prompt
 * surface, so there is nothing for it to do: passing the request and response
 * through unchanged is what the raw toolbox wallet did before the CLI gained
 * a manager.
 */
const adminPermissionModules = Object.fromEntries(
	PERMISSION_SCHEME_IDS.map((scheme) => [
		scheme,
		{
			onRequest: async (req: { args: object }) => ({ args: req.args }),
			onResponse: async (res: unknown) => res,
		},
	]),
)

/**
 * Wrap the toolbox wallet in a permissions manager the CLI calls as the
 * admin originator.
 *
 * Every method is invoked with `CLI_ADMIN_ORIGINATOR` as the originator —
 * the manager requires one for its checks and would otherwise throw
 * "Originator is required for permission checks" on calls the CLI's own
 * actions make without one.
 *
 * Metadata encryption is left at the toolbox default (on), the same as
 * the served endpoint: the CLI writes encrypted descriptions and custom
 * instructions and reads them back decrypted. Nothing downstream loses by
 * that. `1sat serve wallet` is the wallet-toolbox *storage* interface, not
 * a BRC-100 API — it moves opaque records and never interprets a
 * description — and the wallet at the far end (wallet-desktop, the
 * browser wallet, a remote CLI) runs its own permissions manager, which
 * decrypts. Records written before this change stay readable: decryption
 * is attempted unconditionally and `maybeDecryptMetadata` returns the
 * original string when it fails.
 */
export function adminWallet(
	wallet: WalletInterface,
	store: IPermissionStore,
): WalletInterface {
	const manager = new LocalWalletPermissionsManager(
		wallet,
		CLI_ADMIN_ORIGINATOR,
		{ permissionModules: adminPermissionModules },
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
