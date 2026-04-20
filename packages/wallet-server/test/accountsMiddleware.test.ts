import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { WalletInterface } from '@bsv/sdk'
import { type Knex, knex as makeKnex } from 'knex'
import { AccountsGate } from '../src/accounts/middleware'
import { runMigrations } from '../src/accounts/migrations'
import type { WalletStorageProvider } from '../src/types'

const IDENTITY = '02'.padEnd(66, 'a')
const SERVER_IDENTITY = '03'.padEnd(66, 'b')

async function makeDb(): Promise<Knex> {
	const db = makeKnex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	})
	await runMigrations(db)
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
	let db: Knex
	beforeEach(async () => {
		db = await makeDb()
	})
	afterEach(async () => {
		await db.destroy()
	})

	test('allows when accounts disabled', async () => {
		const gate = new AccountsGate({
			config: {
				enabled: false,
				baselineBytes: 0,
				satsPerGb: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({}),
			knex: db,
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
				satsPerGb: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({}),
			knex: db,
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
				satsPerGb: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({ [SERVER_IDENTITY]: 10 }),
			knex: db,
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
				satsPerGb: 1_000_000,
				durationBlocks: 4383,
				freeIdentityKeys: [FREE],
			},
			walletStorage: makeStorage({ [FREE]: 11 }),
			knex: db,
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
				satsPerGb: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({}),
			knex: db,
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
		await db('transactions').insert({
			userId: 5,
			rawTx: Buffer.alloc(100),
			inputBEEF: null,
		})
		const gate = new AccountsGate({
			config: {
				enabled: true,
				baselineBytes: 1_000_000,
				satsPerGb: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({ [IDENTITY]: 5 }),
			knex: db,
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
		// Insert a lot of bytes for user 5
		await db('transactions').insert({
			userId: 5,
			rawTx: Buffer.alloc(10_000),
			inputBEEF: Buffer.alloc(10_000),
		})
		const gate = new AccountsGate({
			config: {
				enabled: true,
				baselineBytes: 0,
				satsPerGb: 1_000_000,
				durationBlocks: 4383,
			},
			walletStorage: makeStorage({ [IDENTITY]: 5 }),
			knex: db,
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
