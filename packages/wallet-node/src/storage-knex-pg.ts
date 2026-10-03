import { StorageKnex, type StorageProviderOptions } from '@bsv/wallet-toolbox'
import knex from 'knex'

export interface StorageKnexPgOptions extends StorageProviderOptions {
	/** Postgres connection URL — e.g. `postgres://user:pass@host/db`. */
	dbUrl: string
	/** Optional pool size override. */
	pool?: { min?: number; max?: number }
}

/**
 * Toolbox `StorageKnex` on a Postgres knex, plus the usage measurement
 * `@1sat/wallet-server` account routes need.
 */
export class StorageKnexPg extends StorageKnex {
	constructor(options: StorageKnexPgOptions) {
		const { dbUrl, pool, ...providerOptions } = options
		super({
			...providerOptions,
			knex: knex({
				client: 'pg',
				connection: { connectionString: dbUrl },
				pool,
			}),
		})
	}

	/**
	 * Stored bytes for one user, for wallet-server accounts metering. Same
	 * accounting as `StorageBunSqlite.measureUsedBytes`: shared proven_txs and
	 * proven_tx_reqs rows count for every user whose transactions reference them.
	 */
	async measureUsedBytes(userId: number): Promise<number> {
		const result = await this.knex.raw<{ rows: { total: string | number }[] }>(
			`SELECT
				(SELECT COALESCE(SUM(COALESCE(OCTET_LENGTH("rawTx"), 0) + COALESCE(OCTET_LENGTH("inputBEEF"), 0)), 0)
				 FROM transactions WHERE "userId" = :userId)
				+ (SELECT COALESCE(SUM(COALESCE(OCTET_LENGTH(pt."rawTx"), 0) + COALESCE(OCTET_LENGTH(pt."merklePath"), 0)), 0)
				 FROM proven_txs pt
				 INNER JOIN transactions t ON t."provenTxId" = pt."provenTxId"
				 WHERE t."userId" = :userId)
				+ (SELECT COALESCE(SUM(COALESCE(OCTET_LENGTH(ptr."rawTx"), 0) + COALESCE(OCTET_LENGTH(ptr."inputBEEF"), 0)), 0)
				 FROM proven_tx_reqs ptr
				 INNER JOIN transactions t ON t.txid = ptr.txid
				 WHERE t."userId" = :userId)
				+ (SELECT COALESCE(SUM(COALESCE("scriptLength", OCTET_LENGTH("lockingScript"), 0)), 0)
				 FROM outputs WHERE "userId" = :userId)
				AS total`,
			{ userId },
		)
		return Number(result.rows[0]?.total ?? 0)
	}
}
