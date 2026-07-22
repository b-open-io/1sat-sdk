/**
 * Host subscription check — wallet-local receipts in HOSTING_BASKET.
 * Identity is only in tags (not on-chain script).
 */

import {
	HOSTING_BASKET,
	hostingPayerTag,
	readHostingExp,
} from '@1sat/types'
import type { WalletInterface } from '@bsv/sdk'

export interface EntitlementStatus {
	active: boolean
	expiresAt?: number
}

/**
 * True if host wallet has an unspent receipt for identity with exp > now.
 * Uses max exp if multiple receipts exist.
 */
export async function checkHostingEntitlement(
	wallet: WalletInterface,
	identityKeyHex: string,
	nowUnix = Math.floor(Date.now() / 1000),
): Promise<EntitlementStatus> {
	const { outputs } = await wallet.listOutputs({
		basket: HOSTING_BASKET,
		tags: [hostingPayerTag(identityKeyHex)],
		tagQueryMode: 'all',
		includeTags: true,
		limit: 100,
	})

	// Correct subscribe path leaves a single receipt; if more exist, use latest exp.
	let maxExp = 0
	for (const o of outputs) {
		const exp = readHostingExp(o.tags)
		if (exp !== undefined && exp > maxExp) maxExp = exp
	}

	if (maxExp > nowUnix) {
		return { active: true, expiresAt: maxExp }
	}
	return { active: false, expiresAt: maxExp > 0 ? maxExp : undefined }
}
