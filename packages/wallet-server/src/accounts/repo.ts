import type { Database as BunDatabase } from 'bun:sqlite'
import { ACCOUNTS_TABLE, PAYMENTS_TABLE } from './migrations'
import type { Account, IdentityKey, NewPayment, Payment } from './types'

/**
 * Driver-agnostic interface for the accounts ledger. Implementations run
 * against the wallet's own connection (bun:sqlite Database for local
 * wallets; future Postgres impl for production deployments).
 */
export interface AccountsRepo {
	upsertAccount(identityKey: IdentityKey): Promise<Account>
	getAccount(identityKey: IdentityKey): Promise<Account | undefined>
	/**
	 * Returns the caller's currently-active payment row — the most recent row
	 * whose `paid_through_block` has not yet passed. Under the refund-credit
	 * pricing model a new payment fully supersedes any prior payment, so a
	 * single row answers "what capacity is paid for right now?".
	 */
	getCurrentPayment(
		identityKey: IdentityKey,
		currentBlock: number,
	): Promise<Payment | undefined>
	recordPayment(input: NewPayment): Promise<Payment>
	paymentExists(txid: string): Promise<boolean>
	listPayments(identityKey: IdentityKey, limit?: number): Promise<Payment[]>
	/**
	 * Sum of stored bytes attributable to a single wallet-toolbox user. Runs
	 * against the same connection the wallet uses.
	 *
	 * Per-user tables (transactions, outputs) are summed directly. Shared
	 * rows (proven_txs, proven_tx_reqs) are attributed to every user that
	 * references them via `transactions.provenTxId`. In multi-tenant
	 * deployments this over-counts aggregate disk usage but reflects each
	 * user's standalone storage cost fairly.
	 */
	measureUsedBytes(userId: number): Promise<number>
}

interface AccountRow {
	identity_key: string
	created_at: string
	updated_at: string
}

interface PaymentRow {
	id: number
	identity_key: string
	txid: string
	bytes_covered: number | bigint
	sats_paid: number | bigint
	paid_through_block: number
	applied_at: string
}

// ---------------------------------------------------------------------------
// bun:sqlite implementation
// ---------------------------------------------------------------------------

export class BunSqliteAccountsRepo implements AccountsRepo {
	constructor(private readonly db: BunDatabase) {}

	async upsertAccount(identityKey: IdentityKey): Promise<Account> {
		this.db.run(
			`INSERT INTO ${ACCOUNTS_TABLE} (identity_key) VALUES (?) ON CONFLICT(identity_key) DO NOTHING`,
			[identityKey],
		)
		const row = this.db
			.query(`SELECT * FROM ${ACCOUNTS_TABLE} WHERE identity_key = ?`)
			.get(identityKey) as AccountRow | undefined
		if (!row) throw new Error(`upsertAccount: no row for ${identityKey}`)
		return toAccount(row)
	}

	async getAccount(identityKey: IdentityKey): Promise<Account | undefined> {
		const row = this.db
			.query(`SELECT * FROM ${ACCOUNTS_TABLE} WHERE identity_key = ?`)
			.get(identityKey) as AccountRow | undefined
		return row ? toAccount(row) : undefined
	}

	async getCurrentPayment(
		identityKey: IdentityKey,
		currentBlock: number,
	): Promise<Payment | undefined> {
		const row = this.db
			.query(
				`SELECT * FROM ${PAYMENTS_TABLE}
				 WHERE identity_key = ? AND paid_through_block >= ?
				 ORDER BY applied_at DESC
				 LIMIT 1`,
			)
			.get(identityKey, currentBlock) as PaymentRow | undefined
		return row ? toPayment(row) : undefined
	}

	async recordPayment(input: NewPayment): Promise<Payment> {
		const result = this.db.run(
			`INSERT INTO ${PAYMENTS_TABLE}
				(identity_key, txid, bytes_covered, sats_paid, paid_through_block)
			 VALUES (?, ?, ?, ?, ?)`,
			[
				input.identityKey,
				input.txid,
				input.bytesCovered,
				input.satsPaid,
				input.paidThroughBlock,
			],
		)
		const id = Number(result.lastInsertRowid)
		const row = this.db
			.query(`SELECT * FROM ${PAYMENTS_TABLE} WHERE id = ?`)
			.get(id) as PaymentRow | undefined
		if (!row) throw new Error(`recordPayment: no row for id ${id}`)
		return toPayment(row)
	}

	async paymentExists(txid: string): Promise<boolean> {
		const row = this.db
			.query(`SELECT 1 FROM ${PAYMENTS_TABLE} WHERE txid = ? LIMIT 1`)
			.get(txid)
		return !!row
	}

	async listPayments(
		identityKey: IdentityKey,
		limit = 50,
	): Promise<Payment[]> {
		const rows = this.db
			.query(
				`SELECT * FROM ${PAYMENTS_TABLE}
				 WHERE identity_key = ?
				 ORDER BY applied_at DESC
				 LIMIT ?`,
			)
			.all(identityKey, limit) as PaymentRow[]
		return rows.map(toPayment)
	}

	async measureUsedBytes(userId: number): Promise<number> {
		const tx = this.db
			.query(
				`SELECT COALESCE(SUM(COALESCE(LENGTH(rawTx), 0) + COALESCE(LENGTH(inputBEEF), 0)), 0) AS total
				 FROM transactions WHERE userId = ?`,
			)
			.get(userId) as { total: number | bigint } | undefined
		const proven = this.db
			.query(
				`SELECT COALESCE(SUM(COALESCE(LENGTH(pt.rawTx), 0) + COALESCE(LENGTH(pt.merklePath), 0)), 0) AS total
				 FROM proven_txs pt
				 INNER JOIN transactions t ON t.provenTxId = pt.provenTxId
				 WHERE t.userId = ?`,
			)
			.get(userId) as { total: number | bigint } | undefined
		// Join on txid — proven_tx_reqs.provenTxId is null until mining, so
		// a provenTxId join would miss pending requests where the raw bytes
		// (inputBEEF especially) actually live.
		const reqs = this.db
			.query(
				`SELECT COALESCE(SUM(COALESCE(LENGTH(ptr.rawTx), 0) + COALESCE(LENGTH(ptr.inputBEEF), 0)), 0) AS total
				 FROM proven_tx_reqs ptr
				 INNER JOIN transactions t ON t.txid = ptr.txid
				 WHERE t.userId = ?`,
			)
			.get(userId) as { total: number | bigint } | undefined
		const out = this.db
			.query(
				`SELECT COALESCE(SUM(COALESCE(scriptLength, LENGTH(lockingScript), 0)), 0) AS total
				 FROM outputs WHERE userId = ?`,
			)
			.get(userId) as { total: number | bigint } | undefined
		return (
			asNumber(tx?.total) +
			asNumber(proven?.total) +
			asNumber(reqs?.total) +
			asNumber(out?.total)
		)
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toAccount(row: AccountRow): Account {
	return {
		identityKey: row.identity_key,
		createdAt: new Date(row.created_at),
		updatedAt: new Date(row.updated_at),
	}
}

function toPayment(row: PaymentRow): Payment {
	return {
		id: row.id,
		identityKey: row.identity_key,
		txid: row.txid,
		bytesCovered: asNumber(row.bytes_covered),
		satsPaid: asNumber(row.sats_paid),
		paidThroughBlock: row.paid_through_block,
		appliedAt: new Date(row.applied_at),
	}
}

function asNumber(v: unknown): number {
	if (v == null) return 0
	if (typeof v === 'number') return v
	if (typeof v === 'bigint') return Number(v)
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}
