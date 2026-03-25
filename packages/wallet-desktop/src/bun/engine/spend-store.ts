/**
 * Outpoint format: 64-char hex txid + "_" or "." + vout index
 * e.g. "abcdef...1234_0" or "abcdef...1234.0"
 */

import { TxoClient } from '@1sat/client'

export class SpendStore {
	private remote: TxoClient | undefined

	configureRemote(baseUrl: string | undefined) {
		this.remote = baseUrl ? new TxoClient(baseUrl) : undefined
	}

	/** Local TXO store lookup — stubbed until TXO indexing is implemented */
	getSpendLocal(_outpoint: string): string | undefined {
		return undefined
	}

	async getSpend(outpoint: string): Promise<string | undefined> {
		const local = this.getSpendLocal(outpoint)
		if (local) return local

		if (!this.remote) return undefined

		try {
			return (await this.remote.getSpend(outpoint)) ?? undefined
		} catch {
			return undefined
		}
	}
}
