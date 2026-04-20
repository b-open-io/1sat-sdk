import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { WalletInterface } from '@bsv/sdk'
import { AccountsGate } from '../src/accounts/middleware'
import { BunSqliteAccountsRepo } from '../src/accounts/repo'
import type { WalletStorageProvider } from '../src/types'

const IDENTITY = '02'.padEnd(66, 'a')
const SERVER_IDENTITY = '03'.padEnd(66, 'b')

function makeDb(): { db: Database; repo: BunSqliteAccountsRepo } {
	const db = new Database(':memory:')
	// Minimal wallet-toolbox-shaped tables the accounts layer reads from.
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
	// Accounts tables (live in the same db as part of the wallet schema).
	db.run(`CREATE TABLE accounts (
		identity_key TEXT PRIMARY KEY,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`)
	db.run(`CREATE TABLE payments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		identity_key TEXT NOT NULL,
		txid TEXT NOT NULL UNIQUE,
		bytes_covered INTEGER NOT NULL,
		sats_paid INTEGER NOT NULL,
		paid_through_block INTEGER NOT NULL,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`)
	const repo = new BunSqliteAccountsRepo(db)
	return { db, repo }
}

function makeStorage(userIdBy: Record<string, number>): WalletStorageProvider {
	return {
		findOrInsertUser: async (identityKey: string) => {
			const userId = userIdBy[identityKey]
			if (userId === undefined) {
				return { user: undefined, isNew: false } as unknown as {
					user: { userId: number }
					isNew: boolean
				}
			}
			return { user: { userId }, isNew: false } as unknown as {
				user: { userId: number }
				isNew: boolean
			}
		},
	} as unknown as WalletStorageProvider
}

const stubWallet = {} as WalletInterface

describe('AccountsGate', () => {
	let db: Database
	let repo: BunSqliteAccountsRepo
	beforeEach(() => {
		;({ db, repo } = makeDb())
	})
	afterEach(() => {
		db.close()
	})

	test('allows when accounts disabled', async () => {
		const gate = new AccountsGate({
			config: {
				enabled: false,
				baselineBytes: 0,
				purchaseUnitBytes: 1_073_741_824,
				satsPerUnit: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({}),
			repo,
			wallet: stubWallet,
			serverIdentityKey: SERVER_IDENTITY,
			currentBlock: async () => 800000,
		})
		const decision = await gate.check({
			method: 'createAction',
			identity: { identityKey: IDENTITY },
			request: new Request('http://x/'),
			id: 1,
		})
		expect(decision.type).toBe('allow')
	})

	test('allows read methods regardless of capacity', async () => {
		const gate = new AccountsGate({
			config: {
				enabled: true,
				baselineBytes: 0,
				purchaseUnitBytes: 1_073_741_824,
				satsPerUnit: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({}),
			repo,
			wallet: stubWallet,
			serverIdentityKey: SERVER_IDENTITY,
			currentBlock: async () => 800000,
		})
		const decision = await gate.check({
			method: 'getSettings',
			identity: { identityKey: IDENTITY },
			request: new Request('http://x/'),
			id: 2,
		})
		expect(decision.type).toBe('allow')
	})

	test('server identity bypasses metering', async () => {
		const gate = new AccountsGate({
			config: {
				enabled: true,
				baselineBytes: 0,
				purchaseUnitBytes: 1_073_741_824,
				satsPerUnit: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({ [SERVER_IDENTITY]: 10 }),
			repo,
			wallet: stubWallet,
			serverIdentityKey: SERVER_IDENTITY,
			currentBlock: async () => 800000,
		})
		const decision = await gate.check({
			method: 'createAction',
			identity: { identityKey: SERVER_IDENTITY },
			request: new Request('http://x/'),
			id: 3,
		})
		expect(decision.type).toBe('allow')
	})

	test('configured free key bypasses metering', async () => {
		const FREE = '04'.padEnd(66, 'c')
		const gate = new AccountsGate({
			config: {
				enabled: true,
				baselineBytes: 0,
				purchaseUnitBytes: 1_073_741_824,
				satsPerUnit: 1_000_000,
				durationBlocks: 4383,
				freeIdentityKeys: [FREE],
			},
			walletStorage: makeStorage({ [FREE]: 11 }),
			repo,
			wallet: stubWallet,
			serverIdentityKey: SERVER_IDENTITY,
			currentBlock: async () => 800000,
		})
		const decision = await gate.check({
			method: 'createAction',
			identity: { identityKey: FREE },
			request: new Request('http://x/'),
			id: 4,
		})
		expect(decision.type).toBe('allow')
	})

	test('allows billable request when no wallet-toolbox user exists yet', async () => {
		const gate = new AccountsGate({
			config: {
				enabled: true,
				baselineBytes: 0,
				purchaseUnitBytes: 1_073_741_824,
				satsPerUnit: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({}),
			repo,
			wallet: stubWallet,
			serverIdentityKey: SERVER_IDENTITY,
			currentBlock: async () => 800000,
		})
		const decision = await gate.check({
			method: 'createAction',
			identity: { identityKey: IDENTITY },
			request: new Request('http://x/'),
			id: 5,
		})
		expect(decision.type).toBe('allow')
	})

	test('allows when usage is within baseline', async () => {
		db.prepare(
			'INSERT INTO transactions (userId, rawTx, inputBEEF) VALUES (?, ?, ?)',
		).run(5, new Uint8Array(100), null)
		const gate = new AccountsGate({
			config: {
				enabled: true,
				baselineBytes: 1_000_000,
				purchaseUnitBytes: 1_073_741_824,
				satsPerUnit: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({ [IDENTITY]: 5 }),
			repo,
			wallet: stubWallet,
			serverIdentityKey: SERVER_IDENTITY,
			currentBlock: async () => 800000,
		})
		const decision = await gate.check({
			method: 'createAction',
			identity: { identityKey: IDENTITY },
			request: new Request('http://x/'),
			id: 6,
		})
		expect(decision.type).toBe('allow')
	})

	test('returns 402 challenge when over capacity and no payment attached', async () => {
		db.prepare(
			'INSERT INTO transactions (userId, rawTx, inputBEEF) VALUES (?, ?, ?)',
		).run(5, new Uint8Array(10_000), new Uint8Array(10_000))
		const gate = new AccountsGate({
			config: {
				enabled: true,
				baselineBytes: 0,
				purchaseUnitBytes: 1_073_741_824,
				satsPerUnit: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({ [IDENTITY]: 5 }),
			repo,
			wallet: stubWallet,
			serverIdentityKey: SERVER_IDENTITY,
			currentBlock: async () => 800000,
		})
		const decision = await gate.check({
			method: 'createAction',
			identity: { identityKey: IDENTITY },
			request: new Request('http://x/'),
			id: 7,
		})
		expect(decision.type).toBe('blocked')
		if (decision.type === 'blocked') {
			expect(decision.response.status).toBe(402)
			const body = (await decision.response.json()) as {
				error: { data: { satoshisRequired: number; derivationPrefix: string } }
				id: number
			}
			expect(body.error.data.satoshisRequired).toBe(1_000_000)
			expect(typeof body.error.data.derivationPrefix).toBe('string')
			expect(body.id).toBe(7)
		}
	})
})
