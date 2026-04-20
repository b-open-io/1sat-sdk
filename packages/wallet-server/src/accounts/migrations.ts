import type { Knex } from 'knex'

/**
 * Knex migrations for the accounts layer.
 *
 * Tables are prefixed `wsa_` (wallet-server-accounts) to avoid colliding with
 * wallet-toolbox's own tables (`transactions`, `outputs`, etc.) that live in
 * the same database.
 */

export const ACCOUNTS_TABLE = 'wsa_accounts'
export const PAYMENTS_TABLE = 'wsa_payments'

export async function up(knex: Knex): Promise<void> {
	const hasAccounts = await knex.schema.hasTable(ACCOUNTS_TABLE)
	if (!hasAccounts) {
		await knex.schema.createTable(ACCOUNTS_TABLE, (t) => {
			t.string('identity_key', 66).primary()
			t.timestamp('created_at').notNullable().defaultTo(knex.fn.now())
			t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now())
		})
	}

	const hasPayments = await knex.schema.hasTable(PAYMENTS_TABLE)
	if (!hasPayments) {
		await knex.schema.createTable(PAYMENTS_TABLE, (t) => {
			t.increments('id').primary()
			t.string('identity_key', 66).notNullable()
			t.string('txid', 64).notNullable().unique()
			t.bigInteger('bytes_covered').notNullable()
			t.bigInteger('sats_paid').notNullable()
			t.integer('paid_through_block').notNullable()
			t.timestamp('applied_at').notNullable().defaultTo(knex.fn.now())

			t.index('identity_key')
			t.index('paid_through_block')
			t.foreign('identity_key').references(`${ACCOUNTS_TABLE}.identity_key`)
		})
	}
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTableIfExists(PAYMENTS_TABLE)
	await knex.schema.dropTableIfExists(ACCOUNTS_TABLE)
}

/**
 * Runs migrations against the given knex instance. Idempotent — safe to call on
 * every server start.
 */
export async function runMigrations(knex: Knex): Promise<void> {
	await up(knex)
}
