/**
 * PaymailResolver backends. The OpNS resolver (resolvePaymailBind, used as
 * the default in routes) resolves on-chain PushDrop binds; the registry
 * resolver maps a domain's aliases through the registered-users table.
 * Both end at an identity key.
 */

import type { PaymailResolver, ResolvedBind, UserStore } from './types'

export function createRegistryResolver(store: UserStore): PaymailResolver {
	return {
		async resolve(alias: string): Promise<ResolvedBind | null> {
			const user = await store.get(alias)
			if (!user) return null
			return {
				identityKey: user.identityKey,
				outpoint: '',
				profileName: user.username,
			}
		},
	}
}
