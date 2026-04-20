import type { Knex } from 'knex'
import { ACCOUNTS_TABLE, PAYMENTS_TABLE } from './migrations'
import type { Account, IdentityKey, NewPayment, Payment } from './types'

interface AccountRow {
	identity_key: string
	created_at: Date | string
	updated_at: Date | string
}

interface PaymentRow {
	id: number
	identity_key: string
	txid: string
	bytes_covered: number | string
	sats_paid: number | string
	paid_through_block: number
	applied_at: Date | string
}

export class AccountsRepo {
	constructor(private readonly knex: Knex) {}

	async upsertAccount(identityKey: IdentityKey): Promise<Account> {
		const now = new Date()
		await this.knex(ACCOUNTS_TABLE)
			.insert({
				identity_key: identityKey,
				created_at: now,
				updated_at: now,
			})
			.onConflict('identity_key')
			.ignore()

		const row = await this.knex<AccountRow>(ACCOUNTS_TABLE)
			.where({ identity_key: identityKey })
			.first()
		if (!row)
			throw new Error(`upsertAccount: no row after insert for ${identityKey}`)
		return toAccount(row)
	}

	async getAccount(identityKey: IdentityKey): Promise<Account | undefined> {
		const row = await this.knex<AccountRow>(ACCOUNTS_TABLE)
			.where({ identity_key: identityKey })
			.first()
		return row ? toAccount(row) : undefined
	}

	/**
	 * Sum bytes_covered for all unexpired payments belonging to identityKey.
	 * A payment is unexpired when paid_through_block >= currentBlock.
	 */
	async sumUnexpiredBytes(
		identityKey: IdentityKey,
		currentBlock: number,
	): Promise<number> {
		const [row] = await this.knex<PaymentRow>(PAYMENTS_TABLE)
			.where({ identity_key: identityKey })
			.andWhere('paid_through_block', '>=', currentBlock)
			.sum<{ total: string | number | null }>({ total: 'bytes_covered' })
		const total = row?.total
		if (total == null) return 0
		return typeof total === 'string'
			? Number.parseInt(total, 10)
			: Number(total)
	}

	async recordPayment(input: NewPayment): Promise<Payment> {
		const [row] = await this.knex<PaymentRow>(PAYMENTS_TABLE)
			.insert({
				identity_key: input.identityKey,
				txid: input.txid,
				bytes_covered: input.bytesCovered,
				sats_paid: input.satsPaid,
				paid_through_block: input.paidThroughBlock,
				applied_at: new Date(),
			})
			.returning('*')
		return toPayment(row)
	}

	async paymentExists(txid: string): Promise<boolean> {
		const row = await this.knex<PaymentRow>(PAYMENTS_TABLE)
			.where({ txid })
			.first('id')
		return !!row
	}

	async listPayments(identityKey: IdentityKey, limit = 50): Promise<Payment[]> {
		const rows = await this.knex<PaymentRow>(PAYMENTS_TABLE)
			.where({ identity_key: identityKey })
			.orderBy('applied_at', 'desc')
			.limit(limit)
		return rows.map(toPayment)
	}
}

function toAccount(row: AccountRow): Account {
	return {
		identityKey: row.identity_key,
		createdAt: toDate(row.created_at),
		updatedAt: toDate(row.updated_at),
	}
}

function toPayment(row: PaymentRow): Payment {
	return {
		id: row.id,
		identityKey: row.identity_key,
		txid: row.txid,
		bytesCovered: Number(row.bytes_covered),
		satsPaid: Number(row.sats_paid),
		paidThroughBlock: row.paid_through_block,
		appliedAt: toDate(row.applied_at),
	}
}

function toDate(v: Date | string): Date {
	return v instanceof Date ? v : new Date(v)
}
