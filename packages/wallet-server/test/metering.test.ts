import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BunSqliteAccountsRepo } from '../src/accounts/repo'

function makeDb(): Database {
	const db = new Database(':memory:')
	db.run(`CREATE TABLE transactions (
		transactionId INTEGER PRIMARY KEY AUTOINCREMENT,
		userId INTEGER NOT NULL,
		provenTxId INTEGER,
		rawTx BLOB,
		inputBEEF BLOB
	)`)
	db.run(`CREATE TABLE outputs (
		outputId INTEGER PRIMARY KEY AUTOINCREMENT,
		userId INTEGER NOT NULL,
		transactionId INTEGER NOT NULL,
		vout INTEGER NOT NULL,
		scriptLength INTEGER,
		lockingScript BLOB
	)`)
	db.run(`CREATE TABLE proven_txs (
		provenTxId INTEGER PRIMARY KEY AUTOINCREMENT,
		rawTx BLOB,
		merklePath BLOB
	)`)
	db.run(`CREATE TABLE proven_tx_reqs (
		provenTxReqId INTEGER PRIMARY KEY AUTOINCREMENT,
		provenTxId INTEGER,
		txid TEXT,
		rawTx BLOB,
		inputBEEF BLOB
	)`)
	return db
}

describe('BunSqliteAccountsRepo.measureUsedBytes', () => {
	let db: Database
	let repo: BunSqliteAccountsRepo
	beforeEach(() => {
		db = makeDb()
		repo = new BunSqliteAccountsRepo(db)
	})
	afterEach(() => {
		db.close()
	})

	test('returns 0 for a user with no data', async () => {
		expect(await repo.measureUsedBytes(1)).toBe(0)
	})

	test('sums rawTx + inputBEEF bytes for matching userId', async () => {
		const insertTx = db.prepare(
			'INSERT INTO transactions (userId, rawTx, inputBEEF) VALUES (?, ?, ?)',
		)
		insertTx.run(1, new Uint8Array(100), new Uint8Array(50))
		insertTx.run(1, new Uint8Array(200), null)
		insertTx.run(2, new Uint8Array(999), new Uint8Array(999))
		expect(await repo.measureUsedBytes(1)).toBe(100 + 50 + 200)
	})

	test('prefers scriptLength over LENGTH(lockingScript)', async () => {
		const insertOut = db.prepare(
			'INSERT INTO outputs (userId, transactionId, vout, scriptLength, lockingScript) VALUES (?, ?, ?, ?, ?)',
		)
		insertOut.run(1, 1, 0, 1024, null)
		insertOut.run(1, 2, 0, null, new Uint8Array(256))
		expect(await repo.measureUsedBytes(1)).toBe(1024 + 256)
	})

	test('combines tx + output bytes', async () => {
		db.prepare(
			'INSERT INTO transactions (userId, rawTx, inputBEEF) VALUES (?, ?, ?)',
		).run(7, new Uint8Array(500), new Uint8Array(100))
		db.prepare(
			'INSERT INTO outputs (userId, transactionId, vout, scriptLength, lockingScript) VALUES (?, ?, ?, ?, ?)',
		).run(7, 1, 0, 300, null)
		expect(await repo.measureUsedBytes(7)).toBe(500 + 100 + 300)
	})
})
