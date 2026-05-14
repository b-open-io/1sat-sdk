import type {
	AccountsConfig,
	AccountsConfigProvider,
} from '@1sat/wallet-server'

export interface AccountsConfigLoaderOptions {
	ttlMs: number
	read: () => AccountsConfig
	/** Override clock (testing). */
	now?: () => number
}

/**
 * Build an `AccountsConfigProvider` that re-reads its source no more often
 * than `ttlMs`. If `read` throws after the first success, the last good
 * value is returned and the failure is silently absorbed.
 */
export function createAccountsConfigLoader(
	options: AccountsConfigLoaderOptions,
): AccountsConfigProvider {
	const now = options.now ?? (() => Date.now())
	let cached: AccountsConfig | undefined
	let cachedAt = 0

	return () => {
		const t = now()
		if (cached && t - cachedAt < options.ttlMs) return cached
		try {
			cached = options.read()
			cachedAt = t
			return cached
		} catch (err) {
			if (cached) return cached
			throw err
		}
	}
}
