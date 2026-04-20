import type { Knex } from 'knex'

/**
 * Measures the stored-byte footprint of a single wallet-toolbox user.
 *
 * Sums the sizes of data that represent persisted wallet state:
 *   - `transactions.rawTx`
 *   - `transactions.inputBEEF`
 *   - `outputs.lockingScript` (or `outputs.scriptLength` when the blob was pushed to rawTx)
 *
 * These are the fields that actually consume storage per user and that the
 * dispatcher's billable methods grow (`createAction`, `processAction`,
 * `internalizeAction`, `processSyncChunk`, `insertCertificateAuth`).
 */
export async function measureUsedBytes(
	knex: Knex,
	userId: number,
): Promise<number> {
	const [txRow] = await knex('transactions')
		.where({ userId })
		.select(
			knex.raw(
				'COALESCE(SUM(COALESCE(LENGTH(rawTx), 0) + COALESCE(LENGTH(inputBEEF), 0)), 0) as total',
			),
		)

	const [outRow] = await knex('outputs')
		.where({ userId })
		.select(
			knex.raw(
				'COALESCE(SUM(COALESCE(scriptLength, LENGTH(lockingScript), 0)), 0) as total',
			),
		)

	return asNumber(txRow?.total) + asNumber(outRow?.total)
}

function asNumber(v: unknown): number {
	if (v == null) return 0
	if (typeof v === 'number') return v
	if (typeof v === 'bigint') return Number(v)
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}
