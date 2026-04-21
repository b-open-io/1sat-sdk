/**
 * StoragePg — production Postgres backend for `@1sat/wallet-node` wallets.
 *
 * Thin subclass of wallet-toolbox's `StorageKnex` (which already handles the
 * full schema, migrations, and every `WalletStorageProvider` method over
 * knex/pg). The only addition is `measureUsedBytes(userId)`, the accounts
 * metering helper that the `@1sat/wallet-server` gate middleware casts for
 * via `StorageWithFinders`.
 *
 * Shape matches `StorageBunSqlite.measureUsedBytes` — summing bytes across
 * `transactions`, `proven_txs`, `proven_tx_reqs`, and `outputs` for a single
 * userId. Pg's `OCTET_LENGTH(bytea)` replaces sqlite's `LENGTH(blob)`.
 */

import {
	StorageKnex,
	type StorageKnexOptions,
} from '@bsv/wallet-toolbox/out/src/storage/StorageKnex.js'

export interface StoragePgOptions extends StorageKnexOptions {}

export class StoragePg extends StorageKnex {
	constructor(options: StoragePgOptions) {
		super(options)
	}

	/**
	 * Sum of stored bytes attributable to a single wallet-toolbox user.
	 * Per-user tables (transactions, outputs) are summed directly. Shared
	 * rows (proven_txs, proven_tx_reqs) are attributed to every user that
	 * references them via `transactions.provenTxId` or `transactions.txid`.
	 */
	async measureUsedBytes(userId: number): Promise<number> {
		const k = this.toDb(undefined)

		const [tx] = await k('transactions')
			.where({ userId })
			.select(
				k.raw(
					'COALESCE(SUM(COALESCE(OCTET_LENGTH("rawTx"), 0) + COALESCE(OCTET_LENGTH("inputBEEF"), 0)), 0) AS total',
				),
			)

		const [proven] = await k('proven_txs AS pt')
			.innerJoin('transactions AS t', 't.provenTxId', 'pt.provenTxId')
			.where('t.userId', userId)
			.select(
				k.raw(
					'COALESCE(SUM(COALESCE(OCTET_LENGTH(pt."rawTx"), 0) + COALESCE(OCTET_LENGTH(pt."merklePath"), 0)), 0) AS total',
				),
			)

		const [reqs] = await k('proven_tx_reqs AS ptr')
			.innerJoin('transactions AS t', 't.txid', 'ptr.txid')
			.where('t.userId', userId)
			.select(
				k.raw(
					'COALESCE(SUM(COALESCE(OCTET_LENGTH(ptr."rawTx"), 0) + COALESCE(OCTET_LENGTH(ptr."inputBEEF"), 0)), 0) AS total',
				),
			)

		const [out] = await k('outputs')
			.where({ userId })
			.select(
				k.raw(
					'COALESCE(SUM(COALESCE("scriptLength", OCTET_LENGTH("lockingScript"), 0)), 0) AS total',
				),
			)

		return (
			toNum(tx?.total) +
			toNum(proven?.total) +
			toNum(reqs?.total) +
			toNum(out?.total)
		)
	}
}

function toNum(v: unknown): number {
	if (v == null) return 0
	if (typeof v === 'number') return v
	if (typeof v === 'bigint') return Number(v)
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}
