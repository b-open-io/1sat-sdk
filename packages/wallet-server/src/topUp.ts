/**
 * Top-up helper: buys capacity on a remote wallet-server by POSTing to
 * `{remoteUrl}/account/payment`. The endpoint issues a BRC-41 402 with
 * price + derivation prefix; `AuthFetch` on the client side sees the 402
 * and automatically attaches a BRC-29 payment (built from the caller's
 * wallet) and retries. The server verifies, internalizes with the
 * accounts-ledger labels, and returns 200 with the post-payment account
 * status.
 *
 * Shared by the CLI `1sat remote topup` command. Also useful as a direct
 * test harness for the payment endpoint independently of the sync path.
 */

import type { WalletInterface } from '@bsv/sdk'
import { AuthFetch } from '@bsv/sdk/auth'
import type { AccountStatusResponse } from './accounts/types'

export interface TopUpResult {
	/** Sats paid — reported by the server's `x-bsv-payment-satoshis-paid` header. */
	satsPaid: number
	/** Post-payment account status. */
	status: AccountStatusResponse
}

export async function topUpStorage(
	wallet: WalletInterface,
	remoteUrl: string,
): Promise<TopUpResult> {
	const authFetch = new AuthFetch(wallet)
	const paymentUrl = joinUrl(remoteUrl, 'account/payment')
	const response = await authFetch.fetch(paymentUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({}),
	})

	const bodyText = await response.text()
	let body: AccountStatusResponse | { code?: string; description?: string }
	try {
		body = JSON.parse(bodyText)
	} catch {
		throw new Error(
			`payment endpoint returned ${response.status} with non-JSON body: ${bodyText.slice(0, 200)}`,
		)
	}

	if (!response.ok) {
		const errBody = body as { code?: string; description?: string }
		throw new Error(
			`payment endpoint returned ${response.status}: ${errBody.code ?? errBody.description ?? bodyText.slice(0, 200)}`,
		)
	}

	const satsPaidHeader = response.headers.get('x-bsv-payment-satoshis-paid')
	const satsPaid = satsPaidHeader ? Number(satsPaidHeader) : 0

	return {
		satsPaid,
		status: body as AccountStatusResponse,
	}
}

function joinUrl(base: string, path: string): string {
	const b = base.endsWith('/') ? base.slice(0, -1) : base
	const p = path.startsWith('/') ? path.slice(1) : path
	return `${b}/${p}`
}
