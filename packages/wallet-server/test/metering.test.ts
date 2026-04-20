import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type Knex, knex as makeKnex } from 'knex'
import { measureUsedBytes } from '../src/accounts/metering'

async function makeDb(): Promise<Knex> {
	const db = makeKnex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	})
	await db.schema.createTable('transactions', (t) => {
		t.increments('transactionId')
		t.integer('userId').notNullable()
		t.binary('rawTx')
		t.binary('inputBEEF')
	})
	await db.schema.createTable('outputs', (t) => {
		t.increments('outputId')
		t.integer('userId').notNullable()
		t.integer('transactionId').notNullable()
		t.integer('vout').notNullable()
		t.bigInteger('scriptLength')
		t.binary('lockingScript')
	})
	return db
}

describe('measureUsedBytes', () => {
	let db: Knex
	beforeEach(async () => {
		db = await makeDb()
	})
	afterEach(async () => {
		await db.destroy()
	})

	test('returns 0 for a user with no data', async () => {
		const bytes = await measureUsedBytes(db, 1)
		expect(bytes).toBe(0)
	})

	test('sums rawTx + inputBEEF bytes for matching userId', async () => {
		await db('transactions').insert([
			{ userId: 1, rawTx: Buffer.alloc(100), inputBEEF: Buffer.alloc(50) },
			{ userId: 1, rawTx: Buffer.alloc(200), inputBEEF: null },
			{ userId: 2, rawTx: Buffer.alloc(999), inputBEEF: Buffer.alloc(999) },
		])
		const bytes = await measureUsedBytes(db, 1)
		expect(bytes).toBe(100 + 50 + 200)
	})

	test('prefers scriptLength over LENGTH(lockingScript)', async () => {
		await db('outputs').insert([
			{
				userId: 1,
				transactionId: 1,
				vout: 0,
				scriptLength: 1024,
				lockingScript: null,
			},
			{
				userId: 1,
				transactionId: 2,
				vout: 0,
				scriptLength: null,
				lockingScript: Buffer.alloc(256),
			},
		])
		const bytes = await measureUsedBytes(db, 1)
		expect(bytes).toBe(1024 + 256)
	})

	test('combines tx + output bytes', async () => {
		await db('transactions').insert({
			userId: 7,
			rawTx: Buffer.alloc(500),
			inputBEEF: Buffer.alloc(100),
		})
		await db('outputs').insert({
			userId: 7,
			transactionId: 1,
			vout: 0,
			scriptLength: 300,
			lockingScript: null,
		})
		const bytes = await measureUsedBytes(db, 7)
		expect(bytes).toBe(500 + 100 + 300)
	})
})
