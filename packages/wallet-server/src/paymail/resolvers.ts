/**
 * PaymailResolver backends. The OpNS resolver (resolvePaymailBind, used as
 * the default in routes) resolves on-chain PushDrop binds; the account
 * resolver maps the host's user domain through the accounts table. Both
 * end at an identity key.
 */

import type { AccountStore } from '../accounts/store.js'
import type { PaymailResolver, ResolvedBind } from './types.js'

export function createAccountResolver(store: AccountStore): PaymailResolver {
	return {
		async resolve(alias: string): Promise<ResolvedBind | null> {
			const account = await store.getByUsername(alias)
			if (!account) return null
			return {
				identityKey: account.identityKey,
				outpoint: '',
				profileName: account.displayName ?? account.username,
				...(account.avatarOrigin && { avatarOrigin: account.avatarOrigin }),
			}
		},
	}
}
