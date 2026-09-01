/**
 * StorageBunSqlite — drop-in replacement for StorageKnex that uses bun:sqlite
 * directly, eliminating the knex + better-sqlite3 dependency chain.
 *
 * Extends StorageProvider (same as StorageKnex) so it can be used anywhere
 * a WalletStorageProvider is expected.
 */

import { Database } from 'bun:sqlite'
import { Beef, Transaction as BsvTransaction } from '@bsv/sdk'
import type { ListActionsResult, ListOutputsResult, Validation } from '@bsv/sdk'
import { WERR_UNAUTHORIZED } from '@bsv/wallet-toolbox/out/src/sdk/WERR_errors.js'
import { WERR_INVALID_PARAMETER } from '@bsv/wallet-toolbox/out/src/sdk/WERR_errors.js'
import { WERR_INTERNAL } from '@bsv/wallet-toolbox/out/src/sdk/WERR_errors.js'
import { WERR_NOT_IMPLEMENTED } from '@bsv/wallet-toolbox/out/src/sdk/WERR_errors.js'
import type {
	AuthId,
	FindCertificateFieldsArgs,
	FindCertificatesArgs,
	FindCommissionsArgs,
	FindForUserSincePagedArgs,
	FindMonitorEventsArgs,
	FindOutputBasketsArgs,
	FindOutputTagMapsArgs,
	FindOutputTagsArgs,
	FindOutputsArgs,
	FindProvenTxReqsArgs,
	FindProvenTxsArgs,
	FindSyncStatesArgs,
	FindTransactionsArgs,
	FindTxLabelMapsArgs,
	FindTxLabelsArgs,
	FindUsersArgs,
	ProvenOrRawTx,
	PurgeParams,
	PurgeResults,
	TrxToken,
} from '@bsv/wallet-toolbox/out/src/sdk/WalletStorage.interfaces.js'
import type { EntityTimeStamp } from '@bsv/wallet-toolbox/out/src/sdk/types.js'
import { isListActionsSpecOp } from '@bsv/wallet-toolbox/out/src/sdk/types.js'
import {
	StorageProvider,
	type StorageProviderOptions,
} from '@bsv/wallet-toolbox/out/src/storage/StorageProvider.js'
import type { AdminStatsResult } from '@bsv/wallet-toolbox/out/src/storage/StorageProvider.js'
import type { DBType } from '@bsv/wallet-toolbox/out/src/storage/StorageReader.js'
import { getLabelToSpecOp } from '@bsv/wallet-toolbox/out/src/storage/methods/ListActionsSpecOp.js'
import { getListOutputsSpecOp } from '@bsv/wallet-toolbox/out/src/storage/methods/ListOutputsSpecOp.js'
import { outputColumnsWithoutLockingScript } from '@bsv/wallet-toolbox/out/src/storage/schema/tables/TableOutput.js'
import { transactionColumnsWithoutRawTx } from '@bsv/wallet-toolbox/out/src/storage/schema/tables/TableTransaction.js'
import type {
	TableActionBatch,
	TableCertificate,
	TableCertificateField,
	TableCertificateX,
	TableCommission,
	TableMonitorEvent,
	TableOutput,
	TableOutputBasket,
	TableOutputTag,
	TableOutputTagMap,
	TableProvenTx,
	TableProvenTxReq,
	TableSettings,
	TableSyncState,
	TableTransaction,
	TableTxLabel,
	TableTxLabelMap,
	TableUser,
} from '@bsv/wallet-toolbox/out/src/storage/schema/tables/index.js'
import {
	applyBrc153ReferenceLabel,
	makeBrc114ActionTimeLabel,
	parseBrc114ActionTimeLabels,
} from '@bsv/wallet-toolbox'
import {
	verifyId,
	verifyOneOrNone,
	verifyTruthy,
} from '@bsv/wallet-toolbox/out/src/utility/utilityHelpers.js'
import { asString } from '@bsv/wallet-toolbox/out/src/utility/utilityHelpers.noBuffer.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StorageBunSqliteOptions extends StorageProviderOptions {
	/** Path to the SQLite file, or ':memory:' for in-memory database */
	filename: string
}

// Internal token type we pass through TrxToken. We use a branded symbol so
// that we can distinguish "inside a transaction" from "not".
const TRX_BRAND = Symbol('BunSqliteTrx')

interface BunTrxToken {
	[TRX_BRAND]: true
	/**
	 * The Database instance to use. For transactions this is the same
	 * db but we track that we're inside a transaction to avoid nesting.
	 */
	db: Database
}

// ---------------------------------------------------------------------------
// Helper: convert number[] / Uint8Array to Buffer for SQLite BLOB storage
// ---------------------------------------------------------------------------

function toBlob(
	val: number[] | Uint8Array | Buffer | null | undefined,
): Buffer | null {
	if (val == null) return null
	if (Buffer.isBuffer(val)) return val
	if (val instanceof Uint8Array) return Buffer.from(val)
	if (Array.isArray(val)) return Buffer.from(val)
	return null
}

/**
 * Build the SQL fragment that restricts `outputs` rows to those carrying the
 * supplied output tag ids. `isQueryModeAll` requires every tag (HAVING COUNT
 * match); default "any" requires at least one (EXISTS). Returns undefined when
 * no tag filter is requested so callers can skip the AND.
 */
function buildOutputTagFilterSql(
	tagIds?: number[],
	isQueryModeAll?: boolean,
): { sql: string; params: unknown[] } | undefined {
	if (!tagIds || tagIds.length === 0) return undefined
	const placeholders = tagIds.map(() => '?').join(',')
	if (isQueryModeAll) {
		return {
			sql: `(SELECT COUNT(*) FROM output_tags_map m WHERE m.outputId = outputs.outputId AND m.outputTagId IN (${placeholders})) = ${tagIds.length}`,
			params: [...tagIds],
		}
	}
	return {
		sql: `EXISTS (SELECT 1 FROM output_tags_map m WHERE m.outputId = outputs.outputId AND m.outputTagId IN (${placeholders}))`,
		params: [...tagIds],
	}
}

/**
 * Build the SQL fragment that restricts `transactions` rows to those carrying
 * the supplied tx label ids. Same mode semantics as `buildOutputTagFilterSql`.
 */
function buildTxLabelFilterSql(
	labelIds?: number[],
	isQueryModeAll?: boolean,
): { sql: string; params: unknown[] } | undefined {
	if (!labelIds || labelIds.length === 0) return undefined
	const placeholders = labelIds.map(() => '?').join(',')
	if (isQueryModeAll) {
		return {
			sql: `(SELECT COUNT(*) FROM tx_labels_map m WHERE m.transactionId = transactions.transactionId AND m.txLabelId IN (${placeholders})) = ${labelIds.length}`,
			params: [...labelIds],
		}
	}
	return {
		sql: `EXISTS (SELECT 1 FROM tx_labels_map m WHERE m.transactionId = transactions.transactionId AND m.txLabelId IN (${placeholders}))`,
		params: [...labelIds],
	}
}

// ---------------------------------------------------------------------------
// StorageBunSqlite
// ---------------------------------------------------------------------------

export class StorageBunSqlite extends StorageProvider {
	db: Database
	_verifiedReadyForDatabaseAccess = false
	/**
	 * Valid column names per table, populated after migrations via
	 * `PRAGMA table_info`. Used to drop unknown keys before building
	 * INSERT/UPDATE SQL so wire-format drift (e.g. a foreign client
	 * shipping a record with a typo'd field) can't produce SQL errors
	 * against the bound parameters.
	 */
	private tableColumns: Map<string, Set<string>> = new Map()

	constructor(options: StorageBunSqliteOptions) {
		super(options)
		this.db = new Database(options.filename)
		// Enable WAL mode for better concurrent read performance
		this.db.run('PRAGMA journal_mode = WAL')
	}

	// -----------------------------------------------------------------------
	// Core infrastructure
	// -----------------------------------------------------------------------

	async readSettings(): Promise<TableSettings> {
		const row = this.db.query('SELECT * FROM settings LIMIT 1').get() as Record<
			string,
			unknown
		> | null
		if (!row) throw new WERR_INTERNAL('No settings row found')
		return this.validateEntity(row as unknown as TableSettings)
	}

	async destroy(): Promise<void> {
		this.db.close()
	}

	async migrate(
		storageName: string,
		storageIdentityKey: string,
	): Promise<string> {
		this.db.run('PRAGMA foreign_keys = OFF')

		// Track migration version
		this.db.run(`
			CREATE TABLE IF NOT EXISTS knex_migrations (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				batch INTEGER NOT NULL,
				migration_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`)
		this.db.run(`
			CREATE TABLE IF NOT EXISTS knex_migrations_lock (
				index_ INTEGER PRIMARY KEY,
				is_locked INTEGER
			)
		`)
		// Insert lock row if missing
		this.db.run(
			'INSERT OR IGNORE INTO knex_migrations_lock (index_, is_locked) VALUES (1, 0)',
		)

		const existingMigrations = new Set<string>(
			(
				this.db.query('SELECT name FROM knex_migrations').all() as {
					name: string
				}[]
			).map((r) => r.name),
		)

		const migrations = this.getMigrationDefinitions(
			storageName,
			storageIdentityKey,
		)
		const sortedNames = Object.keys(migrations).sort()

		let batch = 0
		const batchRow = this.db
			.query('SELECT MAX(batch) as maxBatch FROM knex_migrations')
			.get() as { maxBatch: number | null } | null
		if (batchRow?.maxBatch != null) batch = batchRow.maxBatch
		batch++

		for (const name of sortedNames) {
			if (existingMigrations.has(name)) continue
			const migration = migrations[name]
			migration.up(this.db)
			this.db.run('INSERT INTO knex_migrations (name, batch) VALUES (?, ?)', [
				name,
				batch,
			])
		}

		this.db.run('PRAGMA foreign_keys = ON')

		this.refreshTableColumns()

		// Return the current version (latest migration name)
		const latest = this.db
			.query('SELECT name FROM knex_migrations ORDER BY id DESC LIMIT 1')
			.get() as { name: string } | null
		return latest?.name ?? 'none'
	}

	/**
	 * Introspect the live schema and cache the column set for every user
	 * table. Called at the end of `migrate()`; also safe to call again if
	 * a table is added at runtime.
	 */
	private refreshTableColumns(): void {
		this.tableColumns.clear()
		const tables = this.db
			.query(
				`SELECT name FROM sqlite_master
				 WHERE type='table'
				   AND name NOT LIKE 'sqlite_%'
				   AND name NOT LIKE 'knex_migrations%'`,
			)
			.all() as { name: string }[]
		for (const { name } of tables) {
			const cols = this.db
				.query(`PRAGMA table_info(${this.quoteCol(name)})`)
				.all() as { name: string }[]
			this.tableColumns.set(name, new Set(cols.map((c) => c.name)))
		}
	}

	/**
	 * Return a copy of `entity` containing only keys that correspond to
	 * real columns in `table`. Unknown keys are dropped silently so that
	 * a rogue field in an incoming RPC payload can't become a SQL
	 * identifier. If we have no schema record for `table` (e.g. the
	 * migration step was bypassed), pass through unchanged.
	 */
	private filterToSchema(
		table: string,
		entity: Record<string, unknown>,
	): Record<string, unknown> {
		const allowed = this.tableColumns.get(table)
		if (!allowed) return entity
		const out: Record<string, unknown> = {}
		for (const k of Object.keys(entity)) {
			if (allowed.has(k)) out[k] = entity[k]
		}
		return out
	}

	private getMigrationDefinitions(
		storageName: string,
		storageIdentityKey: string,
	): Record<
		string,
		{ up: (db: Database) => void; down: (db: Database) => void }
	> {
		const migrations: Record<
			string,
			{ up: (db: Database) => void; down: (db: Database) => void }
		> = {}

		const _now = `datetime('now')`

		migrations['2024-12-26-001 initial migration'] = {
			up: (db: Database) => {
				db.run(`
					CREATE TABLE IF NOT EXISTS proven_txs (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						provenTxId INTEGER PRIMARY KEY AUTOINCREMENT,
						txid TEXT NOT NULL UNIQUE,
						height INTEGER NOT NULL,
						"index" INTEGER NOT NULL,
						merklePath BLOB NOT NULL,
						rawTx BLOB NOT NULL,
						blockHash TEXT NOT NULL,
						merkleRoot TEXT NOT NULL
					)
				`)
				db.run(`
					CREATE TABLE IF NOT EXISTS proven_tx_reqs (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						provenTxReqId INTEGER PRIMARY KEY AUTOINCREMENT,
						provenTxId INTEGER REFERENCES proven_txs(provenTxId),
						status TEXT NOT NULL DEFAULT 'unknown',
						attempts INTEGER NOT NULL DEFAULT 0,
						notified INTEGER NOT NULL DEFAULT 0,
						txid TEXT NOT NULL UNIQUE,
						batch TEXT,
						history TEXT NOT NULL DEFAULT '{}',
						notify TEXT NOT NULL DEFAULT '{}',
						rawTx BLOB NOT NULL,
						inputBEEF BLOB
					)
				`)
				db.run(
					'CREATE INDEX IF NOT EXISTS proven_tx_reqs_status ON proven_tx_reqs(status)',
				)
				db.run(
					'CREATE INDEX IF NOT EXISTS proven_tx_reqs_batch ON proven_tx_reqs(batch)',
				)

				db.run(`
					CREATE TABLE IF NOT EXISTS users (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						userId INTEGER PRIMARY KEY AUTOINCREMENT,
						identityKey TEXT NOT NULL UNIQUE
					)
				`)
				db.run(`
					CREATE TABLE IF NOT EXISTS certificates (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						certificateId INTEGER PRIMARY KEY AUTOINCREMENT,
						userId INTEGER NOT NULL REFERENCES users(userId),
						serialNumber TEXT NOT NULL,
						type TEXT NOT NULL,
						certifier TEXT NOT NULL,
						subject TEXT NOT NULL,
						verifier TEXT,
						revocationOutpoint TEXT NOT NULL,
						signature TEXT NOT NULL,
						isDeleted INTEGER NOT NULL DEFAULT 0,
						UNIQUE(userId, type, certifier, serialNumber)
					)
				`)
				db.run(`
					CREATE TABLE IF NOT EXISTS certificate_fields (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						userId INTEGER NOT NULL REFERENCES users(userId),
						certificateId INTEGER NOT NULL REFERENCES certificates(certificateId),
						fieldName TEXT NOT NULL,
						fieldValue TEXT NOT NULL,
						masterKey TEXT NOT NULL DEFAULT '',
						UNIQUE(fieldName, certificateId)
					)
				`)
				db.run(`
					CREATE TABLE IF NOT EXISTS output_baskets (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						basketId INTEGER PRIMARY KEY AUTOINCREMENT,
						userId INTEGER NOT NULL REFERENCES users(userId),
						name TEXT NOT NULL,
						numberOfDesiredUTXOs INTEGER NOT NULL DEFAULT 6,
						minimumDesiredUTXOValue INTEGER NOT NULL DEFAULT 10000,
						isDeleted INTEGER NOT NULL DEFAULT 0,
						UNIQUE(name, userId)
					)
				`)
				db.run(`
					CREATE TABLE IF NOT EXISTS transactions (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						transactionId INTEGER PRIMARY KEY AUTOINCREMENT,
						userId INTEGER NOT NULL REFERENCES users(userId),
						provenTxId INTEGER REFERENCES proven_txs(provenTxId),
						status TEXT NOT NULL,
						reference TEXT NOT NULL UNIQUE,
						isOutgoing INTEGER NOT NULL,
						satoshis INTEGER NOT NULL DEFAULT 0,
						version INTEGER,
						lockTime INTEGER,
						description TEXT NOT NULL,
						txid TEXT,
						inputBEEF BLOB,
						rawTx BLOB
					)
				`)
				db.run(
					'CREATE INDEX IF NOT EXISTS transactions_status ON transactions(status)',
				)

				db.run(`
					CREATE TABLE IF NOT EXISTS commissions (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						commissionId INTEGER PRIMARY KEY AUTOINCREMENT,
						userId INTEGER NOT NULL REFERENCES users(userId),
						transactionId INTEGER NOT NULL UNIQUE REFERENCES transactions(transactionId),
						satoshis INTEGER NOT NULL,
						keyOffset TEXT NOT NULL,
						isRedeemed INTEGER NOT NULL DEFAULT 0,
						lockingScript BLOB NOT NULL
					)
				`)
				db.run(
					'CREATE INDEX IF NOT EXISTS commissions_transactionId ON commissions(transactionId)',
				)

				db.run(`
					CREATE TABLE IF NOT EXISTS outputs (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						outputId INTEGER PRIMARY KEY AUTOINCREMENT,
						userId INTEGER NOT NULL REFERENCES users(userId),
						transactionId INTEGER NOT NULL REFERENCES transactions(transactionId),
						basketId INTEGER REFERENCES output_baskets(basketId),
						spendable INTEGER NOT NULL DEFAULT 0,
						"change" INTEGER NOT NULL DEFAULT 0,
						vout INTEGER NOT NULL,
						satoshis INTEGER NOT NULL,
						providedBy TEXT NOT NULL,
						purpose TEXT NOT NULL,
						type TEXT NOT NULL,
						outputDescription TEXT,
						txid TEXT,
						senderIdentityKey TEXT,
						derivationPrefix TEXT,
						derivationSuffix TEXT,
						customInstructions TEXT,
						spentBy INTEGER REFERENCES transactions(transactionId),
						sequenceNumber INTEGER,
						spendingDescription TEXT,
						scriptLength INTEGER,
						scriptOffset INTEGER,
						lockingScript BLOB,
						UNIQUE(transactionId, vout, userId)
					)
				`)

				db.run(`
					CREATE TABLE IF NOT EXISTS output_tags (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						outputTagId INTEGER PRIMARY KEY AUTOINCREMENT,
						userId INTEGER NOT NULL REFERENCES users(userId),
						tag TEXT NOT NULL,
						isDeleted INTEGER NOT NULL DEFAULT 0,
						UNIQUE(tag, userId)
					)
				`)
				db.run(`
					CREATE TABLE IF NOT EXISTS output_tags_map (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						outputTagId INTEGER NOT NULL REFERENCES output_tags(outputTagId),
						outputId INTEGER NOT NULL REFERENCES outputs(outputId),
						isDeleted INTEGER NOT NULL DEFAULT 0,
						UNIQUE(outputTagId, outputId)
					)
				`)
				db.run(
					'CREATE INDEX IF NOT EXISTS output_tags_map_outputId ON output_tags_map(outputId)',
				)

				db.run(`
					CREATE TABLE IF NOT EXISTS tx_labels (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						txLabelId INTEGER PRIMARY KEY AUTOINCREMENT,
						userId INTEGER NOT NULL REFERENCES users(userId),
						label TEXT NOT NULL,
						isDeleted INTEGER NOT NULL DEFAULT 0,
						UNIQUE(label, userId)
					)
				`)
				db.run(`
					CREATE TABLE IF NOT EXISTS tx_labels_map (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						txLabelId INTEGER NOT NULL REFERENCES tx_labels(txLabelId),
						transactionId INTEGER NOT NULL REFERENCES transactions(transactionId),
						isDeleted INTEGER NOT NULL DEFAULT 0,
						UNIQUE(txLabelId, transactionId)
					)
				`)
				db.run(
					'CREATE INDEX IF NOT EXISTS tx_labels_map_transactionId ON tx_labels_map(transactionId)',
				)

				db.run(`
					CREATE TABLE IF NOT EXISTS monitor_events (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						event TEXT NOT NULL,
						details TEXT
					)
				`)
				db.run(`
					CREATE TABLE IF NOT EXISTS settings (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						storageIdentityKey TEXT NOT NULL,
						storageName TEXT NOT NULL,
						chain TEXT NOT NULL,
						dbtype TEXT NOT NULL,
						maxOutputScript INTEGER NOT NULL
					)
				`)
				db.run(`
					CREATE TABLE IF NOT EXISTS sync_states (
						created_at TEXT NOT NULL DEFAULT (datetime('now')),
						updated_at TEXT NOT NULL DEFAULT (datetime('now')),
						syncStateId INTEGER PRIMARY KEY AUTOINCREMENT,
						userId INTEGER NOT NULL REFERENCES users(userId),
						storageIdentityKey TEXT NOT NULL DEFAULT '',
						storageName TEXT NOT NULL,
						status TEXT NOT NULL DEFAULT 'unknown',
						init INTEGER NOT NULL DEFAULT 0,
						refNum TEXT NOT NULL UNIQUE,
						syncMap TEXT NOT NULL,
						"when" TEXT,
						satoshis INTEGER,
						errorLocal TEXT,
						errorOther TEXT
					)
				`)
				db.run(
					'CREATE INDEX IF NOT EXISTS sync_states_status ON sync_states(status)',
				)
				db.run(
					'CREATE INDEX IF NOT EXISTS sync_states_refNum ON sync_states(refNum)',
				)

				// Insert settings row
				db.run(
					`INSERT INTO settings (storageIdentityKey, storageName, chain, dbtype, maxOutputScript)
					 VALUES (?, ?, ?, 'SQLite', 1024)`,
					[storageIdentityKey, storageName, this.chain],
				)
			},
			down: (db: Database) => {
				for (const table of [
					'sync_states',
					'settings',
					'monitor_events',
					'certificate_fields',
					'certificates',
					'commissions',
					'output_tags_map',
					'output_tags',
					'outputs',
					'output_baskets',
					'tx_labels_map',
					'tx_labels',
					'transactions',
					'users',
					'proven_tx_reqs',
					'proven_txs',
				]) {
					db.run(`DROP TABLE IF EXISTS ${table}`)
				}
			},
		}

		migrations['2025-01-21-001 add activeStorage to users'] = {
			up: (db: Database) => {
				// Check if column already exists
				const info = db.query('PRAGMA table_info(users)').all() as {
					name: string
				}[]
				if (!info.some((c) => c.name === 'activeStorage')) {
					db.run('ALTER TABLE users ADD COLUMN activeStorage TEXT DEFAULT NULL')
				}
			},
			down: (_db: Database) => {
				// SQLite doesn't support DROP COLUMN in older versions, but bun:sqlite does
			},
		}

		migrations['2025-02-22-001 nonNULL activeStorage'] = {
			up: (db: Database) => {
				// Set activeStorage for existing users
				const settings = db
					.query('SELECT storageIdentityKey FROM settings LIMIT 1')
					.get() as { storageIdentityKey: string } | null
				if (settings) {
					db.run(
						'UPDATE users SET activeStorage = ? WHERE activeStorage IS NULL',
						[settings.storageIdentityKey],
					)
				}
			},
			down: (_db: Database) => {},
		}

		migrations['2025-02-28-001 derivations to 200'] = {
			up: (_db: Database) => {
				// SQLite TEXT columns have no length constraints, nothing to do
			},
			down: (_db: Database) => {},
		}

		migrations['2025-03-01-001 reset req history'] = {
			up: (db: Database) => {
				db.run(`UPDATE proven_tx_reqs SET history = '{}'`)
			},
			down: (_db: Database) => {},
		}

		migrations['2025-03-03-001 descriptions to 2000'] = {
			up: (_db: Database) => {
				// SQLite TEXT columns have no length constraints, nothing to do
			},
			down: (_db: Database) => {},
		}

		migrations['2025-05-13-001 add monitor events event index'] = {
			up: (db: Database) => {
				db.run(
					'CREATE INDEX IF NOT EXISTS monitor_events_event ON monitor_events(event)',
				)
			},
			down: (db: Database) => {
				db.run('DROP INDEX IF EXISTS monitor_events_event')
			},
		}

		migrations['2025-09-06-001 add proven txs blockHash index'] = {
			up: (db: Database) => {
				db.run(
					'CREATE INDEX IF NOT EXISTS proven_txs_blockHash ON proven_txs(blockHash)',
				)
			},
			down: (db: Database) => {
				db.run('DROP INDEX IF EXISTS proven_txs_blockHash')
			},
		}

		migrations['2025-10-13-001 add outputs spendable index'] = {
			up: (db: Database) => {
				db.run(
					'CREATE INDEX IF NOT EXISTS outputs_spendable ON outputs(spendable)',
				)
			},
			down: (db: Database) => {
				db.run('DROP INDEX IF EXISTS outputs_spendable')
			},
		}

		migrations['2025-10-18-001 add transactions txid index'] = {
			up: (db: Database) => {
				db.run(
					'CREATE INDEX IF NOT EXISTS transactions_txid ON transactions(txid)',
				)
			},
			down: (db: Database) => {
				db.run('DROP INDEX IF EXISTS transactions_txid')
			},
		}

		migrations['2025-10-18-002 add proven_tx_reqs txid index'] = {
			up: (db: Database) => {
				db.run(
					'CREATE INDEX IF NOT EXISTS proven_tx_reqs_txid ON proven_tx_reqs(txid)',
				)
			},
			down: (db: Database) => {
				db.run('DROP INDEX IF EXISTS proven_tx_reqs_txid')
			},
		}

		migrations['2026-04-20-001 add transactions userId index'] = {
			up: (db: Database) => {
				db.run(
					'CREATE INDEX IF NOT EXISTS transactions_userId ON transactions(userId)',
				)
			},
			down: (db: Database) => {
				db.run('DROP INDEX IF EXISTS transactions_userId')
			},
		}

		migrations['2026-04-20-002 add outputs userId index'] = {
			up: (db: Database) => {
				db.run(
					'CREATE INDEX IF NOT EXISTS outputs_userId ON outputs(userId)',
				)
			},
			down: (db: Database) => {
				db.run('DROP INDEX IF EXISTS outputs_userId')
			},
		}

		// Storage-payment ledger state lives on the server wallet's own
		// transactions + tx_labels (see @1sat/wallet-server accounts/queries).
		// No separate `accounts` / `payments` tables required; the old
		// 2026-04-20-003 migration that created them has been dropped.

		return migrations
	}

	async dropAllData(): Promise<void> {
		this.db.run('PRAGMA foreign_keys = OFF')
		for (const table of [
			'sync_states',
			'settings',
			'monitor_events',
			'certificate_fields',
			'certificates',
			'commissions',
			'output_tags_map',
			'output_tags',
			'outputs',
			'output_baskets',
			'tx_labels_map',
			'tx_labels',
			'transactions',
			'users',
			'proven_tx_reqs',
			'proven_txs',
			'knex_migrations',
			'knex_migrations_lock',
		]) {
			this.db.run(`DROP TABLE IF EXISTS ${table}`)
		}
		this.db.run('PRAGMA foreign_keys = ON')
	}

	async transaction<T>(
		scope: (trx: TrxToken) => Promise<T>,
		trx?: TrxToken,
	): Promise<T> {
		if (trx) return await scope(trx)

		// bun:sqlite transactions are synchronous, but our scope is async.
		// We use SAVEPOINT manually so we can await inside.
		const token: BunTrxToken = { [TRX_BRAND]: true, db: this.db }
		const savepointName = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
		this.db.run(`SAVEPOINT ${savepointName}`)
		try {
			const result = await scope(token as unknown as TrxToken)
			this.db.run(`RELEASE SAVEPOINT ${savepointName}`)
			return result
		} catch (err) {
			this.db.run(`ROLLBACK TO SAVEPOINT ${savepointName}`)
			this.db.run(`RELEASE SAVEPOINT ${savepointName}`)
			throw err
		}
	}

	// -----------------------------------------------------------------------
	// Low-level query helpers
	// -----------------------------------------------------------------------

	/**
	 * Returns the Database instance. In the Knex version this returns a Knex
	 * query builder. Here it's just the db but we track last access.
	 */
	toDb(_trx?: TrxToken): Database {
		this.whenLastAccess = new Date()
		return this.db
	}

	private runSql(sql: string, params: unknown[] = []): void {
		this.whenLastAccess = new Date()
		this.db.run(sql, params as (string | number | null | Buffer)[])
	}

	private allSql<T = Record<string, unknown>>(
		sql: string,
		params: unknown[] = [],
	): T[] {
		this.whenLastAccess = new Date()
		return this.db
			.query(sql)
			.all(...(params as (string | number | null | Buffer)[])) as T[]
	}

	private getSql<T = Record<string, unknown>>(
		sql: string,
		params: unknown[] = [],
	): T | null {
		this.whenLastAccess = new Date()
		return (
			(this.db
				.query(sql)
				.get(...(params as (string | number | null | Buffer)[])) as T) ?? null
		)
	}

	/**
	 * Build a WHERE clause from a partial object.
	 * Returns { clause: string, params: unknown[] }
	 */
	private buildWhere(
		partial: Record<string, unknown>,
		prefix = '',
	): { clause: string; params: unknown[] } {
		for (const k of Object.keys(partial)) {
			if (partial[k] === undefined) {
				throw new WERR_INVALID_PARAMETER(
					`partial.${k}`,
					`not undefined. Passing undefined as a filter value is not supported — omit the key to skip filtering, or pass null for IS NULL. Matches Knex behavior.`,
				)
			}
		}
		const keys = Object.keys(partial)
		if (keys.length === 0) return { clause: '', params: [] }
		const parts: string[] = []
		const params: unknown[] = []
		for (const k of keys) {
			const col = prefix ? `${prefix}.${this.quoteCol(k)}` : this.quoteCol(k)
			const val = partial[k]
			if (val === null) {
				parts.push(`${col} IS NULL`)
			} else if (
				Array.isArray(val) &&
				(val.length === 0 || typeof val[0] === 'number')
			) {
				parts.push(`${col} = ?`)
				params.push(toBlob(val as number[]))
			} else {
				parts.push(`${col} = ?`)
				params.push(val)
			}
		}
		return { clause: parts.join(' AND '), params }
	}

	private quoteCol(name: string): string {
		// Quote reserved words
		const reserved = new Set([
			'index',
			'change',
			'when',
			'order',
			'group',
			'key',
			'type',
			'status',
		])
		if (reserved.has(name.toLowerCase())) return `"${name}"`
		return name
	}

	/** Build ORDER BY clause */
	private orderByColumn(table: string): string {
		switch (table) {
			case 'certificates':
				return 'certificateId'
			case 'commissions':
				return 'commissionId'
			case 'output_baskets':
				return 'basketId'
			case 'outputs':
				return 'outputId'
			case 'output_tags':
				return 'outputTagId'
			case 'proven_tx_reqs':
				return 'provenTxReqId'
			case 'proven_txs':
				return 'provenTxId'
			case 'sync_states':
				return 'syncStateId'
			case 'transactions':
				return 'transactionId'
			case 'tx_labels':
				return 'txLabelId'
			case 'users':
				return 'userId'
			case 'monitor_events':
				return 'id'
			default:
				return ''
		}
	}

	/**
	 * Generic SELECT builder matching StorageKnex.setupQuery behavior.
	 */
	private selectQuery<T>(
		table: string,
		args: {
			partial?: Record<string, unknown>
			since?: Date | string | number
			orderDescending?: boolean
			paged?: { limit: number; offset?: number }
		},
		extraWhere?: string,
		extraParams?: unknown[],
		columns?: string[],
	): T[] {
		const whereParts: string[] = []
		const params: unknown[] = []

		if (args.partial && Object.keys(args.partial).length > 0) {
			const w = this.buildWhere(args.partial as Record<string, unknown>)
			if (w.clause) {
				whereParts.push(w.clause)
				params.push(...w.params)
			}
		}

		if (args.since) {
			whereParts.push('updated_at >= ?')
			params.push(this.validateDateForWhere(args.since))
		}

		if (extraWhere) {
			whereParts.push(extraWhere)
			if (extraParams) params.push(...extraParams)
		}

		const colStr = columns ? columns.join(', ') : '*'
		let sql = `SELECT ${colStr} FROM ${table}`
		if (whereParts.length > 0) sql += ` WHERE ${whereParts.join(' AND ')}`

		if (args.orderDescending) {
			const col = this.orderByColumn(table)
			if (col) sql += ` ORDER BY ${col} DESC`
		}

		if (args.paged) {
			sql += ' LIMIT ?'
			params.push(args.paged.limit)
			if (args.paged.offset) {
				sql += ' OFFSET ?'
				params.push(args.paged.offset)
			}
		}

		return this.allSql<T>(sql, params)
	}

	/**
	 * Generic COUNT builder.
	 */
	private countQuery(
		table: string,
		args: {
			partial?: Record<string, unknown>
			since?: Date | string | number
		},
		extraWhere?: string,
		extraParams?: unknown[],
	): number {
		const whereParts: string[] = []
		const params: unknown[] = []

		if (args.partial && Object.keys(args.partial).length > 0) {
			const w = this.buildWhere(args.partial as Record<string, unknown>)
			if (w.clause) {
				whereParts.push(w.clause)
				params.push(...w.params)
			}
		}

		if (args.since) {
			whereParts.push('updated_at >= ?')
			params.push(this.validateDateForWhere(args.since))
		}

		if (extraWhere) {
			whereParts.push(extraWhere)
			if (extraParams) params.push(...extraParams)
		}

		let sql = `SELECT COUNT(*) as cnt FROM ${table}`
		if (whereParts.length > 0) sql += ` WHERE ${whereParts.join(' AND ')}`

		const row = this.getSql<{ cnt: number }>(sql, params)
		return row?.cnt ?? 0
	}

	/**
	 * INSERT a row and return the last inserted rowid.
	 */
	private insertRow(table: string, entity: Record<string, unknown>): number {
		const scoped = this.filterToSchema(table, entity)
		// Drop only undefined (caller didn't provide the field). Explicit
		// null is preserved and bound as SQL NULL — matches Knex binding
		// behavior, so schema NOT NULL violations surface instead of being
		// silently rewritten to DEFAULT.
		const filteredKeys = Object.keys(scoped).filter((k) => scoped[k] !== undefined)
		if (filteredKeys.length === 0)
			throw new WERR_INTERNAL(`Cannot insert empty entity into ${table}`)

		const cols = filteredKeys.map((k) => this.quoteCol(k)).join(', ')
		const placeholders = filteredKeys.map(() => '?').join(', ')
		const values = filteredKeys.map((k) => {
			const v = scoped[k]
			if (v === null) return null
			if (Buffer.isBuffer(v)) return v
			if (v instanceof Uint8Array) return Buffer.from(v)
			if (Array.isArray(v) && (v.length === 0 || typeof v[0] === 'number'))
				return Buffer.from(v as number[])
			return v
		})

		const sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders})`
		this.db.run(sql, values as (string | number | null | Buffer)[])

		// Get last inserted rowid
		const row = this.db.query('SELECT last_insert_rowid() as id').get() as {
			id: number
		}
		return row.id
	}

	/**
	 * UPDATE rows.
	 */
	private updateRows(
		table: string,
		where: Record<string, unknown>,
		update: Record<string, unknown>,
	): number {
		const scoped = this.filterToSchema(table, update)
		const setClauses: string[] = []
		const setParams: unknown[] = []
		for (const [k, v] of Object.entries(scoped)) {
			if (v === undefined) continue
			setClauses.push(`${this.quoteCol(k)} = ?`)
			if (v === null) {
				setParams.push(null)
			} else if (Buffer.isBuffer(v)) {
				setParams.push(v)
			} else if (v instanceof Uint8Array) {
				setParams.push(Buffer.from(v))
			} else if (
				Array.isArray(v) &&
				(v.length === 0 || typeof v[0] === 'number')
			) {
				setParams.push(Buffer.from(v as number[]))
			} else {
				setParams.push(v)
			}
		}

		if (setClauses.length === 0) return 0

		const w = this.buildWhere(where)
		let sql = `UPDATE ${table} SET ${setClauses.join(', ')}`
		if (w.clause) sql += ` WHERE ${w.clause}`
		const params = [...setParams, ...w.params]

		this.db.run(sql, params as (string | number | null | Buffer)[])
		const row = this.db.query('SELECT changes() as cnt').get() as { cnt: number } | null
		return row?.cnt ?? 0
	}

	// -----------------------------------------------------------------------
	// verifyReadyForDatabaseAccess
	// -----------------------------------------------------------------------

	async verifyReadyForDatabaseAccess(_trx?: TrxToken): Promise<DBType> {
		if (!this._settings) {
			this._settings = await this.readSettings()
		}
		// Always ensure foreign keys are enabled
		this.db.run('PRAGMA foreign_keys = ON')
		this._verifiedReadyForDatabaseAccess = true
		return this._settings.dbtype as DBType
	}

	// -----------------------------------------------------------------------
	// Date conversion — we are SQLite, dates are always ISO strings.
	// Override parent methods so we never depend on the external
	// wallet-toolbox's dbtype-switching logic.
	// -----------------------------------------------------------------------

	/** Convert any date-ish value to an ISO string. */
	private toIsoString(date: Date | string | number): string {
		if (typeof date === 'string') {
			// Validate it's parseable, return as-is if already ISO
			const d = new Date(date)
			if (Number.isNaN(d.getTime())) return new Date().toISOString()
			return d.toISOString()
		}
		if (typeof date === 'number') return new Date(date).toISOString()
		if (date instanceof Date) return date.toISOString()
		return new Date().toISOString()
	}

	override validateDate(date: Date | string | number): Date {
		if (typeof date === 'string') {
			const d = new Date(date)
			if (!Number.isNaN(d.getTime())) return d
			return new Date()
		}
		if (typeof date === 'number') return new Date(date)
		if (date instanceof Date) return date
		return new Date()
	}

	override validateEntityDate(date: Date | string | number): string {
		return this.toIsoString(date)
	}

	override validateOptionalEntityDate(
		date: Date | string | number | null | undefined,
		useNowAsDefault?: boolean,
	): string | undefined {
		if (date === null || date === undefined) {
			return useNowAsDefault ? new Date().toISOString() : undefined
		}
		return this.toIsoString(date)
	}

	// -----------------------------------------------------------------------
	// Validate helpers
	// -----------------------------------------------------------------------

	validatePartialForUpdate<T extends EntityTimeStamp>(
		update: Partial<T>,
		dateFields?: string[],
		booleanFields?: string[],
	): Partial<T> {
		if (!this.dbtype)
			throw new WERR_INTERNAL('must call verifyReadyForDatabaseAccess first')
		const v = update as Record<string, unknown>
		if (v.created_at)
			v.created_at = this.validateEntityDate(
				v.created_at as Date | string | number,
			)
		if (v.updated_at)
			v.updated_at = this.validateEntityDate(
				v.updated_at as Date | string | number,
			)
		if (!v.created_at) delete v.created_at
		if (!v.updated_at) v.updated_at = this.validateEntityDate(new Date())

		if (dateFields) {
			for (const df of dateFields) {
				if (v[df])
					v[df] = this.validateOptionalEntityDate(
						v[df] as Date | string | number,
					)
			}
		}
		if (booleanFields) {
			for (const df of booleanFields) {
				if ((update as Record<string, unknown>)[df] !== undefined) {
					;(update as Record<string, unknown>)[df] = (
						update as Record<string, unknown>
					)[df]
						? 1
						: 0
				}
			}
		}

		for (const key of Object.keys(v)) {
			const val = v[key]
			if (
				Array.isArray(val) &&
				(val.length === 0 || typeof val[0] === 'number')
			) {
				v[key] = Buffer.from(val as number[])
			} else if (val === undefined) {
				v[key] = null
			}
		}

		this.isDirty = true
		return v as Partial<T>
	}

	async validateEntityForInsert<T extends EntityTimeStamp>(
		entity: T,
		trx?: TrxToken,
		dateFields?: string[],
		booleanFields?: string[],
	): Promise<Record<string, unknown>> {
		await this.verifyReadyForDatabaseAccess(trx)
		const v = { ...entity } as Record<string, unknown>
		// Our overridden validateOptionalEntityDate always returns an ISO string
		// for SQLite — no fallbacks needed.
		v.created_at = this.validateOptionalEntityDate(
			v.created_at as Date | string | number | undefined,
			true,
		)
		v.updated_at = this.validateOptionalEntityDate(
			v.updated_at as Date | string | number | undefined,
			true,
		)

		if (dateFields) {
			for (const df of dateFields) {
				if (v[df])
					v[df] = this.validateOptionalEntityDate(
						v[df] as Date | string | number,
					)
			}
		}
		if (booleanFields) {
			for (const df of booleanFields) {
				if ((entity as Record<string, unknown>)[df] !== undefined) {
					;(entity as Record<string, unknown>)[df] = (
						entity as Record<string, unknown>
					)[df]
						? 1
						: 0
				}
			}
		}

		for (const key of Object.keys(v)) {
			const val = v[key]
			if (
				Array.isArray(val) &&
				(val.length === 0 || typeof val[0] === 'number')
			) {
				v[key] = Buffer.from(val as number[])
			} else if (val === undefined) {
				v[key] = null
			}
		}

		this.isDirty = true
		return v
	}

	validateEntity<T extends EntityTimeStamp>(
		entity: T,
		dateFields?: string[],
		booleanFields?: string[],
	): T {
		const e = entity as Record<string, unknown>
		e.created_at = this.validateDate(e.created_at as Date | string | number)
		e.updated_at = this.validateDate(e.updated_at as Date | string | number)

		if (dateFields) {
			for (const df of dateFields) {
				if (e[df]) e[df] = this.validateDate(e[df] as Date | string | number)
			}
		}
		if (booleanFields) {
			for (const df of booleanFields) {
				if (e[df] !== undefined) e[df] = !!e[df]
			}
		}

		for (const key of Object.keys(e)) {
			const val = e[key]
			if (val === null) {
				e[key] = undefined
			} else if (Buffer.isBuffer(val)) {
				e[key] = Array.from(val)
			} else if (val instanceof Uint8Array) {
				e[key] = Array.from(val)
			}
		}

		return entity
	}

	validateEntities<T extends EntityTimeStamp>(
		entities: T[],
		dateFields?: string[],
		booleanFields?: string[],
	): T[] {
		for (let i = 0; i < entities.length; i++) {
			entities[i] = this.validateEntity(entities[i], dateFields, booleanFields)
		}
		return entities
	}

	// -----------------------------------------------------------------------
	// getProvenOrRawTx / getRawTxOfKnownValidTransaction
	// -----------------------------------------------------------------------

	/**
	 * Sum of stored bytes attributable to a single wallet-toolbox user.
	 * Used by `@1sat/wallet-server` accounts metering to determine per-user
	 * capacity usage without requiring a separate ledger table.
	 *
	 * Per-user tables (transactions, outputs) are summed directly. Shared
	 * rows (proven_txs, proven_tx_reqs) are attributed to every user that
	 * references them via `transactions.provenTxId` or `transactions.txid`.
	 * In multi-tenant deployments this over-counts aggregate disk usage
	 * but reflects each user's standalone storage cost fairly.
	 *
	 * The equivalent Postgres impl (forthcoming `StoragePg`) uses
	 * OCTET_LENGTH(bytea) with the same shape.
	 */
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
		const toNum = (v: unknown): number => {
			if (v == null) return 0
			if (typeof v === 'number') return v
			if (typeof v === 'bigint') return Number(v)
			const n = Number(v)
			return Number.isFinite(n) ? n : 0
		}
		return (
			toNum(tx?.total) +
			toNum(proven?.total) +
			toNum(reqs?.total) +
			toNum(out?.total)
		)
	}

	async getProvenOrRawTx(
		txid: string,
		_trx?: TrxToken,
	): Promise<ProvenOrRawTx> {
		const r: ProvenOrRawTx = {
			proven: undefined,
			rawTx: undefined,
			inputBEEF: undefined,
		}
		r.proven = verifyOneOrNone(await this.findProvenTxs({ partial: { txid } }))
		if (!r.proven) {
			const row = this.getSql<{ rawTx: Buffer; inputBEEF: Buffer }>(
				`SELECT rawTx, inputBEEF FROM proven_tx_reqs WHERE txid = ? AND status IN ('unsent','unmined','unconfirmed','sending','nosend','completed')`,
				[txid],
			)
			if (row) {
				if (row.rawTx) r.rawTx = Array.from(row.rawTx)
				if (row.inputBEEF) r.inputBEEF = Array.from(row.inputBEEF)
			}
		}
		return r
	}

	dbTypeSubstring(
		source: string,
		fromOffset: number,
		forLength?: number,
	): string {
		return forLength !== undefined
			? `substr(${source}, ${fromOffset}, ${forLength})`
			: `substr(${source}, ${fromOffset})`
	}

	async getRawTxOfKnownValidTransaction(
		txid?: string,
		offset?: number,
		length?: number,
		trx?: TrxToken,
	): Promise<number[] | undefined> {
		if (!txid) return undefined
		if (!this.isAvailable()) await this.makeAvailable()

		let rawTx: number[] | undefined = undefined
		if (Number.isInteger(offset) && Number.isInteger(length)) {
			let row = this.getSql<{ rawTx: Buffer }>(
				`SELECT ${this.dbTypeSubstring('rawTx', offset! + 1, length!)} as rawTx FROM proven_txs WHERE txid = ?`,
				[txid],
			)
			if (row?.rawTx) {
				rawTx = Array.from(row.rawTx)
			} else {
				row = this.getSql<{ rawTx: Buffer }>(
					`SELECT ${this.dbTypeSubstring('rawTx', offset! + 1, length!)} as rawTx FROM proven_tx_reqs WHERE txid = ? AND status IN ('unsent','nosend','sending','unmined','completed','unfail')`,
					[txid],
				)
				if (row?.rawTx) rawTx = Array.from(row.rawTx)
			}
		} else {
			const r = await this.getProvenOrRawTx(txid, trx)
			if (r.proven) rawTx = r.proven.rawTx as number[] | undefined
			else rawTx = r.rawTx as number[] | undefined
		}
		return rawTx
	}

	// -----------------------------------------------------------------------
	// getXxxForUser queries
	// -----------------------------------------------------------------------

	async getProvenTxsForUser(
		args: FindForUserSincePagedArgs,
	): Promise<TableProvenTx[]> {
		const whereParts: string[] = []
		const params: unknown[] = []

		whereParts.push(
			'EXISTS (SELECT * FROM transactions WHERE proven_txs.provenTxId = transactions.provenTxId AND transactions.userId = ?)',
		)
		params.push(args.userId)

		if (args.since) {
			whereParts.push('updated_at >= ?')
			params.push(this.validateDateForWhere(args.since))
		}

		let sql = `SELECT * FROM proven_txs WHERE ${whereParts.join(' AND ')}`
		if (args.paged) {
			sql += ' LIMIT ?'
			params.push(args.paged.limit)
			if (args.paged.offset) {
				sql += ' OFFSET ?'
				params.push(args.paged.offset)
			}
		}

		return this.validateEntities(this.allSql(sql, params) as TableProvenTx[])
	}

	async getProvenTxReqsForUser(
		args: FindForUserSincePagedArgs,
	): Promise<TableProvenTxReq[]> {
		const whereParts: string[] = []
		const params: unknown[] = []

		whereParts.push(
			'EXISTS (SELECT * FROM transactions WHERE proven_tx_reqs.txid = transactions.txid AND transactions.userId = ?)',
		)
		params.push(args.userId)

		if (args.since) {
			whereParts.push('updated_at >= ?')
			params.push(this.validateDateForWhere(args.since))
		}

		let sql = `SELECT * FROM proven_tx_reqs WHERE ${whereParts.join(' AND ')}`
		if (args.paged) {
			sql += ' LIMIT ?'
			params.push(args.paged.limit)
			if (args.paged.offset) {
				sql += ' OFFSET ?'
				params.push(args.paged.offset)
			}
		}

		return this.validateEntities(
			this.allSql(sql, params) as TableProvenTxReq[],
			undefined,
			['notified'],
		)
	}

	async getTxLabelMapsForUser(
		args: FindForUserSincePagedArgs,
	): Promise<TableTxLabelMap[]> {
		const whereParts: string[] = []
		const params: unknown[] = []

		whereParts.push(
			'EXISTS (SELECT * FROM tx_labels WHERE tx_labels.txLabelId = tx_labels_map.txLabelId AND tx_labels.userId = ?)',
		)
		params.push(args.userId)

		if (args.since) {
			whereParts.push('updated_at >= ?')
			params.push(this.validateDateForWhere(args.since))
		}

		let sql = `SELECT * FROM tx_labels_map WHERE ${whereParts.join(' AND ')}`
		if (args.paged) {
			sql += ' LIMIT ?'
			params.push(args.paged.limit)
			if (args.paged.offset) {
				sql += ' OFFSET ?'
				params.push(args.paged.offset)
			}
		}

		return this.validateEntities(
			this.allSql(sql, params) as TableTxLabelMap[],
			undefined,
			['isDeleted'],
		)
	}

	async getOutputTagMapsForUser(
		args: FindForUserSincePagedArgs,
	): Promise<TableOutputTagMap[]> {
		const whereParts: string[] = []
		const params: unknown[] = []

		whereParts.push(
			'EXISTS (SELECT * FROM output_tags WHERE output_tags.outputTagId = output_tags_map.outputTagId AND output_tags.userId = ?)',
		)
		params.push(args.userId)

		if (args.since) {
			whereParts.push('updated_at >= ?')
			params.push(this.validateDateForWhere(args.since))
		}

		let sql = `SELECT * FROM output_tags_map WHERE ${whereParts.join(' AND ')}`
		if (args.paged) {
			sql += ' LIMIT ?'
			params.push(args.paged.limit)
			if (args.paged.offset) {
				sql += ' OFFSET ?'
				params.push(args.paged.offset)
			}
		}

		return this.validateEntities(
			this.allSql(sql, params) as TableOutputTagMap[],
			undefined,
			['isDeleted'],
		)
	}

	// -----------------------------------------------------------------------
	// INSERT methods
	// -----------------------------------------------------------------------

	async insertProvenTx(tx: TableProvenTx, trx?: TrxToken): Promise<number> {
		const e = (await this.validateEntityForInsert(tx, trx)) as Record<
			string,
			unknown
		>
		if (e.provenTxId === 0) e.provenTxId = undefined
		const id = this.insertRow('proven_txs', e)
		tx.provenTxId = id
		return id
	}

	async insertProvenTxReq(
		tx: TableProvenTxReq,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(tx, trx)) as Record<
			string,
			unknown
		>
		if (e.provenTxReqId === 0) e.provenTxReqId = undefined
		const id = this.insertRow('proven_tx_reqs', e)
		tx.provenTxReqId = id
		return id
	}

	async insertUser(user: TableUser, trx?: TrxToken): Promise<number> {
		const e = (await this.validateEntityForInsert(user, trx)) as Record<
			string,
			unknown
		>
		if (e.userId === 0) e.userId = undefined
		const id = this.insertRow('users', e)
		user.userId = id
		return id
	}

	async insertCertificateAuth(
		auth: AuthId,
		certificate: TableCertificateX,
	): Promise<number> {
		if (
			!auth.userId ||
			(certificate.userId && certificate.userId !== auth.userId)
		)
			throw new WERR_UNAUTHORIZED()
		certificate.userId = auth.userId
		return await this.insertCertificate(certificate)
	}

	async insertCertificate(
		certificate: TableCertificateX,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(certificate, trx, undefined, [
			'isDeleted',
		])) as Record<string, unknown>
		if (e.certificateId === 0) e.certificateId = undefined
		if (e.logger) e.logger = undefined
		const fields = e.fields as TableCertificateField[] | undefined
		if (e.fields) e.fields = undefined
		const id = this.insertRow('certificates', e)
		certificate.certificateId = id
		if (fields) {
			for (const field of fields) {
				field.certificateId = id
				field.userId = certificate.userId
				await this.insertCertificateField(field, trx)
			}
		}
		return id
	}

	async insertCertificateField(
		certificateField: TableCertificateField,
		trx?: TrxToken,
	): Promise<void> {
		const e = (await this.validateEntityForInsert(
			certificateField,
			trx,
		)) as Record<string, unknown>
		this.insertRow('certificate_fields', e)
	}

	async insertOutputBasket(
		basket: TableOutputBasket,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(basket, trx, undefined, [
			'isDeleted',
		])) as Record<string, unknown>
		if (e.basketId === 0) e.basketId = undefined
		const id = this.insertRow('output_baskets', e)
		basket.basketId = id
		return id
	}

	async insertTransaction(
		tx: TableTransaction,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(tx, trx)) as Record<
			string,
			unknown
		>
		if (e.transactionId === 0) e.transactionId = undefined
		const id = this.insertRow('transactions', e)
		tx.transactionId = id
		return id
	}

	async insertCommission(
		commission: TableCommission,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(commission, trx)) as Record<
			string,
			unknown
		>
		if (e.commissionId === 0) e.commissionId = undefined
		const id = this.insertRow('commissions', e)
		commission.commissionId = id
		return id
	}

	async insertOutput(output: TableOutput, trx?: TrxToken): Promise<number> {
		const e = (await this.validateEntityForInsert(output, trx)) as Record<
			string,
			unknown
		>
		if (e.outputId === 0) e.outputId = undefined
		const id = this.insertRow('outputs', e)
		output.outputId = id
		return id
	}

	async insertOutputTag(tag: TableOutputTag, trx?: TrxToken): Promise<number> {
		const e = (await this.validateEntityForInsert(tag, trx, undefined, [
			'isDeleted',
		])) as Record<string, unknown>
		if (e.outputTagId === 0) e.outputTagId = undefined
		const id = this.insertRow('output_tags', e)
		tag.outputTagId = id
		return id
	}

	async insertOutputTagMap(
		tagMap: TableOutputTagMap,
		trx?: TrxToken,
	): Promise<void> {
		const e = (await this.validateEntityForInsert(tagMap, trx, undefined, [
			'isDeleted',
		])) as Record<string, unknown>
		this.insertRow('output_tags_map', e)
	}

	async insertTxLabel(label: TableTxLabel, trx?: TrxToken): Promise<number> {
		const e = (await this.validateEntityForInsert(label, trx, undefined, [
			'isDeleted',
		])) as Record<string, unknown>
		if (e.txLabelId === 0) e.txLabelId = undefined
		const id = this.insertRow('tx_labels', e)
		label.txLabelId = id
		return id
	}

	async insertTxLabelMap(
		labelMap: TableTxLabelMap,
		trx?: TrxToken,
	): Promise<void> {
		const e = (await this.validateEntityForInsert(labelMap, trx, undefined, [
			'isDeleted',
		])) as Record<string, unknown>
		this.insertRow('tx_labels_map', e)
	}

	async insertMonitorEvent(
		event: TableMonitorEvent,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(event, trx)) as Record<
			string,
			unknown
		>
		if (e.id === 0) e.id = undefined
		const id = this.insertRow('monitor_events', e)
		event.id = id
		return id
	}

	async insertSyncState(
		syncState: TableSyncState,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(
			syncState,
			trx,
			['when'],
			['init'],
		)) as Record<string, unknown>
		if (e.syncStateId === 0) e.syncStateId = undefined
		const id = this.insertRow('sync_states', e)
		syncState.syncStateId = id
		return id
	}

	// -----------------------------------------------------------------------
	// UPDATE methods
	// -----------------------------------------------------------------------

	async updateCertificateField(
		certificateId: number,
		fieldName: string,
		update: Partial<TableCertificateField>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		const validated = this.validatePartialForUpdate(
			update as Partial<EntityTimeStamp>,
		) as Record<string, unknown>
		return this.updateRows(
			'certificate_fields',
			{ certificateId, fieldName },
			validated,
		)
	}

	async updateCertificate(
		id: number,
		update: Partial<TableCertificate>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'certificates',
			{ certificateId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
		)
	}

	async updateCommission(
		id: number,
		update: Partial<TableCommission>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'commissions',
			{ commissionId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
		)
	}

	async updateOutputBasket(
		id: number,
		update: Partial<TableOutputBasket>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'output_baskets',
			{ basketId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
		)
	}

	async updateOutput(
		id: number,
		update: Partial<TableOutput>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'outputs',
			{ outputId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
		)
	}

	async updateOutputTagMap(
		outputId: number,
		tagId: number,
		update: Partial<TableOutputTagMap>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'output_tags_map',
			{ outputId, outputTagId: tagId },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
		)
	}

	async updateOutputTag(
		id: number,
		update: Partial<TableOutputTag>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'output_tags',
			{ outputTagId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
		)
	}

	async updateProvenTxReq(
		id: number | number[],
		update: Partial<TableProvenTxReq>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		const validated = this.filterToSchema(
			'proven_tx_reqs',
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
		)
		if (Array.isArray(id)) {
			if (id.length === 0) return 0
			const setClauses: string[] = []
			const setParams: unknown[] = []
			for (const [k, v] of Object.entries(validated)) {
				if (v === undefined) continue
				setClauses.push(`${this.quoteCol(k)} = ?`)
				setParams.push(v === undefined ? null : v)
			}
			if (setClauses.length === 0) return 0
			const placeholders = id.map(() => '?').join(',')
			const sql = `UPDATE proven_tx_reqs SET ${setClauses.join(', ')} WHERE provenTxReqId IN (${placeholders})`
			this.db.run(sql, [...setParams, ...id] as (
				| string
				| number
				| null
				| Buffer
			)[])
			return (this.db.query('SELECT changes() as cnt').get() as { cnt: number })
				.cnt
		}
		if (!Number.isInteger(id))
			throw new WERR_INVALID_PARAMETER(
				'id',
				'transactionId or array of transactionId',
			)
		return this.updateRows('proven_tx_reqs', { provenTxReqId: id }, validated)
	}

	async updateProvenTx(
		id: number,
		update: Partial<TableProvenTx>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'proven_txs',
			{ provenTxId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
		)
	}

	async updateSyncState(
		id: number,
		update: Partial<TableSyncState>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'sync_states',
			{ syncStateId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				['when'],
				['init'],
			) as Record<string, unknown>,
		)
	}

	async updateTransaction(
		id: number | number[],
		update: Partial<TableTransaction>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		const validated = this.filterToSchema(
			'transactions',
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
		)
		if (Array.isArray(id)) {
			if (id.length === 0) return 0
			const setClauses: string[] = []
			const setParams: unknown[] = []
			for (const [k, v] of Object.entries(validated)) {
				if (v === undefined) continue
				setClauses.push(`${this.quoteCol(k)} = ?`)
				setParams.push(v === undefined ? null : v)
			}
			if (setClauses.length === 0) return 0
			const placeholders = id.map(() => '?').join(',')
			const sql = `UPDATE transactions SET ${setClauses.join(', ')} WHERE transactionId IN (${placeholders})`
			this.db.run(sql, [...setParams, ...id] as (
				| string
				| number
				| null
				| Buffer
			)[])
			return (this.db.query('SELECT changes() as cnt').get() as { cnt: number })
				.cnt
		}
		if (!Number.isInteger(id))
			throw new WERR_INVALID_PARAMETER(
				'id',
				'transactionId or array of transactionId',
			)
		return this.updateRows('transactions', { transactionId: id }, validated)
	}

	async updateTxLabelMap(
		transactionId: number,
		txLabelId: number,
		update: Partial<TableTxLabelMap>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'tx_labels_map',
			{ transactionId, txLabelId },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
		)
	}

	async updateTxLabel(
		id: number,
		update: Partial<TableTxLabel>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'tx_labels',
			{ txLabelId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
		)
	}

	async updateUser(
		id: number,
		update: Partial<TableUser>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'users',
			{ userId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
		)
	}

	async updateMonitorEvent(
		id: number,
		update: Partial<TableMonitorEvent>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return this.updateRows(
			'monitor_events',
			{ id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
		)
	}

	// -----------------------------------------------------------------------
	// FIND methods
	// -----------------------------------------------------------------------

	async findCertificateFields(
		args: FindCertificateFieldsArgs,
	): Promise<TableCertificateField[]> {
		return this.validateEntities(
			this.selectQuery('certificate_fields', args) as TableCertificateField[],
		)
	}

	async findCertificates(
		args: FindCertificatesArgs,
	): Promise<TableCertificateX[]> {
		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.certifiers && args.certifiers.length > 0) {
			extraWhere += `certifier IN (${args.certifiers.map(() => '?').join(',')})`
			extraParams.push(...args.certifiers)
		}
		if (args.types && args.types.length > 0) {
			const typeClause = `type IN (${args.types.map(() => '?').join(',')})`
			extraWhere = extraWhere ? `${extraWhere} AND ${typeClause}` : typeClause
			extraParams.push(...args.types)
		}

		const r = this.validateEntities(
			this.selectQuery(
				'certificates',
				args,
				extraWhere || undefined,
				extraParams.length > 0 ? extraParams : undefined,
			) as TableCertificateX[],
			undefined,
			['isDeleted'],
		)

		if (args.includeFields) {
			for (const c of r) {
				c.fields = this.validateEntities(
					await this.findCertificateFields({
						partial: { certificateId: c.certificateId, userId: c.userId },
						trx: args.trx,
					}),
				)
			}
		}
		return r
	}

	async findCommissions(args: FindCommissionsArgs): Promise<TableCommission[]> {
		if ((args.partial as Record<string, unknown>).lockingScript)
			throw new WERR_INVALID_PARAMETER(
				'partial.lockingScript',
				'undefined. Commissions may not be found by lockingScript value.',
			)
		return this.validateEntities(
			this.selectQuery('commissions', args) as TableCommission[],
			undefined,
			['isRedeemed'],
		)
	}

	async findOutputBaskets(
		args: FindOutputBasketsArgs,
	): Promise<TableOutputBasket[]> {
		return this.validateEntities(
			this.selectQuery('output_baskets', args) as TableOutputBasket[],
			undefined,
			['isDeleted'],
		)
	}

	async findOutputs(
		args: FindOutputsArgs,
		tagIds?: number[],
		isQueryModeAll?: boolean,
	): Promise<TableOutput[]> {
		if ((args.partial as Record<string, unknown>).lockingScript)
			throw new WERR_INVALID_PARAMETER(
				'args.partial.lockingScript',
				'undefined. Outputs may not be found by lockingScript value.',
			)

		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.txStatus && args.txStatus.length > 0) {
			const statusList = args.txStatus.map((s) => `'${s}'`).join(',')
			extraWhere = `(SELECT status FROM transactions WHERE transactions.transactionId = outputs.transactionId) IN (${statusList})`
		}
		const tagClause = buildOutputTagFilterSql(tagIds, isQueryModeAll)
		if (tagClause) {
			extraWhere = extraWhere ? `${extraWhere} AND ${tagClause.sql}` : tagClause.sql
			extraParams.push(...tagClause.params)
		}

		const columns = args.noScript
			? outputColumnsWithoutLockingScript.map((c) => `outputs.${c}`)
			: undefined

		const r = this.selectQuery<TableOutput>(
			'outputs',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
			columns,
		)

		if (!args.noScript) {
			for (const o of r) {
				await this.validateOutputScript(o, args.trx)
			}
		}
		return this.validateEntities(r, undefined, ['spendable', 'change'])
	}

	async findOutputTagMaps(
		args: FindOutputTagMapsArgs,
	): Promise<TableOutputTagMap[]> {
		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.tagIds && args.tagIds.length > 0) {
			extraWhere = `outputTagId IN (${args.tagIds.map(() => '?').join(',')})`
			extraParams.push(...args.tagIds)
		}
		return this.validateEntities(
			this.selectQuery(
				'output_tags_map',
				args,
				extraWhere || undefined,
				extraParams.length > 0 ? extraParams : undefined,
			) as TableOutputTagMap[],
			undefined,
			['isDeleted'],
		)
	}

	async findOutputTags(args: FindOutputTagsArgs): Promise<TableOutputTag[]> {
		return this.validateEntities(
			this.selectQuery('output_tags', args) as TableOutputTag[],
			undefined,
			['isDeleted'],
		)
	}

	async findProvenTxReqs(
		args: FindProvenTxReqsArgs,
	): Promise<TableProvenTxReq[]> {
		if ((args.partial as Record<string, unknown>).rawTx)
			throw new WERR_INVALID_PARAMETER(
				'args.partial.rawTx',
				'undefined. ProvenTxReqs may not be found by rawTx value.',
			)
		if ((args.partial as Record<string, unknown>).inputBEEF)
			throw new WERR_INVALID_PARAMETER(
				'args.partial.inputBEEF',
				'undefined. ProvenTxReqs may not be found by inputBEEF value.',
			)

		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.status && args.status.length > 0) {
			extraWhere = `status IN (${args.status.map(() => '?').join(',')})`
			extraParams.push(...args.status)
		}
		if (args.txids) {
			const txids = args.txids.filter((t) => t !== undefined)
			if (txids.length > 0) {
				const txidClause = `txid IN (${txids.map(() => '?').join(',')})`
				extraWhere = extraWhere ? `${extraWhere} AND ${txidClause}` : txidClause
				extraParams.push(...txids)
			}
		}

		return this.validateEntities(
			this.selectQuery(
				'proven_tx_reqs',
				args,
				extraWhere || undefined,
				extraParams.length > 0 ? extraParams : undefined,
			) as TableProvenTxReq[],
			undefined,
			['notified'],
		)
	}

	async findProvenTxs(args: FindProvenTxsArgs): Promise<TableProvenTx[]> {
		if ((args.partial as Record<string, unknown>).rawTx)
			throw new WERR_INVALID_PARAMETER(
				'args.partial.rawTx',
				'undefined. ProvenTxs may not be found by rawTx value.',
			)
		if ((args.partial as Record<string, unknown>).merklePath)
			throw new WERR_INVALID_PARAMETER(
				'args.partial.merklePath',
				'undefined. ProvenTxs may not be found by merklePath value.',
			)
		return this.validateEntities(
			this.selectQuery('proven_txs', args) as TableProvenTx[],
		)
	}

	async findSyncStates(args: FindSyncStatesArgs): Promise<TableSyncState[]> {
		return this.validateEntities(
			this.selectQuery('sync_states', args) as TableSyncState[],
			['when'],
			['init'],
		)
	}

	async findTransactions(
		args: FindTransactionsArgs,
		labelIds?: number[],
		isQueryModeAll?: boolean,
	): Promise<TableTransaction[]> {
		if ((args.partial as Record<string, unknown>).rawTx)
			throw new WERR_INVALID_PARAMETER(
				'args.partial.rawTx',
				'undefined. Transactions may not be found by rawTx value.',
			)
		if ((args.partial as Record<string, unknown>).inputBEEF)
			throw new WERR_INVALID_PARAMETER(
				'args.partial.inputBEEF',
				'undefined. Transactions may not be found by inputBEEF value.',
			)

		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.status && args.status.length > 0) {
			extraWhere = `status IN (${args.status.map(() => '?').join(',')})`
			extraParams.push(...args.status)
		}
		if (args.from) {
			const fromClause = 'created_at >= ?'
			extraWhere = extraWhere ? `${extraWhere} AND ${fromClause}` : fromClause
			extraParams.push(this.validateDateForWhere(args.from))
		}
		if (args.to) {
			const toClause = 'created_at < ?'
			extraWhere = extraWhere ? `${extraWhere} AND ${toClause}` : toClause
			extraParams.push(this.validateDateForWhere(args.to))
		}
		const labelClause = buildTxLabelFilterSql(labelIds, isQueryModeAll)
		if (labelClause) {
			extraWhere = extraWhere ? `${extraWhere} AND ${labelClause.sql}` : labelClause.sql
			extraParams.push(...labelClause.params)
		}

		const columns = args.noRawTx
			? transactionColumnsWithoutRawTx.map((c) => `transactions.${c}`)
			: undefined

		const r = this.selectQuery<TableTransaction>(
			'transactions',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
			columns,
		)

		if (!args.noRawTx) {
			for (const t of r) {
				await this.validateRawTransaction(t, args.trx)
			}
		}
		return this.validateEntities(r, undefined, ['isOutgoing'])
	}

	async findTxLabelMaps(args: FindTxLabelMapsArgs): Promise<TableTxLabelMap[]> {
		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.labelIds && args.labelIds.length > 0) {
			extraWhere = `txLabelId IN (${args.labelIds.map(() => '?').join(',')})`
			extraParams.push(...args.labelIds)
		}
		return this.validateEntities(
			this.selectQuery(
				'tx_labels_map',
				args,
				extraWhere || undefined,
				extraParams.length > 0 ? extraParams : undefined,
			) as TableTxLabelMap[],
			undefined,
			['isDeleted'],
		)
	}

	async findTxLabels(args: FindTxLabelsArgs): Promise<TableTxLabel[]> {
		return this.validateEntities(
			this.selectQuery('tx_labels', args) as TableTxLabel[],
			undefined,
			['isDeleted'],
		)
	}

	async findUsers(args: FindUsersArgs): Promise<TableUser[]> {
		return this.validateEntities(this.selectQuery('users', args) as TableUser[])
	}

	/**
	 * SQL-backed implementation of the shared StorageProvider helper. Replaces
	 * the base class fallback (which loads every output into memory and scans
	 * in JS) with a single JOIN + GROUP BY that returns the top-N users by
	 * most-recent output creation time. Matches Knex canon at
	 * StorageKnex.ts:796.
	 */
	async recentlyActiveUsers(limit = 50, trx?: TrxToken): Promise<TableUser[]> {
		void trx // BunSqlite SAVEPOINT shares one connection; trx not required on the raw query
		const rows = this.allSql<TableUser>(
			`SELECT u.*
			FROM users u
			JOIN (
				SELECT userId, MAX(created_at) AS lastOutputCreatedAt
				FROM outputs
				GROUP BY userId
			) latest ON u.userId = latest.userId
			ORDER BY latest.lastOutputCreatedAt DESC
			LIMIT ?`,
			[limit],
		)
		return this.validateEntities(rows)
	}

	async findMonitorEvents(
		args: FindMonitorEventsArgs,
	): Promise<TableMonitorEvent[]> {
		return this.validateEntities(
			this.selectQuery('monitor_events', args) as TableMonitorEvent[],
			['when'],
			undefined,
		)
	}

	// -----------------------------------------------------------------------
	// COUNT methods
	// -----------------------------------------------------------------------

	async countCertificateFields(
		args: FindCertificateFieldsArgs,
	): Promise<number> {
		return this.countQuery('certificate_fields', args)
	}
	async countCertificates(args: FindCertificatesArgs): Promise<number> {
		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.certifiers && args.certifiers.length > 0) {
			extraWhere += `certifier IN (${args.certifiers.map(() => '?').join(',')})`
			extraParams.push(...args.certifiers)
		}
		if (args.types && args.types.length > 0) {
			const typeClause = `type IN (${args.types.map(() => '?').join(',')})`
			extraWhere = extraWhere ? `${extraWhere} AND ${typeClause}` : typeClause
			extraParams.push(...args.types)
		}
		return this.countQuery(
			'certificates',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
		)
	}
	async countCommissions(args: FindCommissionsArgs): Promise<number> {
		return this.countQuery('commissions', args)
	}
	async countOutputBaskets(args: FindOutputBasketsArgs): Promise<number> {
		return this.countQuery('output_baskets', args)
	}
	async countOutputs(
		args: FindOutputsArgs,
		tagIds?: number[],
		isQueryModeAll?: boolean,
	): Promise<number> {
		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.txStatus && args.txStatus.length > 0) {
			const statusList = args.txStatus.map((s) => `'${s}'`).join(',')
			extraWhere = `(SELECT status FROM transactions WHERE transactions.transactionId = outputs.transactionId) IN (${statusList})`
		}
		const tagClause = buildOutputTagFilterSql(tagIds, isQueryModeAll)
		if (tagClause) {
			extraWhere = extraWhere ? `${extraWhere} AND ${tagClause.sql}` : tagClause.sql
			extraParams.push(...tagClause.params)
		}
		return this.countQuery(
			'outputs',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
		)
	}
	async countOutputTagMaps(args: FindOutputTagMapsArgs): Promise<number> {
		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.tagIds && args.tagIds.length > 0) {
			extraWhere = `outputTagId IN (${args.tagIds.map(() => '?').join(',')})`
			extraParams.push(...args.tagIds)
		}
		return this.countQuery(
			'output_tags_map',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
		)
	}
	async countOutputTags(args: FindOutputTagsArgs): Promise<number> {
		return this.countQuery('output_tags', args)
	}
	async countProvenTxReqs(args: FindProvenTxReqsArgs): Promise<number> {
		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.status && args.status.length > 0) {
			extraWhere = `status IN (${args.status.map(() => '?').join(',')})`
			extraParams.push(...args.status)
		}
		if (args.txids) {
			const txids = args.txids.filter((t) => t !== undefined)
			if (txids.length > 0) {
				const txidClause = `txid IN (${txids.map(() => '?').join(',')})`
				extraWhere = extraWhere ? `${extraWhere} AND ${txidClause}` : txidClause
				extraParams.push(...txids)
			}
		}
		return this.countQuery(
			'proven_tx_reqs',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
		)
	}
	async countProvenTxs(args: FindProvenTxsArgs): Promise<number> {
		return this.countQuery('proven_txs', args)
	}
	async countSyncStates(args: FindSyncStatesArgs): Promise<number> {
		return this.countQuery('sync_states', args)
	}
	async countTransactions(
		args: FindTransactionsArgs,
		labelIds?: number[],
		isQueryModeAll?: boolean,
	): Promise<number> {
		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.status && args.status.length > 0) {
			extraWhere = `status IN (${args.status.map(() => '?').join(',')})`
			extraParams.push(...args.status)
		}
		if (args.from) {
			const c = 'created_at >= ?'
			extraWhere = extraWhere ? `${extraWhere} AND ${c}` : c
			extraParams.push(this.validateDateForWhere(args.from))
		}
		if (args.to) {
			const c = 'created_at < ?'
			extraWhere = extraWhere ? `${extraWhere} AND ${c}` : c
			extraParams.push(this.validateDateForWhere(args.to))
		}
		const labelClause = buildTxLabelFilterSql(labelIds, isQueryModeAll)
		if (labelClause) {
			extraWhere = extraWhere ? `${extraWhere} AND ${labelClause.sql}` : labelClause.sql
			extraParams.push(...labelClause.params)
		}
		return this.countQuery(
			'transactions',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
		)
	}
	async countTxLabelMaps(args: FindTxLabelMapsArgs): Promise<number> {
		let extraWhere = ''
		const extraParams: unknown[] = []
		if (args.labelIds && args.labelIds.length > 0) {
			extraWhere = `txLabelId IN (${args.labelIds.map(() => '?').join(',')})`
			extraParams.push(...args.labelIds)
		}
		return this.countQuery(
			'tx_labels_map',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
		)
	}
	async countTxLabels(args: FindTxLabelsArgs): Promise<number> {
		return this.countQuery('tx_labels', args)
	}
	async countUsers(args: FindUsersArgs): Promise<number> {
		return this.countQuery('users', args)
	}
	async countMonitorEvents(args: FindMonitorEventsArgs): Promise<number> {
		return this.countQuery('monitor_events', args)
	}
	async countChangeInputs(
		userId: number,
		basketId: number,
		excludeSending: boolean,
	): Promise<number> {
		const status = ['completed', 'unproven']
		if (!excludeSending) status.push('sending')
		const statusText = status.map((s) => `'${s}'`).join(',')
		const txStatusCondition = `(SELECT status FROM transactions WHERE outputs.transactionId = transactions.transactionId) IN (${statusText})`
		const row = this.getSql<{ cnt: number }>(
			`SELECT COUNT(*) as cnt FROM outputs WHERE userId = ? AND spendable = 1 AND basketId = ? AND ${txStatusCondition}`,
			[userId, basketId],
		)
		return row?.cnt ?? 0
	}

	// -----------------------------------------------------------------------
	// Auth-gated find methods
	// -----------------------------------------------------------------------

	async findCertificatesAuth(
		auth: AuthId,
		args: FindCertificatesArgs,
	): Promise<TableCertificateX[]> {
		if (
			!auth.userId ||
			((args.partial as Record<string, unknown>).userId &&
				(args.partial as Record<string, unknown>).userId !== auth.userId)
		)
			throw new WERR_UNAUTHORIZED()
		;(args.partial as Record<string, unknown>).userId = auth.userId
		return await this.findCertificates(args)
	}

	async findOutputBasketsAuth(
		auth: AuthId,
		args: FindOutputBasketsArgs,
	): Promise<TableOutputBasket[]> {
		if (
			!auth.userId ||
			((args.partial as Record<string, unknown>).userId &&
				(args.partial as Record<string, unknown>).userId !== auth.userId)
		)
			throw new WERR_UNAUTHORIZED()
		;(args.partial as Record<string, unknown>).userId = auth.userId
		return await this.findOutputBaskets(args)
	}

	async findOutputsAuth(
		auth: AuthId,
		args: FindOutputsArgs,
	): Promise<TableOutput[]> {
		if (
			!auth.userId ||
			((args.partial as Record<string, unknown>).userId &&
				(args.partial as Record<string, unknown>).userId !== auth.userId)
		)
			throw new WERR_UNAUTHORIZED()
		;(args.partial as Record<string, unknown>).userId = auth.userId
		return await this.findOutputs(args)
	}

	// -----------------------------------------------------------------------
	// Label / Tag helpers
	// -----------------------------------------------------------------------

	async getLabelsForTransactionId(
		transactionId?: number,
		_trx?: TrxToken,
	): Promise<TableTxLabel[]> {
		if (transactionId === undefined) return []
		const rows = this.allSql(
			`SELECT tx_labels.* FROM tx_labels
			 JOIN tx_labels_map ON tx_labels_map.txLabelId = tx_labels.txLabelId
			 WHERE tx_labels_map.transactionId = ? AND tx_labels_map.isDeleted != 1 AND tx_labels.isDeleted != 1`,
			[transactionId],
		)
		return this.validateEntities(rows as unknown as TableTxLabel[], undefined, [
			'isDeleted',
		])
	}

	async getTagsForOutputId(
		outputId: number,
		_trx?: TrxToken,
	): Promise<TableOutputTag[]> {
		const rows = this.allSql(
			`SELECT output_tags.* FROM output_tags
			 JOIN output_tags_map ON output_tags_map.outputTagId = output_tags.outputTagId
			 WHERE output_tags_map.outputId = ? AND output_tags_map.isDeleted != 1 AND output_tags.isDeleted != 1`,
			[outputId],
		)
		return this.validateEntities(
			rows as unknown as TableOutputTag[],
			undefined,
			['isDeleted'],
		)
	}

	// -----------------------------------------------------------------------
	// allocateChangeInput
	// -----------------------------------------------------------------------

	async allocateChangeInput(
		userId: number,
		basketId: number,
		targetSatoshis: number,
		exactSatoshis: number | undefined,
		excludeSending: boolean,
		transactionId: number,
	): Promise<TableOutput | undefined> {
		const status = ['completed', 'unproven']
		if (!excludeSending) status.push('sending')
		const statusText = status.map((s) => `'${s}'`).join(',')
		const txStatusCondition = `AND (SELECT status FROM transactions WHERE outputs.transactionId = transactions.transactionId) IN (${statusText})`

		const r = await this.transaction(async (trx) => {
			let outputId: number | undefined

			const setOutputId = (rawQuery: string): void => {
				const row = this.getSql<{ outputId: number }>(rawQuery)
				outputId = row?.outputId
			}

			if (exactSatoshis !== undefined) {
				setOutputId(`
					SELECT outputId FROM outputs
					WHERE userId = ${userId} AND spendable = 1 AND basketId = ${basketId}
					${txStatusCondition} AND satoshis = ${exactSatoshis}
					LIMIT 1
				`)
			}

			if (outputId === undefined) {
				setOutputId(`
					SELECT outputId FROM outputs
					WHERE userId = ${userId} AND spendable = 1 AND basketId = ${basketId}
					${txStatusCondition}
					AND satoshis - ${targetSatoshis} = (
						SELECT MIN(satoshis - ${targetSatoshis}) FROM outputs
						WHERE userId = ${userId} AND spendable = 1 AND basketId = ${basketId}
						${txStatusCondition} AND satoshis - ${targetSatoshis} >= 0
					)
					LIMIT 1
				`)
			}

			if (outputId === undefined) {
				setOutputId(`
					SELECT outputId FROM outputs
					WHERE userId = ${userId} AND spendable = 1 AND basketId = ${basketId}
					${txStatusCondition}
					AND satoshis - ${targetSatoshis} = (
						SELECT MAX(satoshis - ${targetSatoshis}) FROM outputs
						WHERE userId = ${userId} AND spendable = 1 AND basketId = ${basketId}
						${txStatusCondition} AND satoshis - ${targetSatoshis} < 0
					)
					LIMIT 1
				`)
			}

			if (outputId === undefined) return undefined

			await this.updateOutput(
				outputId,
				{ spendable: false, spentBy: transactionId } as Partial<TableOutput>,
				trx,
			)
			const output = verifyTruthy(await this.findOutputById(outputId, trx))
			// Hydrate locking script if it was offloaded into rawTx storage due to
			// exceeding maxOutputScript. Matches Knex canon at StorageKnex.ts:1285;
			// a no-op when the script is already present on the row.
			await this.validateOutputScript(output, trx)
			return output
		})

		return r
	}

	// -----------------------------------------------------------------------
	// validateRawTransaction
	// -----------------------------------------------------------------------

	async validateRawTransaction(
		t: TableTransaction,
		trx?: TrxToken,
	): Promise<void> {
		if ((t as unknown as Record<string, unknown>).rawTx || !t.txid) return
		const rawTx = await this.getRawTxOfKnownValidTransaction(
			t.txid,
			undefined,
			undefined,
			trx,
		)
		if (!rawTx) return
		;(t as unknown as Record<string, unknown>).rawTx = rawTx
	}

	// -----------------------------------------------------------------------
	// listActions
	// -----------------------------------------------------------------------

	async listActions(
		auth: AuthId,
		vargs: Validation.ValidListActionsArgs,
	): Promise<ListActionsResult> {
		if (!auth.userId) throw new WERR_UNAUTHORIZED()

		const limit = vargs.limit
		const offset = vargs.offset

		const r: ListActionsResult = { totalActions: 0, actions: [] }

		const {
			from: actionTimeFrom,
			to: actionTimeTo,
			timeFilterRequested,
			remainingLabels: ordinaryLabelsPreSpecOp,
		} = parseBrc114ActionTimeLabels(vargs.labels)

		const createdAtFrom =
			actionTimeFrom !== undefined ? new Date(actionTimeFrom) : undefined
		const createdAtTo =
			actionTimeTo !== undefined ? new Date(actionTimeTo) : undefined

		let specOp: ReturnType<typeof getLabelToSpecOp>[string] | undefined =
			undefined
		let specOpLabels: string[] = []
		let labels: string[] = []

		for (const label of ordinaryLabelsPreSpecOp) {
			if (isListActionsSpecOp(label)) {
				specOp = getLabelToSpecOp()[label]
			} else {
				labels.push(label)
			}
		}

		if (specOp?.labelsToIntercept !== undefined) {
			const intercept = specOp.labelsToIntercept
			const labels2 = labels
			labels = []
			if (intercept.length === 0) {
				specOpLabels = labels2
			}
			for (const label of labels2) {
				if (intercept.indexOf(label) >= 0) {
					specOpLabels.push(label)
				} else {
					labels.push(label)
				}
			}
		}

		let labelIds: number[] = []
		if (labels.length > 0) {
			const placeholders = labels.map(() => '?').join(',')
			const rows = this.allSql<{ txLabelId: number }>(
				`SELECT txLabelId FROM tx_labels WHERE userId = ? AND isDeleted = 0 AND txLabelId IS NOT NULL AND label IN (${placeholders})`,
				[auth.userId, ...labels],
			)
			labelIds = rows.map((r) => r.txLabelId)
		}

		const isQueryModeAll = vargs.labelQueryMode === 'all'
		if (isQueryModeAll && labelIds.length < labels.length) return r
		if (!isQueryModeAll && labelIds.length === 0 && labels.length > 0) return r

		const columns = [
			'created_at',
			'transactionId',
			'reference',
			'txid',
			'satoshis',
			'status',
			'isOutgoing',
			'description',
			'version',
			'lockTime',
		]

		const stati = specOp?.setStatusFilter
			? specOp.setStatusFilter()
			: [
					'completed',
					'unprocessed',
					'sending',
					'unproven',
					'unsigned',
					'nosend',
					'nonfinal',
				]
		const statusText = stati.map((s: string) => `'${s}'`).join(',')

		const noLabels = labelIds.length === 0

		const buildTimestampFilter = (): { clause: string; params: unknown[] } => {
			if (!timeFilterRequested) return { clause: '', params: [] }
			const parts: string[] = ['created_at IS NOT NULL']
			const params: unknown[] = []
			if (createdAtFrom) {
				parts.push('created_at >= ?')
				params.push(this.validateDateForWhere(createdAtFrom))
			}
			if (createdAtTo) {
				parts.push('created_at < ?')
				params.push(this.validateDateForWhere(createdAtTo))
			}
			return { clause: parts.join(' AND '), params }
		}

		let txs: Record<string, unknown>[]
		let totalActions: number

		if (noLabels) {
			// No label filtering
			const tsFilter = buildTimestampFilter()
			const whereParts = ['userId = ?', `status IN (${statusText})`]
			const params: unknown[] = [auth.userId]
			if (tsFilter.clause) {
				whereParts.push(tsFilter.clause)
				params.push(...tsFilter.params)
			}
			const whereStr = whereParts.join(' AND ')

			const countRow = this.getSql<{ total: number }>(
				`SELECT COUNT(transactionId) as total FROM transactions WHERE ${whereStr}`,
				params,
			)
			totalActions = countRow?.total ?? 0

			txs = this.allSql(
				`SELECT ${columns.join(',')} FROM transactions WHERE ${whereStr} ORDER BY transactionId ASC LIMIT ? OFFSET ?`,
				[...params, limit, offset],
			)
		} else {
			// Label filtering via CTE
			const labelIdList = labelIds.join(',')
			const tsFilter = buildTimestampFilter()

			// Build CTE: get transactions with label counts
			const cteSql = `
				SELECT ${columns.map((c) => `t.${c}`).join(',')},
					(SELECT COUNT(*) FROM tx_labels_map AS m
					 WHERE m.transactionId = t.transactionId AND m.txLabelId IN (${labelIdList})) AS lc
				FROM transactions AS t
				WHERE t.userId = ? AND t.status IN (${statusText})
			`
			const cteParams: unknown[] = [auth.userId]

			const filterParts: string[] = []
			if (isQueryModeAll) filterParts.push(`lc = ${labelIds.length}`)
			else filterParts.push('lc > 0')

			if (tsFilter.clause) {
				filterParts.push(tsFilter.clause)
				cteParams.push(...tsFilter.params)
			}

			const filterStr = filterParts.join(' AND ')

			const countRow = this.getSql<{ total: number }>(
				`WITH tlc AS (${cteSql}) SELECT COUNT(transactionId) as total FROM tlc WHERE ${filterStr}`,
				cteParams,
			)
			totalActions = countRow?.total ?? 0

			txs = this.allSql(
				`WITH tlc AS (${cteSql}) SELECT ${columns.join(',')} FROM tlc WHERE ${filterStr} ORDER BY transactionId ASC LIMIT ? OFFSET ?`,
				[...cteParams, limit, offset],
			)
		}

		if (specOp?.postProcess) {
			await specOp.postProcess(this, auth, vargs, specOpLabels, txs)
		}

		if (!limit) r.totalActions = txs.length
		else if (txs.length < limit) r.totalActions = (offset || 0) + txs.length
		else r.totalActions = totalActions

		for (const tx of txs) {
			r.actions.push({
				txid: (tx.txid as string) || '',
				satoshis: (tx.satoshis as number) || 0,
				status: tx.status as string,
				isOutgoing: !!tx.isOutgoing,
				description: (tx.description as string) || '',
				version: (tx.version as number) || 0,
				lockTime: (tx.lockTime as number) || 0,
			} as ListActionsResult['actions'][number])
		}

		if (vargs.includeLabels || vargs.includeInputs || vargs.includeOutputs) {
			await Promise.all(
				txs.map(async (tx, i) => {
					const action = r.actions[i] as unknown as Record<string, unknown>
					if (vargs.includeLabels) {
						action.labels = (
							await this.getLabelsForTransactionId(tx.transactionId as number)
						).map((l) => l.label)
						const reference = tx.reference as string | undefined
						if (reference != null && reference !== '') {
							action.labels = applyBrc153ReferenceLabel(
								action.labels as string[],
								reference,
							)
						}
						if (timeFilterRequested) {
							const ts = tx.created_at
								? new Date(tx.created_at as string).getTime()
								: Number.NaN
							if (!Number.isNaN(ts)) {
								const timeLabel = makeBrc114ActionTimeLabel(ts)
								if (!(action.labels as string[]).includes(timeLabel))
									(action.labels as string[]).push(timeLabel)
							}
						}
					}
					if (vargs.includeOutputs) {
						const outputs = await this.findOutputs({
							partial: { transactionId: tx.transactionId as number },
							noScript: !vargs.includeOutputLockingScripts,
						})
						action.outputs = []
						for (const o of outputs) {
							await this.extendOutput(o, true, true)
							const ox = o as unknown as Record<string, unknown>
							const wo: Record<string, unknown> = {
								satoshis: o.satoshis || 0,
								spendable: !!o.spendable,
								tags: (ox.tags as { tag: string }[])?.map((t) => t.tag) || [],
								outputIndex: Number(o.vout),
								outputDescription: o.outputDescription || '',
								basket: (ox.basket as { name: string })?.name || '',
							}
							if (vargs.includeOutputLockingScripts)
								wo.lockingScript = asString(o.lockingScript || [])
							;(action.outputs as unknown[]).push(wo)
						}
					}
					if (vargs.includeInputs) {
						const inputs = await this.findOutputs({
							partial: { spentBy: tx.transactionId as number },
							noScript: !vargs.includeInputSourceLockingScripts,
						})
						action.inputs = []
						if (inputs.length > 0) {
							const rawTx = await this.getRawTxOfKnownValidTransaction(
								tx.txid as string,
							)
							let bsvTx: BsvTransaction | undefined = undefined
							if (rawTx) bsvTx = BsvTransaction.fromBinary(rawTx)
							for (const o of inputs) {
								await this.extendOutput(o, true, true)
								const input = bsvTx?.inputs.find(
									(v) =>
										v.sourceTXID === o.txid && v.sourceOutputIndex === o.vout,
								)
								const wo: Record<string, unknown> = {
									sourceOutpoint: `${o.txid}.${o.vout}`,
									sourceSatoshis: o.satoshis || 0,
									inputDescription: o.outputDescription || '',
									sequenceNumber: input?.sequence || 0,
								}
								;(action.inputs as unknown[]).push(wo)
								if (vargs.includeInputSourceLockingScripts) {
									wo.sourceLockingScript = asString(o.lockingScript || [])
								}
								if (vargs.includeInputUnlockingScripts) {
									wo.unlockingScript = input?.unlockingScript?.toHex()
								}
							}
						}
					}
				}),
			)
		}

		return r
	}

	// -----------------------------------------------------------------------
	// listOutputs
	// -----------------------------------------------------------------------

	async listOutputs(
		auth: AuthId,
		vargs: Validation.ValidListOutputsArgs,
	): Promise<ListOutputsResult> {
		if (!auth.userId) throw new WERR_UNAUTHORIZED()

		const trx = undefined
		const userId = verifyId(auth.userId)
		const limit = vargs.limit
		let offset = vargs.offset
		let orderBy = 'ASC'
		if (offset < 0) {
			offset = -offset - 1
			orderBy = 'DESC'
		}

		const r: ListOutputsResult = { totalOutputs: 0, outputs: [] }

		let { specOp, basket, tags } = getListOutputsSpecOp(
			vargs.basket,
			vargs.tags,
		)
		let basketId: number | undefined = undefined
		const basketsById: Record<number, TableOutputBasket> = {}

		if (basket) {
			const baskets = await this.findOutputBaskets({
				partial: { userId, name: basket },
				trx,
			})
			if (baskets.length !== 1) return r
			basketId = baskets[0].basketId
			basketsById[basketId] = baskets[0]
		}

		let tagIds: number[] = []
		const specOpTags: string[] = []
		if (specOp?.tagsParamsCount) {
			specOpTags.push(
				...tags.splice(0, Math.min(tags.length, specOp.tagsParamsCount)),
			)
		}
		if (specOp?.tagsToIntercept) {
			const ts = tags
			tags = []
			for (const t of ts) {
				if (
					specOp.tagsToIntercept.length === 0 ||
					specOp.tagsToIntercept.indexOf(t) >= 0
				) {
					specOpTags.push(t)
					if (t === 'all') basketId = undefined
				} else {
					tags.push(t)
				}
			}
		}

		if (specOp?.resultFromTags) {
			return await specOp.resultFromTags(this, auth, vargs, specOpTags)
		}

		if (tags && tags.length > 0) {
			const placeholders = tags.map(() => '?').join(',')
			const rows = this.allSql<{ outputTagId: number }>(
				`SELECT outputTagId FROM output_tags WHERE userId = ? AND isDeleted = 0 AND outputTagId IS NOT NULL AND tag IN (${placeholders})`,
				[userId, ...tags],
			)
			tagIds = rows.map((r) => r.outputTagId)
		}

		const isQueryModeAll = vargs.tagQueryMode === 'all'
		if (isQueryModeAll && tagIds.length < tags.length) return r
		if (!isQueryModeAll && tagIds.length === 0 && tags.length > 0) return r

		let columns = [
			'outputId',
			'transactionId',
			'basketId',
			'spendable',
			'txid',
			'vout',
			'satoshis',
			'customInstructions',
			'outputDescription',
			'spendingDescription',
		]
		if (vargs.includeLockingScripts || specOp?.includeOutputScripts)
			columns = [...columns, 'lockingScript', 'scriptLength', 'scriptOffset']

		const noTags = tagIds.length === 0
		const includeSpent = specOp?.includeSpent ? specOp.includeSpent : false
		const txStatusOk = `(SELECT status FROM transactions WHERE transactions.transactionId = outputs.transactionId) IN ('completed','unproven','nosend','sending')`

		if (specOp?.totalOutputsIsSumOfSatoshis) {
			if (noTags) {
				const whereParts = ['userId = ?']
				const params: unknown[] = [userId]
				if (basketId) {
					whereParts.push('basketId = ?')
					params.push(basketId)
				}
				if (!includeSpent) {
					whereParts.push('spendable = 1')
				}
				whereParts.push(txStatusOk)
				const row = this.getSql<{ totalSatoshis: number }>(
					`SELECT SUM(satoshis) as totalSatoshis FROM outputs WHERE ${whereParts.join(' AND ')}`,
					params,
				)
				r.totalOutputs = Number(row?.totalSatoshis ?? 0)
				return r
			}
			const tagIdList = tagIds.join(',')
			let cteOpts = ''
			const params: unknown[] = [userId]
			if (basketId) {
				cteOpts += ' AND o.basketId = ?'
				params.push(basketId)
			}
			if (!includeSpent) cteOpts += ' AND o.spendable = 1'
			const txStatusOkCte = `(SELECT status FROM transactions WHERE transactions.transactionId = o.transactionId) IN ('completed','unproven','nosend','sending')`
			const cteSql = `
					SELECT o.satoshis,
						(SELECT COUNT(*) FROM output_tags_map AS m WHERE m.outputId = o.outputId AND m.outputTagId IN (${tagIdList})) AS tc
					FROM outputs AS o
					WHERE o.userId = ?${cteOpts} AND ${txStatusOkCte}
				`
			const filterStr = isQueryModeAll ? `tc = ${tagIds.length}` : 'tc > 0'
			const row = this.getSql<{ totalSatoshis: number }>(
				`WITH otc AS (${cteSql}) SELECT SUM(satoshis) as totalSatoshis FROM otc WHERE ${filterStr}`,
				params,
			)
			r.totalOutputs = Number(row?.totalSatoshis ?? 0)
			return r
		}

		let outputs: Record<string, unknown>[]
		let totalCount: number

		if (noTags) {
			const whereParts = ['userId = ?']
			const params: unknown[] = [userId]
			if (basketId) {
				whereParts.push('basketId = ?')
				params.push(basketId)
			}
			if (!includeSpent) whereParts.push('spendable = 1')
			whereParts.push(txStatusOk)
			const whereStr = whereParts.join(' AND ')

			if (!specOp || !specOp.ignoreLimit) {
				outputs = this.allSql(
					`SELECT ${columns.join(',')} FROM outputs WHERE ${whereStr} ORDER BY outputId ${orderBy} LIMIT ? OFFSET ?`,
					[...params, limit, offset],
				)
			} else {
				outputs = this.allSql(
					`SELECT ${columns.join(',')} FROM outputs WHERE ${whereStr} ORDER BY outputId ${orderBy}`,
					params,
				)
			}

			// Gate the COUNT query: only run it when the result may have been truncated
			// by LIMIT. Mirrors Knex canon's gating in listOutputsKnex.ts.
			if (limit && outputs.length >= limit) {
				const countRow = this.getSql<{ total: number }>(
					`SELECT COUNT(outputId) as total FROM outputs WHERE ${whereStr}`,
					params,
				)
				totalCount = countRow?.total ?? 0
			} else {
				totalCount = outputs.length
			}
		} else {
			const tagIdList = tagIds.join(',')
			let cteOpts = ''
			const params: unknown[] = [userId]
			if (basketId) {
				cteOpts += ' AND o.basketId = ?'
				params.push(basketId)
			}
			if (!includeSpent) cteOpts += ' AND o.spendable'
			const txStatusOkCte = `(SELECT status FROM transactions WHERE transactions.transactionId = o.transactionId) IN ('completed','unproven','nosend','sending')`

			const cteSql = `
				SELECT ${columns.map((c) => `o.${c}`).join(',')},
					(SELECT COUNT(*) FROM output_tags_map AS m WHERE m.outputId = o.outputId AND m.outputTagId IN (${tagIdList})) AS tc
				FROM outputs AS o
				WHERE o.userId = ?${cteOpts} AND ${txStatusOkCte}
			`
			const filterStr = isQueryModeAll ? `tc = ${tagIds.length}` : 'tc > 0'

			if (!specOp || !specOp.ignoreLimit) {
				outputs = this.allSql(
					`WITH otc AS (${cteSql}) SELECT ${columns.join(',')} FROM otc WHERE ${filterStr} ORDER BY outputId ${orderBy} LIMIT ? OFFSET ?`,
					[...params, limit, offset],
				)
			} else {
				outputs = this.allSql(
					`WITH otc AS (${cteSql}) SELECT ${columns.join(',')} FROM otc WHERE ${filterStr} ORDER BY outputId ${orderBy}`,
					params,
				)
			}

			// Gate the COUNT query: only needed when the SELECT may have been truncated.
			if (limit && outputs.length >= limit) {
				const countRow = this.getSql<{ total: number }>(
					`WITH otc AS (${cteSql}) SELECT COUNT(outputId) as total FROM otc WHERE ${filterStr}`,
					params,
				)
				totalCount = countRow?.total ?? 0
			} else {
				totalCount = outputs.length
			}
		}

		if (specOp) {
			if (specOp.filterOutputs)
				outputs = (await specOp.filterOutputs(
					this,
					auth,
					vargs,
					specOpTags,
					outputs as unknown as TableOutput[],
				)) as unknown as Record<string, unknown>[]
			if (specOp.resultFromOutputs)
				return await specOp.resultFromOutputs(
					this,
					auth,
					vargs,
					specOpTags,
					outputs as unknown as TableOutput[],
				)
		}

		if (!limit || outputs.length < limit) r.totalOutputs = outputs.length
		else r.totalOutputs = totalCount

		const labelsByTxid: Record<string, string[]> = {}
		const beef = new Beef()

		for (const o of outputs) {
			const wo: Record<string, unknown> = {
				satoshis: Number(o.satoshis),
				spendable: !!o.spendable,
				outpoint: `${o.txid}.${o.vout}`,
			}
			r.outputs.push(wo as unknown as ListOutputsResult['outputs'][number])

			if (vargs.includeCustomInstructions && o.customInstructions)
				wo.customInstructions = o.customInstructions
			if (vargs.includeLabels && o.txid) {
				const txid = o.txid as string
				if (labelsByTxid[txid] === undefined) {
					labelsByTxid[txid] = (
						await this.getLabelsForTransactionId(o.transactionId as number, trx)
					).map((l) => l.label)
				}
				wo.labels = labelsByTxid[txid]
			}
			if (vargs.includeTags) {
				wo.tags = (
					await this.getTagsForOutputId(o.outputId as number, trx)
				).map((t) => t.tag)
			}
			if (vargs.includeLockingScripts) {
				await this.validateOutputScript(o as unknown as TableOutput, trx)
				if (o.lockingScript)
					wo.lockingScript = asString(o.lockingScript as number[])
			}
			if (vargs.includeTransactions && !beef.findTxid(o.txid as string)) {
				await this.getValidBeefForKnownTxid(
					o.txid as string,
					beef as never,
					undefined,
					vargs.knownTxids,
					trx,
				)
			}
		}

		if (vargs.includeTransactions) {
			r.BEEF = beef.toBinary()
		}

		return r
	}

	// -----------------------------------------------------------------------
	// purgeData
	// -----------------------------------------------------------------------

	async purgeData(params: PurgeParams, _trx?: TrxToken): Promise<PurgeResults> {
		const r: PurgeResults = { count: 0, log: '' }
		const defaultAge = 1000 * 60 * 60 * 24 * 14

		const toSqlWhereDate = (d: Date): string =>
			d.toISOString().replace('T', ' ').replace('Z', '')

		if (params.purgeCompleted) {
			const age = params.purgeCompletedAge || defaultAge
			const before = toSqlWhereDate(new Date(Date.now() - age))

			// Purge completed transactions of transient data
			this.db.run(
				`UPDATE transactions SET inputBEEF = NULL, rawTx = NULL
				 WHERE updated_at < ? AND status = 'completed' AND provenTxId IS NOT NULL
				 AND (inputBEEF IS NOT NULL OR rawTx IS NOT NULL)`,
				[before],
			)
			let cnt = (
				this.db.query('SELECT changes() as cnt').get() as { cnt: number }
			).cnt
			if (cnt > 0) {
				r.count += cnt
				r.log += `${cnt} completed transactions purged of transient data\n`
			}

			// Delete completed proven_tx_reqs
			const completedReqs = this.allSql<{ provenTxReqId: number }>(
				`SELECT provenTxReqId FROM proven_tx_reqs
				 WHERE updated_at < ? AND status = 'completed' AND provenTxId IS NOT NULL AND notified = 1`,
				[before],
			)
			if (completedReqs.length > 0) {
				const ids = completedReqs.map((r) => r.provenTxReqId)
				const placeholders = ids.map(() => '?').join(',')
				this.db.run(
					`DELETE FROM proven_tx_reqs WHERE provenTxReqId IN (${placeholders})`,
					ids as number[],
				)
				cnt = (
					this.db.query('SELECT changes() as cnt').get() as { cnt: number }
				).cnt
				if (cnt > 0) {
					r.count += cnt
					r.log += `${cnt} completed proven_tx_reqs deleted\n`
				}
			}
		}

		if (params.purgeFailed) {
			const age = params.purgeFailedAge || defaultAge
			const before = toSqlWhereDate(new Date(Date.now() - age))

			const failedTxs = this.allSql<{ transactionId: number }>(
				`SELECT transactionId FROM transactions WHERE updated_at < ? AND status = 'failed'`,
				[before],
			)
			const failedTxIds = failedTxs.map((t) => t.transactionId)
			if (failedTxIds.length > 0) {
				this.deleteTransactions(failedTxIds, r, 'failed', true)
			}

			// Invalid reqs
			const invalidReqs = this.allSql<{ provenTxReqId: number }>(
				`SELECT provenTxReqId FROM proven_tx_reqs WHERE updated_at < ? AND status = 'invalid'`,
				[before],
			)
			if (invalidReqs.length > 0) {
				const ids = invalidReqs.map((r) => r.provenTxReqId)
				const placeholders = ids.map(() => '?').join(',')
				this.db.run(
					`DELETE FROM proven_tx_reqs WHERE provenTxReqId IN (${placeholders})`,
					ids as number[],
				)
				const cnt = (
					this.db.query('SELECT changes() as cnt').get() as { cnt: number }
				).cnt
				if (cnt > 0) {
					r.count += cnt
					r.log += `${cnt} invalid proven_tx_reqs deleted\n`
				}
			}

			// Double spend reqs
			const dsReqs = this.allSql<{ provenTxReqId: number }>(
				`SELECT provenTxReqId FROM proven_tx_reqs WHERE updated_at < ? AND status = 'doubleSpend'`,
				[before],
			)
			if (dsReqs.length > 0) {
				const ids = dsReqs.map((r) => r.provenTxReqId)
				const placeholders = ids.map(() => '?').join(',')
				this.db.run(
					`DELETE FROM proven_tx_reqs WHERE provenTxReqId IN (${placeholders})`,
					ids as number[],
				)
				const cnt = (
					this.db.query('SELECT changes() as cnt').get() as { cnt: number }
				).cnt
				if (cnt > 0) {
					r.count += cnt
					r.log += `${cnt} doubleSpend proven_tx_reqs deleted\n`
				}
			}
		}

		if (params.purgeSpent) {
			const age = params.purgeSpentAge || defaultAge
			const before = toSqlWhereDate(new Date(Date.now() - age))

			const beef = new Beef()
			const utxos = await this.findOutputs({
				partial: { spendable: true },
				txStatus: ['sending', 'unproven', 'completed', 'nosend'],
			})
			for (const utxo of utxos) {
				const options = { mergeToBeef: beef as never, ignoreServices: true }
				if (utxo.txid) await this.getBeefForTransaction(utxo.txid, options)
			}
			const proofTxids: Record<string, boolean> = {}
			for (const btx of beef.txs) proofTxids[btx.txid] = true

			const spentTxs = this.allSql<TableTransaction>(
				`SELECT * FROM transactions WHERE updated_at < ? AND status = 'completed'
				 AND NOT EXISTS (SELECT outputId FROM outputs AS o WHERE o.transactionId = transactions.transactionId AND o.spendable = 1)`,
				[before],
			)
			const nptxs = spentTxs.filter((t) => !proofTxids[t.txid || ''])
			const spentTxIds = nptxs.map((tx) => tx.transactionId)

			if (spentTxIds.length > 0) {
				// Untrack spentBy
				const placeholders = spentTxIds.map(() => '?').join(',')
				this.db.run(
					`UPDATE outputs SET spentBy = NULL, updated_at = ? WHERE spendable = 0 AND spentBy IN (${placeholders})`,
					[String(this.validateEntityDate(new Date())), ...spentTxIds],
				)
				const cnt = (
					this.db.query('SELECT changes() as cnt').get() as { cnt: number }
				).cnt
				if (cnt > 0) {
					r.count += cnt
					r.log += `${cnt} spent outputs no longer tracked by spentBy\n`
				}

				this.deleteTransactions(spentTxIds, r, 'spent', false)
			}
		}

		// Delete orphan proven_txs
		this.db.run(
			`DELETE FROM proven_txs
			 WHERE NOT EXISTS (SELECT * FROM transactions AS t WHERE t.txid = proven_txs.txid OR t.provenTxId = proven_txs.provenTxId)
			 AND NOT EXISTS (SELECT * FROM proven_tx_reqs AS r WHERE r.txid = proven_txs.txid OR r.provenTxId = proven_txs.provenTxId)`,
		)
		const cnt = (
			this.db.query('SELECT changes() as cnt').get() as { cnt: number }
		).cnt
		if (cnt > 0) {
			r.count += cnt
			r.log += `${cnt} orphan proven_txs deleted\n`
		}

		return r
	}

	private deleteTransactions(
		transactionIds: number[],
		r: PurgeResults,
		reason: string,
		markNotSpentBy: boolean,
	): void {
		if (transactionIds.length === 0) return
		const placeholders = transactionIds.map(() => '?').join(',')

		const outputs = this.allSql<{ outputId: number }>(
			`SELECT outputId FROM outputs WHERE transactionId IN (${placeholders})`,
			transactionIds,
		)
		const outputIds = outputs.map((o) => o.outputId)

		if (outputIds.length > 0) {
			const oPlaceholders = outputIds.map(() => '?').join(',')
			this.db.run(
				`DELETE FROM output_tags_map WHERE outputId IN (${oPlaceholders})`,
				outputIds as number[],
			)
			let cnt = (
				this.db.query('SELECT changes() as cnt').get() as { cnt: number }
			).cnt
			if (cnt > 0) {
				r.count += cnt
				r.log += `${cnt} ${reason} output_tags_map deleted\n`
			}

			this.db.run(
				`DELETE FROM outputs WHERE outputId IN (${oPlaceholders})`,
				outputIds as number[],
			)
			cnt = (this.db.query('SELECT changes() as cnt').get() as { cnt: number })
				.cnt
			if (cnt > 0) {
				r.count += cnt
				r.log += `${cnt} ${reason} outputs deleted\n`
			}
		}

		this.db.run(
			`DELETE FROM tx_labels_map WHERE transactionId IN (${placeholders})`,
			transactionIds as number[],
		)
		let cnt = (
			this.db.query('SELECT changes() as cnt').get() as { cnt: number }
		).cnt
		if (cnt > 0) {
			r.count += cnt
			r.log += `${cnt} ${reason} tx_labels_map deleted\n`
		}

		this.db.run(
			`DELETE FROM commissions WHERE transactionId IN (${placeholders})`,
			transactionIds as number[],
		)
		cnt = (this.db.query('SELECT changes() as cnt').get() as { cnt: number })
			.cnt
		if (cnt > 0) {
			r.count += cnt
			r.log += `${cnt} ${reason} commissions deleted\n`
		}

		if (markNotSpentBy) {
			this.db.run(
				`UPDATE outputs SET spendable = 1, spentBy = NULL WHERE spentBy IN (${placeholders})`,
				transactionIds as number[],
			)
			cnt = (this.db.query('SELECT changes() as cnt').get() as { cnt: number })
				.cnt
			if (cnt > 0) {
				r.count += cnt
				r.log += `${cnt} unspent outputs updated to spendable\n`
			}
		}

		this.db.run(
			`DELETE FROM transactions WHERE transactionId IN (${placeholders})`,
			transactionIds as number[],
		)
		cnt = (this.db.query('SELECT changes() as cnt').get() as { cnt: number })
			.cnt
		if (cnt > 0) {
			r.count += cnt
			r.log += `${cnt} ${reason} transactions deleted\n`
		}
	}

	// -----------------------------------------------------------------------
	// reviewStatus
	// -----------------------------------------------------------------------

	async reviewStatus(_args: { agedLimit: Date; trx?: TrxToken }): Promise<{
		log: string
	}> {
		const r = { log: '' }

		// 1. Set transactions to 'failed' where provenTxReq with matching txid is 'invalid'
		this.db.run(`
			UPDATE transactions SET status = 'failed'
			WHERE status != 'failed'
			AND EXISTS (SELECT 1 FROM proven_tx_reqs AS r WHERE transactions.txid = r.txid AND r.status = 'invalid')
		`)
		let cnt = (
			this.db.query('SELECT changes() as cnt').get() as { cnt: number }
		).cnt
		if (cnt > 0)
			r.log += `${cnt} transactions updated to status of 'failed' where provenTxReq with matching txid is 'invalid'\n`

		// 2. Set outputs to spendable where spentBy is a failed transaction
		this.db.run(`
			UPDATE outputs SET spentBy = NULL, spendable = 1
			WHERE EXISTS (SELECT 1 FROM transactions AS t WHERE outputs.spentBy = t.transactionId AND t.status = 'failed')
		`)
		cnt = (this.db.query('SELECT changes() as cnt').get() as { cnt: number })
			.cnt
		if (cnt > 0)
			r.log += `${cnt} outputs updated to spendable where spentBy is a transaction with status 'failed'\n`

		// 3. Set transactions to 'completed' where provenTx with matching txid exists
		this.db.run(`
			UPDATE transactions SET status = 'completed',
				provenTxId = (SELECT provenTxId FROM proven_txs AS p WHERE transactions.txid = p.txid)
			WHERE provenTxId IS NULL
			AND EXISTS (SELECT 1 FROM proven_txs AS p WHERE transactions.txid = p.txid)
		`)
		cnt = (this.db.query('SELECT changes() as cnt').get() as { cnt: number })
			.cnt
		if (cnt > 0)
			r.log += `${cnt} transactions updated with provenTxId and status of 'completed' where provenTx with matching txid exists\n`

		return r
	}

	// -----------------------------------------------------------------------
	// adminStats — MySQL-only in StorageKnex, throw for SQLite
	// -----------------------------------------------------------------------

	async adminStats(_adminIdentityKey: string): Promise<AdminStatsResult> {
		throw new WERR_NOT_IMPLEMENTED('adminStats, only MySQL is supported')
	}

	// -----------------------------------------------------------------------
	// Action batching — not implemented by this backend (see storage-pg.ts).
	// The base StorageProvider throws NOT_IMPLEMENTED, which makes the
	// monitor's CleanupActionBatches task fail every cycle. Since these
	// providers never create action batches, the correct answer is an empty
	// set — turning the task into a harmless no-op instead of an error.
	// -----------------------------------------------------------------------

	async findExpiredActionBatches(
		_now: Date,
		_trx?: TrxToken,
	): Promise<TableActionBatch[]> {
		return []
	}
}
