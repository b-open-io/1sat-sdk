/**
 * HTTP client for talking to a wallet-server over BRC-100 mutual auth.
 *
 * Mirrors the `@1sat/client` service-client pattern — extends `BaseClient`
 * and injects an `AuthFetch`-backed fetch so the same `request` plumbing
 * works against authenticated endpoints.
 */

import { BaseClient } from '@1sat/client'
import type { WalletInterface } from '@bsv/sdk'
import { AuthFetch } from '@bsv/sdk/auth'
import type { AccountStatusResponse } from './accounts/types.js'

export interface WalletServerClientOptions {
	timeout?: number
	fetch?: typeof fetch
}

export class WalletServerClient extends BaseClient {
	constructor(
		baseUrl: string,
		wallet: WalletInterface,
		options: WalletServerClientOptions = {},
	) {
		const authFetch = new AuthFetch(wallet)
		super(baseUrl, {
			timeout: options.timeout,
			fetch: options.fetch ?? buildAuthFetchShim(authFetch),
		})
	}

	/** GET /account/status — per-identity usage + capacity + pricing snapshot. */
	accountStatus(): Promise<AccountStatusResponse> {
		return this.request<AccountStatusResponse>('/account/status')
	}
}

function buildAuthFetchShim(authFetch: AuthFetch): typeof fetch {
	const shim = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.toString()
					: input.url
		return authFetch.fetch(url, init as Parameters<AuthFetch['fetch']>[1])
	}
	return shim as unknown as typeof fetch
}
