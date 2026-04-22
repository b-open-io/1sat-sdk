/**
 * StoragePg — native Postgres backend for `@1sat/wallet-node` wallets.
 *
 * Drop-in replacement for StorageKnex that uses `pg` directly, eliminating
 * the knex + wallet-toolbox StorageKnex dependency chain. Extends
 * StorageProvider (same base as StorageBunSqlite) so it can be used anywhere
 * a WalletStorageProvider is expected.
 *
 * Structure mirrors StorageBunSqlite method-for-method. Schema is the same
 * wallet-toolbox layout translated to Postgres types. Booleans stay as
 * SMALLINT 0/1 to match the validate-helpers' coercion pattern exactly.
 */

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
	makeBrc114ActionTimeLabel,
	parseBrc114ActionTimeLabels,
} from '@bsv/wallet-toolbox/out/src/utility/brc114ActionTimeLabels.js'
import {
	verifyId,
	verifyOneOrNone,
	verifyTruthy,
} from '@bsv/wallet-toolbox/out/src/utility/utilityHelpers.js'
import { asString } from '@bsv/wallet-toolbox/out/src/utility/utilityHelpers.noBuffer.js'
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoragePgOptions extends StorageProviderOptions {
	/** Postgres connection string, e.g. `postgres://user:pass@host:5432/db`. */
	dbUrl?: string
	/** Alternatively, an already-constructed `pg.Pool`. */
	pool?: Pool
	/** Pool size limits. Ignored when `pool` is supplied. */
	poolConfig?: { min?: number; max?: number }
}

const TRX_BRAND = Symbol('PgTrx')

interface PgTrxToken {
	[TRX_BRAND]: true
	client: PoolClient
}

type Executor = {
	query<R extends QueryResultRow = QueryResultRow>(
		text: string,
		params?: unknown[],
	): Promise<QueryResult<R>>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBuffer(
	val: number[] | Uint8Array | Buffer | null | undefined,
): Buffer | null {
	if (val == null) return null
	if (Buffer.isBuffer(val)) return val
	if (val instanceof Uint8Array) return Buffer.from(val)
	if (Array.isArray(val)) return Buffer.from(val)
	return null
}

/**
 * Normalize a JS value for a Postgres parameter binding. Booleans are
 * coerced to SMALLINT 0/1 (our schema stores booleans that way to match
 * bun-sqlite's validation pattern). Buffers/arrays are left as Buffer.
 * sqlite tolerates raw booleans via implicit coercion; pg does not, so
 * any caller path that skipped the `booleanFields` list would otherwise
 * fail with "invalid input syntax for type smallint".
 */
function bindValue(v: unknown): unknown {
	if (v === null || v === undefined) return v
	if (typeof v === 'boolean') return v ? 1 : 0
	if (Buffer.isBuffer(v)) return v
	if (v instanceof Uint8Array) return Buffer.from(v)
	if (Array.isArray(v) && (v.length === 0 || typeof v[0] === 'number'))
		return Buffer.from(v as number[])
	return v
}

/**
 * Rewrite `?`-style placeholders to Postgres `$1, $2, ...` form. Walks the
 * string in one pass and skips `?` inside single- or double-quoted literals
 * and `--` / `/* *\/` comments so we don't clobber embedded question marks
 * in string values or miscount placeholders inside comments.
 */
function convertPlaceholders(sql: string): string {
	let out = ''
	let n = 0
	let inSingle = false
	let inDouble = false
	let inLine = false
	let inBlock = false
	for (let i = 0; i < sql.length; i++) {
		const c = sql[i]
		if (inLine) {
			out += c
			if (c === '\n') inLine = false
			continue
		}
		if (inBlock) {
			out += c
			if (c === '*' && sql[i + 1] === '/') {
				out += '/'
				i++
				inBlock = false
			}
			continue
		}
		if (inSingle) {
			out += c
			if (c === "'") {
				if (sql[i + 1] === "'") {
					out += "'"
					i++
				} else {
					inSingle = false
				}
			}
			continue
		}
		if (inDouble) {
			out += c
			if (c === '"') {
				if (sql[i + 1] === '"') {
					out += '"'
					i++
				} else {
					inDouble = false
				}
			}
			continue
		}
		if (c === '-' && sql[i + 1] === '-') {
			inLine = true
			out += c
			continue
		}
		if (c === '/' && sql[i + 1] === '*') {
			inBlock = true
			out += c
			continue
		}
		if (c === "'") {
			inSingle = true
			out += c
			continue
		}
		if (c === '"') {
			inDouble = true
			out += c
			continue
		}
		if (c === '?') {
			n += 1
			out += `$${n}`
			continue
		}
		out += c
	}
	return out
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
			sql: `(SELECT COUNT(*) FROM output_tags_map m WHERE m."outputId" = outputs."outputId" AND m."outputTagId" IN (${placeholders})) = ${tagIds.length}`,
			params: [...tagIds],
		}
	}
	return {
		sql: `EXISTS (SELECT 1 FROM output_tags_map m WHERE m."outputId" = outputs."outputId" AND m."outputTagId" IN (${placeholders}))`,
		params: [...tagIds],
	}
}

function buildTxLabelFilterSql(
	labelIds?: number[],
	isQueryModeAll?: boolean,
): { sql: string; params: unknown[] } | undefined {
	if (!labelIds || labelIds.length === 0) return undefined
	const placeholders = labelIds.map(() => '?').join(',')
	if (isQueryModeAll) {
		return {
			sql: `(SELECT COUNT(*) FROM tx_labels_map m WHERE m."transactionId" = transactions."transactionId" AND m."txLabelId" IN (${placeholders})) = ${labelIds.length}`,
			params: [...labelIds],
		}
	}
	return {
		sql: `EXISTS (SELECT 1 FROM tx_labels_map m WHERE m."transactionId" = transactions."transactionId" AND m."txLabelId" IN (${placeholders}))`,
		params: [...labelIds],
	}
}

// ---------------------------------------------------------------------------
// StoragePg
// ---------------------------------------------------------------------------

export class StoragePg extends StorageProvider {
	private pool: Pool
	private ownsPool: boolean
	private tableColumns: Map<string, Set<string>> = new Map()
	private savepointCounter = 0
	_verifiedReadyForDatabaseAccess = false

	constructor(options: StoragePgOptions) {
		super(options)
		if (options.pool) {
			// Caller-managed pool: we cannot safely set type parsers here (would
			// leak into the caller's other pg consumers in the same process).
			// The caller is responsible for configuring BIGINT → number parsing
			// if they want satoshis returned as JS numbers.
			this.pool = options.pool
			this.ownsPool = false
		} else if (options.dbUrl) {
			// Lazy-require so browsers/other runtimes that will never reach this
			// path don't fail on `pg`'s node-specific imports.
			const pgMod = require('pg') as typeof import('pg')
			// Per-pool type resolver instead of the global `types.setTypeParser`.
			// Returning bigint as JS number is safe for satoshis / byte lengths
			// (values well under 2^53). Scoping to this pool prevents leaking
			// the override into other pg consumers in the same process.
			const customTypes = {
				getTypeParser(oid: number, format?: unknown) {
					if (oid === 20)
						return (v: string) => Number.parseInt(v, 10)
					return (pgMod.types.getTypeParser as unknown as (
						oid: number,
						format?: unknown,
					) => unknown)(oid, format)
				},
			}
			this.pool = new pgMod.Pool({
				connectionString: options.dbUrl,
				min: options.poolConfig?.min,
				max: options.poolConfig?.max,
				types: customTypes as never,
			})
			this.ownsPool = true
		} else {
			throw new WERR_INVALID_PARAMETER(
				'options',
				'either `dbUrl` or `pool` must be supplied',
			)
		}
	}

	// -----------------------------------------------------------------------
	// Core infrastructure
	// -----------------------------------------------------------------------

	async readSettings(trx?: TrxToken): Promise<TableSettings> {
		const row = await this.getSql<Record<string, unknown>>(
			'SELECT * FROM settings LIMIT 1',
			[],
			trx as PgTrxToken | undefined,
		)
		if (!row) throw new WERR_INTERNAL('No settings row found')
		return this.validateEntity(row as unknown as TableSettings)
	}

	async destroy(): Promise<void> {
		if (this.ownsPool) await this.pool.end()
	}

	async migrate(
		storageName: string,
		storageIdentityKey: string,
	): Promise<string> {
		const exec = this.pool

		await exec.query(`
			CREATE TABLE IF NOT EXISTS knex_migrations (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				batch INTEGER NOT NULL,
				migration_time TIMESTAMPTZ DEFAULT NOW()
			)
		`)
		await exec.query(`
			CREATE TABLE IF NOT EXISTS knex_migrations_lock (
				"index" INTEGER PRIMARY KEY,
				is_locked INTEGER
			)
		`)
		await exec.query(
			`INSERT INTO knex_migrations_lock ("index", is_locked) VALUES (1, 0) ON CONFLICT DO NOTHING`,
		)

		const existingRes = await exec.query<{ name: string }>(
			'SELECT name FROM knex_migrations',
		)
		const existingMigrations = new Set<string>(existingRes.rows.map((r) => r.name))

		const migrations = this.getMigrationDefinitions(
			storageName,
			storageIdentityKey,
		)
		const sortedNames = Object.keys(migrations).sort()

		let batch = 0
		const batchRes = await exec.query<{ maxbatch: number | null }>(
			'SELECT MAX(batch) AS maxbatch FROM knex_migrations',
		)
		if (batchRes.rows[0]?.maxbatch != null) batch = Number(batchRes.rows[0].maxbatch)
		batch++

		for (const name of sortedNames) {
			if (existingMigrations.has(name)) continue
			const migration = migrations[name]
			await migration.up(exec)
			await exec.query(
				'INSERT INTO knex_migrations (name, batch) VALUES ($1, $2)',
				[name, batch],
			)
		}

		await this.refreshTableColumns()

		const latestRes = await exec.query<{ name: string }>(
			'SELECT name FROM knex_migrations ORDER BY id DESC LIMIT 1',
		)
		return latestRes.rows[0]?.name ?? 'none'
	}

	/**
	 * Introspect the live schema and cache the column set for every user
	 * table. Used by `filterToSchema` to drop wire-format fields that don't
	 * correspond to real columns before building INSERT/UPDATE SQL.
	 */
	private async refreshTableColumns(): Promise<void> {
		this.tableColumns.clear()
		const tables = await this.pool.query<{ table_name: string }>(
			`SELECT table_name FROM information_schema.tables
			 WHERE table_schema = current_schema()
			   AND table_type = 'BASE TABLE'
			   AND table_name NOT LIKE 'knex_migrations%'`,
		)
		for (const { table_name } of tables.rows) {
			const cols = await this.pool.query<{ column_name: string }>(
				`SELECT column_name FROM information_schema.columns
				 WHERE table_schema = current_schema() AND table_name = $1`,
				[table_name],
			)
			this.tableColumns.set(
				table_name,
				new Set(cols.rows.map((c) => c.column_name)),
			)
		}
	}

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
	): Record<string, { up: (e: Executor) => Promise<void>; down: (e: Executor) => Promise<void> }> {
		const migrations: Record<
			string,
			{ up: (e: Executor) => Promise<void>; down: (e: Executor) => Promise<void> }
		> = {}

		migrations['2024-12-26-001 initial migration'] = {
			up: async (db) => {
				await db.query(`
					CREATE TABLE IF NOT EXISTS proven_txs (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"provenTxId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						txid TEXT NOT NULL UNIQUE,
						height INTEGER NOT NULL,
						"index" INTEGER NOT NULL,
						"merklePath" BYTEA NOT NULL,
						"rawTx" BYTEA NOT NULL,
						"blockHash" TEXT NOT NULL,
						"merkleRoot" TEXT NOT NULL
					)
				`)
				await db.query(`
					CREATE TABLE IF NOT EXISTS proven_tx_reqs (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"provenTxReqId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						"provenTxId" INTEGER REFERENCES proven_txs("provenTxId"),
						status TEXT NOT NULL DEFAULT 'unknown',
						attempts INTEGER NOT NULL DEFAULT 0,
						notified SMALLINT NOT NULL DEFAULT 0,
						txid TEXT NOT NULL UNIQUE,
						batch TEXT,
						history TEXT NOT NULL DEFAULT '{}',
						notify TEXT NOT NULL DEFAULT '{}',
						"rawTx" BYTEA NOT NULL,
						"inputBEEF" BYTEA
					)
				`)
				await db.query(
					'CREATE INDEX IF NOT EXISTS proven_tx_reqs_status ON proven_tx_reqs(status)',
				)
				await db.query(
					'CREATE INDEX IF NOT EXISTS proven_tx_reqs_batch ON proven_tx_reqs(batch)',
				)

				await db.query(`
					CREATE TABLE IF NOT EXISTS users (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"userId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						"identityKey" TEXT NOT NULL UNIQUE
					)
				`)
				await db.query(`
					CREATE TABLE IF NOT EXISTS certificates (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"certificateId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						"userId" INTEGER NOT NULL REFERENCES users("userId"),
						"serialNumber" TEXT NOT NULL,
						type TEXT NOT NULL,
						certifier TEXT NOT NULL,
						subject TEXT NOT NULL,
						verifier TEXT,
						"revocationOutpoint" TEXT NOT NULL,
						signature TEXT NOT NULL,
						"isDeleted" SMALLINT NOT NULL DEFAULT 0,
						UNIQUE("userId", type, certifier, "serialNumber")
					)
				`)
				await db.query(`
					CREATE TABLE IF NOT EXISTS certificate_fields (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"userId" INTEGER NOT NULL REFERENCES users("userId"),
						"certificateId" INTEGER NOT NULL REFERENCES certificates("certificateId"),
						"fieldName" TEXT NOT NULL,
						"fieldValue" TEXT NOT NULL,
						"masterKey" TEXT NOT NULL DEFAULT '',
						UNIQUE("fieldName", "certificateId")
					)
				`)
				await db.query(`
					CREATE TABLE IF NOT EXISTS output_baskets (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"basketId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						"userId" INTEGER NOT NULL REFERENCES users("userId"),
						name TEXT NOT NULL,
						"numberOfDesiredUTXOs" INTEGER NOT NULL DEFAULT 6,
						"minimumDesiredUTXOValue" INTEGER NOT NULL DEFAULT 10000,
						"isDeleted" SMALLINT NOT NULL DEFAULT 0,
						UNIQUE(name, "userId")
					)
				`)
				await db.query(`
					CREATE TABLE IF NOT EXISTS transactions (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"transactionId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						"userId" INTEGER NOT NULL REFERENCES users("userId"),
						"provenTxId" INTEGER REFERENCES proven_txs("provenTxId"),
						status TEXT NOT NULL,
						reference TEXT NOT NULL UNIQUE,
						"isOutgoing" SMALLINT NOT NULL,
						satoshis BIGINT NOT NULL DEFAULT 0,
						version INTEGER,
						"lockTime" INTEGER,
						description TEXT NOT NULL,
						txid TEXT,
						"inputBEEF" BYTEA,
						"rawTx" BYTEA
					)
				`)
				await db.query(
					'CREATE INDEX IF NOT EXISTS transactions_status ON transactions(status)',
				)

				await db.query(`
					CREATE TABLE IF NOT EXISTS commissions (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"commissionId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						"userId" INTEGER NOT NULL REFERENCES users("userId"),
						"transactionId" INTEGER NOT NULL UNIQUE REFERENCES transactions("transactionId"),
						satoshis BIGINT NOT NULL,
						"keyOffset" TEXT NOT NULL,
						"isRedeemed" SMALLINT NOT NULL DEFAULT 0,
						"lockingScript" BYTEA NOT NULL
					)
				`)
				await db.query(
					'CREATE INDEX IF NOT EXISTS commissions_transactionId ON commissions("transactionId")',
				)

				await db.query(`
					CREATE TABLE IF NOT EXISTS outputs (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"outputId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						"userId" INTEGER NOT NULL REFERENCES users("userId"),
						"transactionId" INTEGER NOT NULL REFERENCES transactions("transactionId"),
						"basketId" INTEGER REFERENCES output_baskets("basketId"),
						spendable SMALLINT NOT NULL DEFAULT 0,
						"change" SMALLINT NOT NULL DEFAULT 0,
						vout INTEGER NOT NULL,
						satoshis BIGINT NOT NULL,
						"providedBy" TEXT NOT NULL,
						purpose TEXT NOT NULL,
						type TEXT NOT NULL,
						"outputDescription" TEXT,
						txid TEXT,
						"senderIdentityKey" TEXT,
						"derivationPrefix" TEXT,
						"derivationSuffix" TEXT,
						"customInstructions" TEXT,
						"spentBy" INTEGER REFERENCES transactions("transactionId"),
						"sequenceNumber" INTEGER,
						"spendingDescription" TEXT,
						"scriptLength" BIGINT,
						"scriptOffset" BIGINT,
						"lockingScript" BYTEA,
						UNIQUE("transactionId", vout, "userId")
					)
				`)

				await db.query(`
					CREATE TABLE IF NOT EXISTS output_tags (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"outputTagId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						"userId" INTEGER NOT NULL REFERENCES users("userId"),
						tag TEXT NOT NULL,
						"isDeleted" SMALLINT NOT NULL DEFAULT 0,
						UNIQUE(tag, "userId")
					)
				`)
				await db.query(`
					CREATE TABLE IF NOT EXISTS output_tags_map (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"outputTagId" INTEGER NOT NULL REFERENCES output_tags("outputTagId"),
						"outputId" INTEGER NOT NULL REFERENCES outputs("outputId"),
						"isDeleted" SMALLINT NOT NULL DEFAULT 0,
						UNIQUE("outputTagId", "outputId")
					)
				`)
				await db.query(
					'CREATE INDEX IF NOT EXISTS output_tags_map_outputId ON output_tags_map("outputId")',
				)

				await db.query(`
					CREATE TABLE IF NOT EXISTS tx_labels (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"txLabelId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						"userId" INTEGER NOT NULL REFERENCES users("userId"),
						label TEXT NOT NULL,
						"isDeleted" SMALLINT NOT NULL DEFAULT 0,
						UNIQUE(label, "userId")
					)
				`)
				await db.query(`
					CREATE TABLE IF NOT EXISTS tx_labels_map (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"txLabelId" INTEGER NOT NULL REFERENCES tx_labels("txLabelId"),
						"transactionId" INTEGER NOT NULL REFERENCES transactions("transactionId"),
						"isDeleted" SMALLINT NOT NULL DEFAULT 0,
						UNIQUE("txLabelId", "transactionId")
					)
				`)
				await db.query(
					'CREATE INDEX IF NOT EXISTS tx_labels_map_transactionId ON tx_labels_map("transactionId")',
				)

				await db.query(`
					CREATE TABLE IF NOT EXISTS monitor_events (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						event TEXT NOT NULL,
						details TEXT
					)
				`)
				await db.query(`
					CREATE TABLE IF NOT EXISTS settings (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"storageIdentityKey" TEXT NOT NULL,
						"storageName" TEXT NOT NULL,
						chain TEXT NOT NULL,
						dbtype TEXT NOT NULL,
						"maxOutputScript" INTEGER NOT NULL
					)
				`)
				await db.query(`
					CREATE TABLE IF NOT EXISTS sync_states (
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"syncStateId" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
						"userId" INTEGER NOT NULL REFERENCES users("userId"),
						"storageIdentityKey" TEXT NOT NULL DEFAULT '',
						"storageName" TEXT NOT NULL,
						status TEXT NOT NULL DEFAULT 'unknown',
						init SMALLINT NOT NULL DEFAULT 0,
						"refNum" TEXT NOT NULL UNIQUE,
						"syncMap" TEXT NOT NULL,
						"when" TIMESTAMPTZ,
						satoshis BIGINT,
						"errorLocal" TEXT,
						"errorOther" TEXT
					)
				`)
				await db.query(
					'CREATE INDEX IF NOT EXISTS sync_states_status ON sync_states(status)',
				)
				await db.query(
					'CREATE INDEX IF NOT EXISTS sync_states_refNum ON sync_states("refNum")',
				)

				await db.query(
					`INSERT INTO settings ("storageIdentityKey", "storageName", chain, dbtype, "maxOutputScript")
					 VALUES ($1, $2, $3, 'Postgres', 1024)`,
					[storageIdentityKey, storageName, this.chain],
				)
			},
			down: async (db) => {
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
					await db.query(`DROP TABLE IF EXISTS ${table}`)
				}
			},
		}

		migrations['2025-01-21-001 add activeStorage to users'] = {
			up: async (db) => {
				await db.query(
					`ALTER TABLE users ADD COLUMN IF NOT EXISTS "activeStorage" TEXT DEFAULT NULL`,
				)
			},
			down: async (db) => {
				await db.query(`ALTER TABLE users DROP COLUMN IF EXISTS "activeStorage"`)
			},
		}

		migrations['2025-02-22-001 nonNULL activeStorage'] = {
			up: async (db) => {
				const settings = await db.query<{ storageIdentityKey: string }>(
					'SELECT "storageIdentityKey" FROM settings LIMIT 1',
				)
				const key = settings.rows[0]?.storageIdentityKey
				if (key) {
					await db.query(
						'UPDATE users SET "activeStorage" = $1 WHERE "activeStorage" IS NULL',
						[key],
					)
				}
			},
			down: async () => {},
		}

		migrations['2025-02-28-001 derivations to 200'] = {
			up: async () => {
				// TEXT columns in pg have no practical length cap — nothing to do.
			},
			down: async () => {},
		}

		migrations['2025-03-01-001 reset req history'] = {
			up: async (db) => {
				await db.query(`UPDATE proven_tx_reqs SET history = '{}'`)
			},
			down: async () => {},
		}

		migrations['2025-03-03-001 descriptions to 2000'] = {
			up: async () => {},
			down: async () => {},
		}

		migrations['2025-05-13-001 add monitor events event index'] = {
			up: async (db) => {
				await db.query(
					'CREATE INDEX IF NOT EXISTS monitor_events_event ON monitor_events(event)',
				)
			},
			down: async (db) => {
				await db.query('DROP INDEX IF EXISTS monitor_events_event')
			},
		}

		migrations['2025-09-06-001 add proven txs blockHash index'] = {
			up: async (db) => {
				await db.query(
					'CREATE INDEX IF NOT EXISTS proven_txs_blockHash ON proven_txs("blockHash")',
				)
			},
			down: async (db) => {
				await db.query('DROP INDEX IF EXISTS proven_txs_blockHash')
			},
		}

		migrations['2025-10-13-001 add outputs spendable index'] = {
			up: async (db) => {
				await db.query(
					'CREATE INDEX IF NOT EXISTS outputs_spendable ON outputs(spendable)',
				)
			},
			down: async (db) => {
				await db.query('DROP INDEX IF EXISTS outputs_spendable')
			},
		}

		migrations['2026-02-27-001 add listOutputs path indexes'] = {
			up: async (db) => {
				await db.query(
					`CREATE INDEX IF NOT EXISTS idx_outputs_user_spendable_outputid ON outputs ("userId", spendable, "outputId")`,
				)
				await db.query(
					`CREATE INDEX IF NOT EXISTS idx_outputs_user_basket_spendable_outputid ON outputs ("userId", "basketId", spendable, "outputId")`,
				)
				await db.query(
					`CREATE INDEX IF NOT EXISTS idx_output_tags_map_output_deleted_tag ON output_tags_map ("outputId", "isDeleted", "outputTagId")`,
				)
				await db.query(
					`CREATE INDEX IF NOT EXISTS idx_tx_labels_map_tx_deleted ON tx_labels_map ("transactionId", "isDeleted")`,
				)
			},
			down: async (db) => {
				await db.query(`DROP INDEX IF EXISTS idx_tx_labels_map_tx_deleted`)
				await db.query(`DROP INDEX IF EXISTS idx_output_tags_map_output_deleted_tag`)
				await db.query(`DROP INDEX IF EXISTS idx_outputs_user_basket_spendable_outputid`)
				await db.query(`DROP INDEX IF EXISTS idx_outputs_user_spendable_outputid`)
			},
		}

		migrations['2026-02-27-002 add createAction path indexes'] = {
			up: async (db) => {
				await db.query(
					`CREATE INDEX IF NOT EXISTS idx_outputs_user_basket_spendable_satoshis ON outputs ("userId", "basketId", spendable, satoshis)`,
				)
				await db.query(
					`CREATE INDEX IF NOT EXISTS idx_outputs_spentby ON outputs ("spentBy")`,
				)
			},
			down: async (db) => {
				await db.query(`DROP INDEX IF EXISTS idx_outputs_spentby`)
				await db.query(`DROP INDEX IF EXISTS idx_outputs_user_basket_spendable_satoshis`)
			},
		}

		migrations['2025-10-18-001 add transactions txid index'] = {
			up: async (db) => {
				await db.query(
					'CREATE INDEX IF NOT EXISTS transactions_txid ON transactions(txid)',
				)
			},
			down: async (db) => {
				await db.query('DROP INDEX IF EXISTS transactions_txid')
			},
		}

		migrations['2025-10-18-002 add proven_tx_reqs txid index'] = {
			up: async (db) => {
				await db.query(
					'CREATE INDEX IF NOT EXISTS proven_tx_reqs_txid ON proven_tx_reqs(txid)',
				)
			},
			down: async (db) => {
				await db.query('DROP INDEX IF EXISTS proven_tx_reqs_txid')
			},
		}

		migrations['2026-04-20-001 add transactions userId index'] = {
			up: async (db) => {
				await db.query(
					'CREATE INDEX IF NOT EXISTS transactions_userId ON transactions("userId")',
				)
			},
			down: async (db) => {
				await db.query('DROP INDEX IF EXISTS transactions_userId')
			},
		}

		migrations['2026-04-20-002 add outputs userId index'] = {
			up: async (db) => {
				await db.query(
					'CREATE INDEX IF NOT EXISTS outputs_userId ON outputs("userId")',
				)
			},
			down: async (db) => {
				await db.query('DROP INDEX IF EXISTS outputs_userId')
			},
		}

		return migrations
	}

	async dropAllData(): Promise<void> {
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
			await this.pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`)
		}
	}

	async transaction<T>(
		scope: (trx: TrxToken) => Promise<T>,
		trx?: TrxToken,
	): Promise<T> {
		if (trx) {
			// Nested: issue a SAVEPOINT on the caller's client so partial
			// failures can roll back without tearing down the outer tx.
			// Monotonic counter + process id suffix for uniqueness under
			// concurrent nested calls on distinct clients.
			const t = trx as unknown as PgTrxToken
			this.savepointCounter++
			const spName = `sp_${this.savepointCounter}`
			await t.client.query(`SAVEPOINT ${spName}`)
			let r: T
			try {
				r = await scope(trx)
			} catch (err) {
				try {
					await t.client.query(`ROLLBACK TO SAVEPOINT ${spName}`)
					await t.client.query(`RELEASE SAVEPOINT ${spName}`)
				} catch {
					// Outer transaction will abort; swallow cleanup errors so
					// the original scope error propagates unchanged.
				}
				throw err
			}
			await t.client.query(`RELEASE SAVEPOINT ${spName}`)
			return r
		}

		const client = await this.pool.connect()
		try {
			await client.query('BEGIN')
			const token: PgTrxToken = { [TRX_BRAND]: true, client }
			let r: T
			try {
				r = await scope(token as unknown as TrxToken)
			} catch (err) {
				try {
					await client.query('ROLLBACK')
				} catch {}
				throw err
			}
			await client.query('COMMIT')
			return r
		} finally {
			client.release()
		}
	}

	// -----------------------------------------------------------------------
	// Low-level query helpers
	// -----------------------------------------------------------------------

	private exec(trx?: PgTrxToken): Executor {
		if (trx) return trx.client
		return this.pool
	}

	toDb(_trx?: TrxToken): Pool {
		this.whenLastAccess = new Date()
		return this.pool
	}

	private async runSql(
		sql: string,
		params: unknown[] = [],
		trx?: PgTrxToken,
	): Promise<QueryResult> {
		this.whenLastAccess = new Date()
		return this.exec(trx).query(convertPlaceholders(sql), params as unknown[])
	}

	private async allSql<T extends QueryResultRow = QueryResultRow>(
		sql: string,
		params: unknown[] = [],
		trx?: PgTrxToken,
	): Promise<T[]> {
		this.whenLastAccess = new Date()
		const r = await this.exec(trx).query<T>(convertPlaceholders(sql), params as unknown[])
		return r.rows
	}

	private async getSql<T extends QueryResultRow = QueryResultRow>(
		sql: string,
		params: unknown[] = [],
		trx?: PgTrxToken,
	): Promise<T | null> {
		this.whenLastAccess = new Date()
		const r = await this.exec(trx).query<T>(convertPlaceholders(sql), params as unknown[])
		return r.rows[0] ?? null
	}

	/**
	 * Build a WHERE clause from a partial object.
	 * Returns { clause: string, params: unknown[] } with `?` placeholders; the
	 * caller feeds into runSql/allSql/getSql which convert to `$n` form.
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
			} else {
				parts.push(`${col} = ?`)
				params.push(bindValue(val))
			}
		}
		return { clause: parts.join(' AND '), params }
	}

	private quoteCol(name: string): string {
		// Always double-quote camelCase column names on Postgres. Unquoted
		// identifiers are folded to lowercase by the pg parser, which would
		// break every `transactionId`, `provenTxId`, etc. Reserved words are
		// quoted by default as a side effect.
		return `"${name}"`
	}

	private orderByColumn(table: string): string {
		switch (table) {
			case 'certificates':
				return '"certificateId"'
			case 'commissions':
				return '"commissionId"'
			case 'output_baskets':
				return '"basketId"'
			case 'outputs':
				return '"outputId"'
			case 'output_tags':
				return '"outputTagId"'
			case 'proven_tx_reqs':
				return '"provenTxReqId"'
			case 'proven_txs':
				return '"provenTxId"'
			case 'sync_states':
				return '"syncStateId"'
			case 'transactions':
				return '"transactionId"'
			case 'tx_labels':
				return '"txLabelId"'
			case 'users':
				return '"userId"'
			case 'monitor_events':
				return 'id'
			default:
				return ''
		}
	}

	/**
	 * Map table name to its primary-key column, used by `insertRow` to
	 * emit a `RETURNING` clause.
	 */
	private pkColumn(table: string): string {
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

	private async selectQuery<T extends QueryResultRow = QueryResultRow>(
		table: string,
		args: {
			partial?: Record<string, unknown>
			since?: Date | string | number
			orderDescending?: boolean
			paged?: { limit: number; offset?: number }
			trx?: TrxToken
		},
		extraWhere?: string,
		extraParams?: unknown[],
		columns?: string[],
	): Promise<T[]> {
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

		return await this.allSql<T>(sql, params, args.trx as PgTrxToken | undefined)
	}

	private async countQuery(
		table: string,
		args: {
			partial?: Record<string, unknown>
			since?: Date | string | number
			trx?: TrxToken
		},
		extraWhere?: string,
		extraParams?: unknown[],
	): Promise<number> {
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

		const row = await this.getSql<{ cnt: number }>(
			sql,
			params,
			args.trx as PgTrxToken | undefined,
		)
		return Number(row?.cnt ?? 0)
	}

	/**
	 * INSERT a row and return the newly-assigned primary key via RETURNING.
	 */
	private async insertRow(
		table: string,
		entity: Record<string, unknown>,
		trx?: PgTrxToken,
	): Promise<number> {
		const scoped = this.filterToSchema(table, entity)
		// Drop only undefined (caller didn't provide the field). Explicit
		// null is preserved and bound as SQL NULL — matches prior behavior,
		// so schema NOT NULL violations surface instead of being silently
		// rewritten to DEFAULT.
		const filteredKeys = Object.keys(scoped).filter((k) => scoped[k] !== undefined)
		if (filteredKeys.length === 0)
			throw new WERR_INTERNAL(`Cannot insert empty entity into ${table}`)

		const cols = filteredKeys.map((k) => this.quoteCol(k)).join(', ')
		const placeholders = filteredKeys.map(() => '?').join(', ')
		const values = filteredKeys.map((k) => bindValue(scoped[k]))

		const pk = this.pkColumn(table)
		const returning = pk ? ` RETURNING ${this.quoteCol(pk)} AS id` : ''
		const sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders})${returning}`
		const r = await this.runSql(sql, values, trx)
		if (!pk) return 0
		const id = (r.rows[0] as { id: number | bigint | string } | undefined)?.id
		return typeof id === 'number' ? id : Number(id ?? 0)
	}

	/**
	 * UPDATE rows, returning the number of affected rows.
	 */
	private async updateRows(
		table: string,
		where: Record<string, unknown>,
		update: Record<string, unknown>,
		trx?: PgTrxToken,
	): Promise<number> {
		const scoped = this.filterToSchema(table, update)
		const setClauses: string[] = []
		const setParams: unknown[] = []
		for (const [k, v] of Object.entries(scoped)) {
			if (v === undefined) continue
			setClauses.push(`${this.quoteCol(k)} = ?`)
			setParams.push(bindValue(v))
		}

		if (setClauses.length === 0) return 0

		const w = this.buildWhere(where)
		let sql = `UPDATE ${table} SET ${setClauses.join(', ')}`
		if (w.clause) sql += ` WHERE ${w.clause}`
		const params = [...setParams, ...w.params]

		const r = await this.runSql(sql, params, trx)
		return r.rowCount ?? 0
	}

	// -----------------------------------------------------------------------
	// verifyReadyForDatabaseAccess
	// -----------------------------------------------------------------------

	async verifyReadyForDatabaseAccess(trx?: TrxToken): Promise<DBType> {
		if (!this._settings) {
			this._settings = await this.readSettings(trx)
		}
		this._verifiedReadyForDatabaseAccess = true
		// 'Postgres' isn't in wallet-toolbox's DBType union. Our overridden
		// validate helpers never call back into the base class's switch, so
		// the cast is safe; only the settings row's label is affected.
		return this._settings.dbtype as DBType
	}

	// -----------------------------------------------------------------------
	// Date conversion — Postgres TIMESTAMPTZ stores Date natively. Pass Date
	// in, get Date out. Overrides the base class's dbtype-switching logic.
	// -----------------------------------------------------------------------

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

	override validateEntityDate(
		date: Date | string | number,
	): Date | string {
		// pg driver accepts Date objects directly for TIMESTAMPTZ columns.
		return this.validateDate(date)
	}

	override validateOptionalEntityDate(
		date: Date | string | number | null | undefined,
		useNowAsDefault?: boolean,
	): Date | string | undefined {
		if (date === null || date === undefined) {
			return useNowAsDefault ? new Date() : undefined
		}
		return this.validateDate(date)
	}

	override validateDateForWhere(
		date: Date | string | number,
	): Date | string | number {
		// Base class throws default on anything that isn't SQLite/MySQL/IndexedDB.
		// pg's TIMESTAMPTZ driver accepts Date directly in parameter bindings.
		if (!this.dbtype)
			throw new WERR_INTERNAL('must call verifyReadyForDatabaseAccess first')
		return this.validateDate(date)
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
	// measureUsedBytes / getProvenOrRawTx / getRawTxOfKnownValidTransaction
	// -----------------------------------------------------------------------

	/**
	 * Sum of stored bytes attributable to a single wallet-toolbox user.
	 * Per-user tables (transactions, outputs) are summed directly. Shared
	 * rows (proven_txs, proven_tx_reqs) are attributed to every user that
	 * references them via `transactions.provenTxId` or `transactions.txid`.
	 * In multi-tenant deployments this over-counts aggregate disk usage
	 * but reflects each user's standalone storage cost fairly. Shape matches
	 * StorageBunSqlite.measureUsedBytes; OCTET_LENGTH replaces LENGTH.
	 */
	async measureUsedBytes(userId: number): Promise<number> {
		const tx = await this.getSql<{ total: number | string | null }>(
			`SELECT COALESCE(SUM(COALESCE(OCTET_LENGTH("rawTx"), 0) + COALESCE(OCTET_LENGTH("inputBEEF"), 0)), 0) AS total
			 FROM transactions WHERE "userId" = ?`,
			[userId],
		)
		const proven = await this.getSql<{ total: number | string | null }>(
			`SELECT COALESCE(SUM(COALESCE(OCTET_LENGTH(pt."rawTx"), 0) + COALESCE(OCTET_LENGTH(pt."merklePath"), 0)), 0) AS total
			 FROM proven_txs pt
			 INNER JOIN transactions t ON t."provenTxId" = pt."provenTxId"
			 WHERE t."userId" = ?`,
			[userId],
		)
		const reqs = await this.getSql<{ total: number | string | null }>(
			`SELECT COALESCE(SUM(COALESCE(OCTET_LENGTH(ptr."rawTx"), 0) + COALESCE(OCTET_LENGTH(ptr."inputBEEF"), 0)), 0) AS total
			 FROM proven_tx_reqs ptr
			 INNER JOIN transactions t ON t.txid = ptr.txid
			 WHERE t."userId" = ?`,
			[userId],
		)
		const out = await this.getSql<{ total: number | string | null }>(
			`SELECT COALESCE(SUM(COALESCE("scriptLength", OCTET_LENGTH("lockingScript"), 0)), 0) AS total
			 FROM outputs WHERE "userId" = ?`,
			[userId],
		)
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
		trx?: TrxToken,
	): Promise<ProvenOrRawTx> {
		const r: ProvenOrRawTx = {
			proven: undefined,
			rawTx: undefined,
			inputBEEF: undefined,
		}
		r.proven = verifyOneOrNone(
			await this.findProvenTxs({ partial: { txid }, trx }),
		)
		if (!r.proven) {
			const row = await this.getSql<{ rawTx: Buffer; inputBEEF: Buffer }>(
				`SELECT "rawTx", "inputBEEF" FROM proven_tx_reqs WHERE txid = ? AND status IN ('unsent','unmined','unconfirmed','sending','nosend','completed')`,
				[txid],
				trx as PgTrxToken | undefined,
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
			? `substring(${source} from ${fromOffset} for ${forLength})`
			: `substring(${source} from ${fromOffset})`
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
			let row = await this.getSql<{ rawTx: Buffer }>(
				`SELECT ${this.dbTypeSubstring('"rawTx"', offset! + 1, length!)} as "rawTx" FROM proven_txs WHERE txid = ?`,
				[txid],
				trx as PgTrxToken | undefined,
			)
			if (row?.rawTx) {
				rawTx = Array.from(row.rawTx)
			} else {
				row = await this.getSql<{ rawTx: Buffer }>(
					`SELECT ${this.dbTypeSubstring('"rawTx"', offset! + 1, length!)} as "rawTx" FROM proven_tx_reqs WHERE txid = ? AND status IN ('unsent','nosend','sending','unmined','completed','unfail')`,
					[txid],
					trx as PgTrxToken | undefined,
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
			'EXISTS (SELECT * FROM transactions WHERE proven_txs."provenTxId" = transactions."provenTxId" AND transactions."userId" = ?)',
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

		return this.validateEntities(
			(await this.allSql(sql, params, args.trx as PgTrxToken | undefined)) as unknown as TableProvenTx[],
		)
	}

	async getProvenTxReqsForUser(
		args: FindForUserSincePagedArgs,
	): Promise<TableProvenTxReq[]> {
		const whereParts: string[] = []
		const params: unknown[] = []

		whereParts.push(
			'EXISTS (SELECT * FROM transactions WHERE proven_tx_reqs.txid = transactions.txid AND transactions."userId" = ?)',
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
			(await this.allSql(sql, params, args.trx as PgTrxToken | undefined)) as unknown as TableProvenTxReq[],
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
			'EXISTS (SELECT * FROM tx_labels WHERE tx_labels."txLabelId" = tx_labels_map."txLabelId" AND tx_labels."userId" = ?)',
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
			(await this.allSql(sql, params, args.trx as PgTrxToken | undefined)) as unknown as TableTxLabelMap[],
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
			'EXISTS (SELECT * FROM output_tags WHERE output_tags."outputTagId" = output_tags_map."outputTagId" AND output_tags."userId" = ?)',
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
			(await this.allSql(sql, params, args.trx as PgTrxToken | undefined)) as unknown as TableOutputTagMap[],
			undefined,
			['isDeleted'],
		)
	}

	// -----------------------------------------------------------------------
	// INSERT methods
	// -----------------------------------------------------------------------

	async insertProvenTx(tx: TableProvenTx, trx?: TrxToken): Promise<number> {
		const e = (await this.validateEntityForInsert(tx, trx)) as Record<string, unknown>
		if (e.provenTxId === 0) e.provenTxId = undefined
		const id = await this.insertRow('proven_txs', e, trx as PgTrxToken | undefined)
		tx.provenTxId = id
		return id
	}

	async insertProvenTxReq(
		tx: TableProvenTxReq,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(tx, trx)) as Record<string, unknown>
		if (e.provenTxReqId === 0) e.provenTxReqId = undefined
		const id = await this.insertRow('proven_tx_reqs', e, trx as PgTrxToken | undefined)
		tx.provenTxReqId = id
		return id
	}

	async insertUser(user: TableUser, trx?: TrxToken): Promise<number> {
		const e = (await this.validateEntityForInsert(user, trx)) as Record<string, unknown>
		if (e.userId === 0) e.userId = undefined
		const id = await this.insertRow('users', e, trx as PgTrxToken | undefined)
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
		const id = await this.insertRow('certificates', e, trx as PgTrxToken | undefined)
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
		const e = (await this.validateEntityForInsert(certificateField, trx)) as Record<string, unknown>
		await this.insertRow('certificate_fields', e, trx as PgTrxToken | undefined)
	}

	async insertOutputBasket(
		basket: TableOutputBasket,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(basket, trx, undefined, [
			'isDeleted',
		])) as Record<string, unknown>
		if (e.basketId === 0) e.basketId = undefined
		const id = await this.insertRow('output_baskets', e, trx as PgTrxToken | undefined)
		basket.basketId = id
		return id
	}

	async insertTransaction(
		tx: TableTransaction,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(tx, trx)) as Record<string, unknown>
		if (e.transactionId === 0) e.transactionId = undefined
		const id = await this.insertRow('transactions', e, trx as PgTrxToken | undefined)
		tx.transactionId = id
		return id
	}

	async insertCommission(
		commission: TableCommission,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(commission, trx)) as Record<string, unknown>
		if (e.commissionId === 0) e.commissionId = undefined
		const id = await this.insertRow('commissions', e, trx as PgTrxToken | undefined)
		commission.commissionId = id
		return id
	}

	async insertOutput(output: TableOutput, trx?: TrxToken): Promise<number> {
		const e = (await this.validateEntityForInsert(output, trx)) as Record<string, unknown>
		if (e.outputId === 0) e.outputId = undefined
		const id = await this.insertRow('outputs', e, trx as PgTrxToken | undefined)
		output.outputId = id
		return id
	}

	async insertOutputTag(tag: TableOutputTag, trx?: TrxToken): Promise<number> {
		const e = (await this.validateEntityForInsert(tag, trx, undefined, [
			'isDeleted',
		])) as Record<string, unknown>
		if (e.outputTagId === 0) e.outputTagId = undefined
		const id = await this.insertRow('output_tags', e, trx as PgTrxToken | undefined)
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
		await this.insertRow('output_tags_map', e, trx as PgTrxToken | undefined)
	}

	async insertTxLabel(label: TableTxLabel, trx?: TrxToken): Promise<number> {
		const e = (await this.validateEntityForInsert(label, trx, undefined, [
			'isDeleted',
		])) as Record<string, unknown>
		if (e.txLabelId === 0) e.txLabelId = undefined
		const id = await this.insertRow('tx_labels', e, trx as PgTrxToken | undefined)
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
		await this.insertRow('tx_labels_map', e, trx as PgTrxToken | undefined)
	}

	async insertMonitorEvent(
		event: TableMonitorEvent,
		trx?: TrxToken,
	): Promise<number> {
		const e = (await this.validateEntityForInsert(event, trx)) as Record<string, unknown>
		if (e.id === 0) e.id = undefined
		const id = await this.insertRow('monitor_events', e, trx as PgTrxToken | undefined)
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
		const id = await this.insertRow('sync_states', e, trx as PgTrxToken | undefined)
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
		return await this.updateRows(
			'certificate_fields',
			{ certificateId, fieldName },
			validated,
			trx as PgTrxToken | undefined,
		)
	}

	async updateCertificate(
		id: number,
		update: Partial<TableCertificate>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'certificates',
			{ certificateId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
		)
	}

	async updateCommission(
		id: number,
		update: Partial<TableCommission>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'commissions',
			{ commissionId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
		)
	}

	async updateOutputBasket(
		id: number,
		update: Partial<TableOutputBasket>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'output_baskets',
			{ basketId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
		)
	}

	async updateOutput(
		id: number,
		update: Partial<TableOutput>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'outputs',
			{ outputId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
		)
	}

	async updateOutputTagMap(
		outputId: number,
		tagId: number,
		update: Partial<TableOutputTagMap>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'output_tags_map',
			{ outputId, outputTagId: tagId },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
		)
	}

	async updateOutputTag(
		id: number,
		update: Partial<TableOutputTag>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'output_tags',
			{ outputTagId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
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
				setParams.push(bindValue(v))
			}
			if (setClauses.length === 0) return 0
			const placeholders = id.map(() => '?').join(',')
			const sql = `UPDATE proven_tx_reqs SET ${setClauses.join(', ')} WHERE "provenTxReqId" IN (${placeholders})`
			const r = await this.runSql(
				sql,
				[...setParams, ...id],
				trx as PgTrxToken | undefined,
			)
			return r.rowCount ?? 0
		}
		if (!Number.isInteger(id))
			throw new WERR_INVALID_PARAMETER(
				'id',
				'transactionId or array of transactionId',
			)
		return await this.updateRows(
			'proven_tx_reqs',
			{ provenTxReqId: id },
			validated,
			trx as PgTrxToken | undefined,
		)
	}

	async updateProvenTx(
		id: number,
		update: Partial<TableProvenTx>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'proven_txs',
			{ provenTxId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
		)
	}

	async updateSyncState(
		id: number,
		update: Partial<TableSyncState>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'sync_states',
			{ syncStateId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				['when'],
				['init'],
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
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
				setParams.push(bindValue(v))
			}
			if (setClauses.length === 0) return 0
			const placeholders = id.map(() => '?').join(',')
			const sql = `UPDATE transactions SET ${setClauses.join(', ')} WHERE "transactionId" IN (${placeholders})`
			const r = await this.runSql(
				sql,
				[...setParams, ...id],
				trx as PgTrxToken | undefined,
			)
			return r.rowCount ?? 0
		}
		if (!Number.isInteger(id))
			throw new WERR_INVALID_PARAMETER(
				'id',
				'transactionId or array of transactionId',
			)
		return await this.updateRows(
			'transactions',
			{ transactionId: id },
			validated,
			trx as PgTrxToken | undefined,
		)
	}

	async updateTxLabelMap(
		transactionId: number,
		txLabelId: number,
		update: Partial<TableTxLabelMap>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'tx_labels_map',
			{ transactionId, txLabelId },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
		)
	}

	async updateTxLabel(
		id: number,
		update: Partial<TableTxLabel>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'tx_labels',
			{ txLabelId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
				undefined,
				['isDeleted'],
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
		)
	}

	async updateUser(
		id: number,
		update: Partial<TableUser>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'users',
			{ userId: id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
		)
	}

	async updateMonitorEvent(
		id: number,
		update: Partial<TableMonitorEvent>,
		trx?: TrxToken,
	): Promise<number> {
		await this.verifyReadyForDatabaseAccess(trx)
		return await this.updateRows(
			'monitor_events',
			{ id },
			this.validatePartialForUpdate(
				update as Partial<EntityTimeStamp>,
			) as Record<string, unknown>,
			trx as PgTrxToken | undefined,
		)
	}

	// -----------------------------------------------------------------------
	// FIND methods
	// -----------------------------------------------------------------------

	async findCertificateFields(
		args: FindCertificateFieldsArgs,
	): Promise<TableCertificateField[]> {
		return this.validateEntities(
			(await this.selectQuery('certificate_fields', args)) as unknown as TableCertificateField[],
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
			(await this.selectQuery(
				'certificates',
				args,
				extraWhere || undefined,
				extraParams.length > 0 ? extraParams : undefined,
			)) as unknown as TableCertificateX[],
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
			(await this.selectQuery('commissions', args)) as unknown as TableCommission[],
			undefined,
			['isRedeemed'],
		)
	}

	async findOutputBaskets(
		args: FindOutputBasketsArgs,
	): Promise<TableOutputBasket[]> {
		return this.validateEntities(
			(await this.selectQuery('output_baskets', args)) as unknown as TableOutputBasket[],
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
			extraWhere = `(SELECT status FROM transactions WHERE transactions."transactionId" = outputs."transactionId") IN (${statusList})`
		}
		const tagClause = buildOutputTagFilterSql(tagIds, isQueryModeAll)
		if (tagClause) {
			extraWhere = extraWhere ? `${extraWhere} AND ${tagClause.sql}` : tagClause.sql
			extraParams.push(...tagClause.params)
		}

		const columns = args.noScript
			? outputColumnsWithoutLockingScript.map((c) => `outputs.${this.quoteCol(c)}`)
			: undefined

		const r = (await this.selectQuery<QueryResultRow>(
			'outputs',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
			columns,
		)) as unknown as TableOutput[]

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
			extraWhere = `"outputTagId" IN (${args.tagIds.map(() => '?').join(',')})`
			extraParams.push(...args.tagIds)
		}
		return this.validateEntities(
			(await this.selectQuery(
				'output_tags_map',
				args,
				extraWhere || undefined,
				extraParams.length > 0 ? extraParams : undefined,
			)) as unknown as TableOutputTagMap[],
			undefined,
			['isDeleted'],
		)
	}

	async findOutputTags(args: FindOutputTagsArgs): Promise<TableOutputTag[]> {
		return this.validateEntities(
			(await this.selectQuery('output_tags', args)) as unknown as TableOutputTag[],
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
			(await this.selectQuery(
				'proven_tx_reqs',
				args,
				extraWhere || undefined,
				extraParams.length > 0 ? extraParams : undefined,
			)) as unknown as TableProvenTxReq[],
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
			(await this.selectQuery('proven_txs', args)) as unknown as TableProvenTx[],
		)
	}

	async findSyncStates(args: FindSyncStatesArgs): Promise<TableSyncState[]> {
		return this.validateEntities(
			(await this.selectQuery('sync_states', args)) as unknown as TableSyncState[],
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
			? transactionColumnsWithoutRawTx.map((c) => `transactions.${this.quoteCol(c)}`)
			: undefined

		const r = (await this.selectQuery<QueryResultRow>(
			'transactions',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
			columns,
		)) as unknown as TableTransaction[]

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
			extraWhere = `"txLabelId" IN (${args.labelIds.map(() => '?').join(',')})`
			extraParams.push(...args.labelIds)
		}
		return this.validateEntities(
			(await this.selectQuery(
				'tx_labels_map',
				args,
				extraWhere || undefined,
				extraParams.length > 0 ? extraParams : undefined,
			)) as unknown as TableTxLabelMap[],
			undefined,
			['isDeleted'],
		)
	}

	async findTxLabels(args: FindTxLabelsArgs): Promise<TableTxLabel[]> {
		return this.validateEntities(
			(await this.selectQuery('tx_labels', args)) as unknown as TableTxLabel[],
			undefined,
			['isDeleted'],
		)
	}

	async findUsers(args: FindUsersArgs): Promise<TableUser[]> {
		return this.validateEntities(
			(await this.selectQuery('users', args)) as unknown as TableUser[],
		)
	}

	/**
	 * SQL-backed implementation replacing the base-class JS scan. Matches
	 * StorageBunSqlite.recentlyActiveUsers and Knex canon at
	 * StorageKnex.ts:796.
	 */
	async recentlyActiveUsers(limit = 50, trx?: TrxToken): Promise<TableUser[]> {
		const rows = await this.allSql<QueryResultRow>(
			`SELECT u.*
			FROM users u
			JOIN (
				SELECT "userId", MAX(created_at) AS "lastOutputCreatedAt"
				FROM outputs
				GROUP BY "userId"
			) latest ON u."userId" = latest."userId"
			ORDER BY latest."lastOutputCreatedAt" DESC
			LIMIT ?`,
			[limit],
			trx as PgTrxToken | undefined,
		)
		return this.validateEntities(rows as unknown as TableUser[])
	}

	async findMonitorEvents(
		args: FindMonitorEventsArgs,
	): Promise<TableMonitorEvent[]> {
		return this.validateEntities(
			(await this.selectQuery('monitor_events', args)) as unknown as TableMonitorEvent[],
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
		return await this.countQuery('certificate_fields', args)
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
		return await this.countQuery(
			'certificates',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
		)
	}
	async countCommissions(args: FindCommissionsArgs): Promise<number> {
		return await this.countQuery('commissions', args)
	}
	async countOutputBaskets(args: FindOutputBasketsArgs): Promise<number> {
		return await this.countQuery('output_baskets', args)
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
			extraWhere = `(SELECT status FROM transactions WHERE transactions."transactionId" = outputs."transactionId") IN (${statusList})`
		}
		const tagClause = buildOutputTagFilterSql(tagIds, isQueryModeAll)
		if (tagClause) {
			extraWhere = extraWhere ? `${extraWhere} AND ${tagClause.sql}` : tagClause.sql
			extraParams.push(...tagClause.params)
		}
		return await this.countQuery(
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
			extraWhere = `"outputTagId" IN (${args.tagIds.map(() => '?').join(',')})`
			extraParams.push(...args.tagIds)
		}
		return await this.countQuery(
			'output_tags_map',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
		)
	}
	async countOutputTags(args: FindOutputTagsArgs): Promise<number> {
		return await this.countQuery('output_tags', args)
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
		return await this.countQuery(
			'proven_tx_reqs',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
		)
	}
	async countProvenTxs(args: FindProvenTxsArgs): Promise<number> {
		return await this.countQuery('proven_txs', args)
	}
	async countSyncStates(args: FindSyncStatesArgs): Promise<number> {
		return await this.countQuery('sync_states', args)
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
		return await this.countQuery(
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
			extraWhere = `"txLabelId" IN (${args.labelIds.map(() => '?').join(',')})`
			extraParams.push(...args.labelIds)
		}
		return await this.countQuery(
			'tx_labels_map',
			args,
			extraWhere || undefined,
			extraParams.length > 0 ? extraParams : undefined,
		)
	}
	async countTxLabels(args: FindTxLabelsArgs): Promise<number> {
		return await this.countQuery('tx_labels', args)
	}
	async countUsers(args: FindUsersArgs): Promise<number> {
		return await this.countQuery('users', args)
	}
	async countMonitorEvents(args: FindMonitorEventsArgs): Promise<number> {
		return await this.countQuery('monitor_events', args)
	}
	async countChangeInputs(
		userId: number,
		basketId: number,
		excludeSending: boolean,
	): Promise<number> {
		const status = ['completed', 'unproven']
		if (!excludeSending) status.push('sending')
		const statusText = status.map((s) => `'${s}'`).join(',')
		const txStatusCondition = `(SELECT status FROM transactions WHERE outputs."transactionId" = transactions."transactionId") IN (${statusText})`
		const row = await this.getSql<{ cnt: number | string }>(
			`SELECT COUNT(*) as cnt FROM outputs WHERE "userId" = ? AND spendable = 1 AND "basketId" = ? AND ${txStatusCondition}`,
			[userId, basketId],
		)
		return Number(row?.cnt ?? 0)
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
		trx?: TrxToken,
	): Promise<TableTxLabel[]> {
		if (transactionId === undefined) return []
		const rows = await this.allSql(
			`SELECT tx_labels.* FROM tx_labels
			 JOIN tx_labels_map ON tx_labels_map."txLabelId" = tx_labels."txLabelId"
			 WHERE tx_labels_map."transactionId" = ? AND tx_labels_map."isDeleted" != 1 AND tx_labels."isDeleted" != 1`,
			[transactionId],
			trx as PgTrxToken | undefined,
		)
		return this.validateEntities(
			rows as unknown as TableTxLabel[],
			undefined,
			['isDeleted'],
		)
	}

	async getTagsForOutputId(
		outputId: number,
		trx?: TrxToken,
	): Promise<TableOutputTag[]> {
		const rows = await this.allSql(
			`SELECT output_tags.* FROM output_tags
			 JOIN output_tags_map ON output_tags_map."outputTagId" = output_tags."outputTagId"
			 WHERE output_tags_map."outputId" = ? AND output_tags_map."isDeleted" != 1 AND output_tags."isDeleted" != 1`,
			[outputId],
			trx as PgTrxToken | undefined,
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
		const txStatusCondition = `AND (SELECT status FROM transactions WHERE outputs."transactionId" = transactions."transactionId") IN (${statusText})`

		const r = await this.transaction(async (trx) => {
			let outputId: number | undefined

			// These inlined SQL fragments embed userId/basketId/targetSatoshis
			// as literals (they are validated integers from call sites), which
			// matches the StorageBunSqlite structure. Parameter binding here
			// would complicate the correlated-subquery shape without changing
			// the SQL semantics.
			const setOutputId = async (rawQuery: string): Promise<void> => {
				const row = await this.getSql<{ outputId: number }>(
					rawQuery,
					[],
					trx as unknown as PgTrxToken,
				)
				outputId = row?.outputId
			}

			if (exactSatoshis !== undefined) {
				await setOutputId(`
					SELECT "outputId" FROM outputs
					WHERE "userId" = ${userId} AND spendable = 1 AND "basketId" = ${basketId}
					${txStatusCondition} AND satoshis = ${exactSatoshis}
					LIMIT 1
				`)
			}

			if (outputId === undefined) {
				await setOutputId(`
					SELECT "outputId" FROM outputs
					WHERE "userId" = ${userId} AND spendable = 1 AND "basketId" = ${basketId}
					${txStatusCondition}
					AND satoshis - ${targetSatoshis} = (
						SELECT MIN(satoshis - ${targetSatoshis}) FROM outputs
						WHERE "userId" = ${userId} AND spendable = 1 AND "basketId" = ${basketId}
						${txStatusCondition} AND satoshis - ${targetSatoshis} >= 0
					)
					LIMIT 1
				`)
			}

			if (outputId === undefined) {
				await setOutputId(`
					SELECT "outputId" FROM outputs
					WHERE "userId" = ${userId} AND spendable = 1 AND "basketId" = ${basketId}
					${txStatusCondition}
					AND satoshis - ${targetSatoshis} = (
						SELECT MAX(satoshis - ${targetSatoshis}) FROM outputs
						WHERE "userId" = ${userId} AND spendable = 1 AND "basketId" = ${basketId}
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
			// Hydrate locking script if it was offloaded due to exceeding
			// maxOutputScript. MED-14: only the chosen output needs hydration,
			// not every candidate during the SELECT scan.
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

		let specOp: ReturnType<typeof getLabelToSpecOp>[string] | undefined = undefined
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
			const rows = await this.allSql<{ txLabelId: number }>(
				`SELECT "txLabelId" FROM tx_labels WHERE "userId" = ? AND "isDeleted" = 0 AND "txLabelId" IS NOT NULL AND label IN (${placeholders})`,
				[auth.userId, ...labels],
			)
			labelIds = rows.map((r) => r.txLabelId)
		}

		const isQueryModeAll = vargs.labelQueryMode === 'all'
		if (isQueryModeAll && labelIds.length < labels.length) return r
		if (!isQueryModeAll && labelIds.length === 0 && labels.length > 0) return r

		const columns = [
			'created_at',
			'"transactionId"',
			'reference',
			'txid',
			'satoshis',
			'status',
			'"isOutgoing"',
			'description',
			'version',
			'"lockTime"',
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
			const tsFilter = buildTimestampFilter()
			const whereParts = ['"userId" = ?', `status IN (${statusText})`]
			const params: unknown[] = [auth.userId]
			if (tsFilter.clause) {
				whereParts.push(tsFilter.clause)
				params.push(...tsFilter.params)
			}
			const whereStr = whereParts.join(' AND ')

			const countRow = await this.getSql<{ total: number | string }>(
				`SELECT COUNT("transactionId") as total FROM transactions WHERE ${whereStr}`,
				params,
			)
			totalActions = Number(countRow?.total ?? 0)

			txs = await this.allSql(
				`SELECT ${columns.join(',')} FROM transactions WHERE ${whereStr} ORDER BY "transactionId" ASC LIMIT ? OFFSET ?`,
				[...params, limit, offset],
			)
		} else {
			const labelIdList = labelIds.join(',')
			const tsFilter = buildTimestampFilter()

			const cteSql = `
				SELECT ${columns.map((c) => `t.${c.startsWith('"') ? c : `"${c}"`}`).join(',')},
					(SELECT COUNT(*) FROM tx_labels_map AS m
					 WHERE m."transactionId" = t."transactionId" AND m."txLabelId" IN (${labelIdList})) AS lc
				FROM transactions AS t
				WHERE t."userId" = ? AND t.status IN (${statusText})
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

			const countRow = await this.getSql<{ total: number | string }>(
				`WITH tlc AS (${cteSql}) SELECT COUNT("transactionId") as total FROM tlc WHERE ${filterStr}`,
				cteParams,
			)
			totalActions = Number(countRow?.total ?? 0)

			txs = await this.allSql(
				`WITH tlc AS (${cteSql}) SELECT ${columns.join(',')} FROM tlc WHERE ${filterStr} ORDER BY "transactionId" ASC LIMIT ? OFFSET ?`,
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
				satoshis: Number(tx.satoshis || 0),
				status: tx.status as string,
				isOutgoing: !!tx.isOutgoing,
				description: (tx.description as string) || '',
				version: Number(tx.version || 0),
				lockTime: Number(tx.lockTime || 0),
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
						if (timeFilterRequested) {
							const ts = tx.created_at
								? new Date(tx.created_at as string | Date).getTime()
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
								satoshis: Number(o.satoshis || 0),
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
									sourceSatoshis: Number(o.satoshis || 0),
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
			// MED-16: negative offset = tail pagination with reversed cursor.
			offset = -offset - 1
			orderBy = 'DESC'
		}

		const r: ListOutputsResult = { totalOutputs: 0, outputs: [] }

		let { specOp, basket, tags } = getListOutputsSpecOp(vargs.basket, vargs.tags)
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
			const rows = await this.allSql<{ outputTagId: number }>(
				`SELECT "outputTagId" FROM output_tags WHERE "userId" = ? AND "isDeleted" = 0 AND "outputTagId" IS NOT NULL AND tag IN (${placeholders})`,
				[userId, ...tags],
			)
			tagIds = rows.map((r) => r.outputTagId)
		}

		const isQueryModeAll = vargs.tagQueryMode === 'all'
		if (isQueryModeAll && tagIds.length < tags.length) return r
		if (!isQueryModeAll && tagIds.length === 0 && tags.length > 0) return r

		let columns = [
			'"outputId"',
			'"transactionId"',
			'"basketId"',
			'spendable',
			'txid',
			'vout',
			'satoshis',
			'"customInstructions"',
			'"outputDescription"',
			'"spendingDescription"',
		]
		if (vargs.includeLockingScripts || specOp?.includeOutputScripts)
			columns = [...columns, '"lockingScript"', '"scriptLength"', '"scriptOffset"']

		const noTags = tagIds.length === 0
		const includeSpent = specOp?.includeSpent ? specOp.includeSpent : false
		// HIGH-7: 'sending' must be in the status filter so users mid-broadcast
		// don't see outputs disappear.
		const txStatusOk = `(SELECT status FROM transactions WHERE transactions."transactionId" = outputs."transactionId") IN ('completed','unproven','nosend','sending')`

		if (specOp?.totalOutputsIsSumOfSatoshis) {
			if (noTags) {
				const whereParts = ['"userId" = ?']
				const params: unknown[] = [userId]
				if (basketId) {
					whereParts.push('"basketId" = ?')
					params.push(basketId)
				}
				if (!includeSpent) {
					whereParts.push('spendable = 1')
				}
				whereParts.push(txStatusOk)
				const row = await this.getSql<{ totalSatoshis: number | string | null }>(
					`SELECT SUM(satoshis) as "totalSatoshis" FROM outputs WHERE ${whereParts.join(' AND ')}`,
					params,
				)
				r.totalOutputs = Number(row?.totalSatoshis ?? 0)
				return r
			}
			const tagIdList = tagIds.join(',')
			let cteOpts = ''
			const params: unknown[] = [userId]
			if (basketId) {
				cteOpts += ' AND o."basketId" = ?'
				params.push(basketId)
			}
			if (!includeSpent) cteOpts += ' AND o.spendable = 1'
			const txStatusOkCte = `(SELECT status FROM transactions WHERE transactions."transactionId" = o."transactionId") IN ('completed','unproven','nosend','sending')`
			const cteSql = `
					SELECT o.satoshis,
						(SELECT COUNT(*) FROM output_tags_map AS m WHERE m."outputId" = o."outputId" AND m."outputTagId" IN (${tagIdList})) AS tc
					FROM outputs AS o
					WHERE o."userId" = ?${cteOpts} AND ${txStatusOkCte}
				`
			const filterStr = isQueryModeAll ? `tc = ${tagIds.length}` : 'tc > 0'
			const row = await this.getSql<{ totalSatoshis: number | string | null }>(
				`WITH otc AS (${cteSql}) SELECT SUM(satoshis) as "totalSatoshis" FROM otc WHERE ${filterStr}`,
				params,
			)
			r.totalOutputs = Number(row?.totalSatoshis ?? 0)
			return r
		}

		let outputs: Record<string, unknown>[]
		let totalCount: number

		if (noTags) {
			const whereParts = ['"userId" = ?']
			const params: unknown[] = [userId]
			if (basketId) {
				whereParts.push('"basketId" = ?')
				params.push(basketId)
			}
			if (!includeSpent) whereParts.push('spendable = 1')
			whereParts.push(txStatusOk)
			const whereStr = whereParts.join(' AND ')

			if (!specOp || !specOp.ignoreLimit) {
				outputs = await this.allSql(
					`SELECT ${columns.join(',')} FROM outputs WHERE ${whereStr} ORDER BY "outputId" ${orderBy} LIMIT ? OFFSET ?`,
					[...params, limit, offset],
				)
			} else {
				outputs = await this.allSql(
					`SELECT ${columns.join(',')} FROM outputs WHERE ${whereStr} ORDER BY "outputId" ${orderBy}`,
					params,
				)
			}

			// LOW-26: gate COUNT on truncation.
			if (limit && outputs.length >= limit) {
				const countRow = await this.getSql<{ total: number | string }>(
					`SELECT COUNT("outputId") as total FROM outputs WHERE ${whereStr}`,
					params,
				)
				totalCount = Number(countRow?.total ?? 0)
			} else {
				totalCount = outputs.length
			}
		} else {
			const tagIdList = tagIds.join(',')
			let cteOpts = ''
			const params: unknown[] = [userId]
			if (basketId) {
				cteOpts += ' AND o."basketId" = ?'
				params.push(basketId)
			}
			if (!includeSpent) cteOpts += ' AND o.spendable = 1'
			const txStatusOkCte = `(SELECT status FROM transactions WHERE transactions."transactionId" = o."transactionId") IN ('completed','unproven','nosend','sending')`

			const cteSql = `
				SELECT ${columns.map((c) => `o.${c}`).join(',')},
					(SELECT COUNT(*) FROM output_tags_map AS m WHERE m."outputId" = o."outputId" AND m."outputTagId" IN (${tagIdList})) AS tc
				FROM outputs AS o
				WHERE o."userId" = ?${cteOpts} AND ${txStatusOkCte}
			`
			const filterStr = isQueryModeAll ? `tc = ${tagIds.length}` : 'tc > 0'

			if (!specOp || !specOp.ignoreLimit) {
				outputs = await this.allSql(
					`WITH otc AS (${cteSql}) SELECT ${columns.join(',')} FROM otc WHERE ${filterStr} ORDER BY "outputId" ${orderBy} LIMIT ? OFFSET ?`,
					[...params, limit, offset],
				)
			} else {
				outputs = await this.allSql(
					`WITH otc AS (${cteSql}) SELECT ${columns.join(',')} FROM otc WHERE ${filterStr} ORDER BY "outputId" ${orderBy}`,
					params,
				)
			}

			if (limit && outputs.length >= limit) {
				const countRow = await this.getSql<{ total: number | string }>(
					`WITH otc AS (${cteSql}) SELECT COUNT("outputId") as total FROM otc WHERE ${filterStr}`,
					params,
				)
				totalCount = Number(countRow?.total ?? 0)
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
					beef,
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

		if (params.purgeCompleted) {
			const age = params.purgeCompletedAge || defaultAge
			const before = new Date(Date.now() - age)

			const updRes = await this.runSql(
				`UPDATE transactions SET "inputBEEF" = NULL, "rawTx" = NULL
				 WHERE updated_at < ? AND status = 'completed' AND "provenTxId" IS NOT NULL
				 AND ("inputBEEF" IS NOT NULL OR "rawTx" IS NOT NULL)`,
				[before],
			)
			let cnt = updRes.rowCount ?? 0
			if (cnt > 0) {
				r.count += cnt
				r.log += `${cnt} completed transactions purged of transient data\n`
			}

			const completedReqs = await this.allSql<{ provenTxReqId: number }>(
				`SELECT "provenTxReqId" FROM proven_tx_reqs
				 WHERE updated_at < ? AND status = 'completed' AND "provenTxId" IS NOT NULL AND notified = 1`,
				[before],
			)
			if (completedReqs.length > 0) {
				const ids = completedReqs.map((r) => r.provenTxReqId)
				const placeholders = ids.map(() => '?').join(',')
				const delRes = await this.runSql(
					`DELETE FROM proven_tx_reqs WHERE "provenTxReqId" IN (${placeholders})`,
					ids as number[],
				)
				cnt = delRes.rowCount ?? 0
				if (cnt > 0) {
					r.count += cnt
					r.log += `${cnt} completed proven_tx_reqs deleted\n`
				}
			}
		}

		if (params.purgeFailed) {
			const age = params.purgeFailedAge || defaultAge
			const before = new Date(Date.now() - age)

			const failedTxs = await this.allSql<{ transactionId: number }>(
				`SELECT "transactionId" FROM transactions WHERE updated_at < ? AND status = 'failed'`,
				[before],
			)
			const failedTxIds = failedTxs.map((t) => t.transactionId)
			if (failedTxIds.length > 0) {
				await this.deleteTransactions(failedTxIds, r, 'failed', true)
			}

			const invalidReqs = await this.allSql<{ provenTxReqId: number }>(
				`SELECT "provenTxReqId" FROM proven_tx_reqs WHERE updated_at < ? AND status = 'invalid'`,
				[before],
			)
			if (invalidReqs.length > 0) {
				const ids = invalidReqs.map((r) => r.provenTxReqId)
				const placeholders = ids.map(() => '?').join(',')
				const delRes = await this.runSql(
					`DELETE FROM proven_tx_reqs WHERE "provenTxReqId" IN (${placeholders})`,
					ids as number[],
				)
				const cnt = delRes.rowCount ?? 0
				if (cnt > 0) {
					r.count += cnt
					r.log += `${cnt} invalid proven_tx_reqs deleted\n`
				}
			}

			const dsReqs = await this.allSql<{ provenTxReqId: number }>(
				`SELECT "provenTxReqId" FROM proven_tx_reqs WHERE updated_at < ? AND status = 'doubleSpend'`,
				[before],
			)
			if (dsReqs.length > 0) {
				const ids = dsReqs.map((r) => r.provenTxReqId)
				const placeholders = ids.map(() => '?').join(',')
				const delRes = await this.runSql(
					`DELETE FROM proven_tx_reqs WHERE "provenTxReqId" IN (${placeholders})`,
					ids as number[],
				)
				const cnt = delRes.rowCount ?? 0
				if (cnt > 0) {
					r.count += cnt
					r.log += `${cnt} doubleSpend proven_tx_reqs deleted\n`
				}
			}
		}

		if (params.purgeSpent) {
			const age = params.purgeSpentAge || defaultAge
			const before = new Date(Date.now() - age)

			const beef = new Beef()
			const utxos = await this.findOutputs({
				partial: { spendable: true },
				txStatus: ['sending', 'unproven', 'completed', 'nosend'],
			})
			for (const utxo of utxos) {
				const options = { mergeToBeef: beef, ignoreServices: true }
				if (utxo.txid) await this.getBeefForTransaction(utxo.txid, options)
			}
			const proofTxids: Record<string, boolean> = {}
			for (const btx of beef.txs) proofTxids[btx.txid] = true

			const spentTxs = await this.allSql<TableTransaction>(
				`SELECT * FROM transactions WHERE updated_at < ? AND status = 'completed'
				 AND NOT EXISTS (SELECT "outputId" FROM outputs AS o WHERE o."transactionId" = transactions."transactionId" AND o.spendable = 1)`,
				[before],
			)
			const nptxs = spentTxs.filter((t) => !proofTxids[t.txid || ''])
			const spentTxIds = nptxs.map((tx) => tx.transactionId)

			if (spentTxIds.length > 0) {
				const placeholders = spentTxIds.map(() => '?').join(',')
				const updRes = await this.runSql(
					`UPDATE outputs SET "spentBy" = NULL, updated_at = ? WHERE spendable = 0 AND "spentBy" IN (${placeholders})`,
					[this.validateEntityDate(new Date()), ...spentTxIds],
				)
				const cnt = updRes.rowCount ?? 0
				if (cnt > 0) {
					r.count += cnt
					r.log += `${cnt} spent outputs no longer tracked by spentBy\n`
				}

				await this.deleteTransactions(spentTxIds, r, 'spent', false)
			}
		}

		const orphanRes = await this.runSql(
			`DELETE FROM proven_txs
			 WHERE NOT EXISTS (SELECT * FROM transactions AS t WHERE t.txid = proven_txs.txid OR t."provenTxId" = proven_txs."provenTxId")
			 AND NOT EXISTS (SELECT * FROM proven_tx_reqs AS r WHERE r.txid = proven_txs.txid OR r."provenTxId" = proven_txs."provenTxId")`,
		)
		const cnt = orphanRes.rowCount ?? 0
		if (cnt > 0) {
			r.count += cnt
			r.log += `${cnt} orphan proven_txs deleted\n`
		}

		return r
	}

	private async deleteTransactions(
		transactionIds: number[],
		r: PurgeResults,
		reason: string,
		markNotSpentBy: boolean,
	): Promise<void> {
		if (transactionIds.length === 0) return
		const placeholders = transactionIds.map(() => '?').join(',')

		const outputs = await this.allSql<{ outputId: number }>(
			`SELECT "outputId" FROM outputs WHERE "transactionId" IN (${placeholders})`,
			transactionIds,
		)
		const outputIds = outputs.map((o) => o.outputId)

		if (outputIds.length > 0) {
			const oPlaceholders = outputIds.map(() => '?').join(',')
			let res = await this.runSql(
				`DELETE FROM output_tags_map WHERE "outputId" IN (${oPlaceholders})`,
				outputIds as number[],
			)
			let cnt = res.rowCount ?? 0
			if (cnt > 0) {
				r.count += cnt
				r.log += `${cnt} ${reason} output_tags_map deleted\n`
			}

			res = await this.runSql(
				`DELETE FROM outputs WHERE "outputId" IN (${oPlaceholders})`,
				outputIds as number[],
			)
			cnt = res.rowCount ?? 0
			if (cnt > 0) {
				r.count += cnt
				r.log += `${cnt} ${reason} outputs deleted\n`
			}
		}

		let res = await this.runSql(
			`DELETE FROM tx_labels_map WHERE "transactionId" IN (${placeholders})`,
			transactionIds as number[],
		)
		let cnt = res.rowCount ?? 0
		if (cnt > 0) {
			r.count += cnt
			r.log += `${cnt} ${reason} tx_labels_map deleted\n`
		}

		res = await this.runSql(
			`DELETE FROM commissions WHERE "transactionId" IN (${placeholders})`,
			transactionIds as number[],
		)
		cnt = res.rowCount ?? 0
		if (cnt > 0) {
			r.count += cnt
			r.log += `${cnt} ${reason} commissions deleted\n`
		}

		if (markNotSpentBy) {
			res = await this.runSql(
				`UPDATE outputs SET spendable = 1, "spentBy" = NULL WHERE "spentBy" IN (${placeholders})`,
				transactionIds as number[],
			)
			cnt = res.rowCount ?? 0
			if (cnt > 0) {
				r.count += cnt
				r.log += `${cnt} unspent outputs updated to spendable\n`
			}
		}

		res = await this.runSql(
			`DELETE FROM transactions WHERE "transactionId" IN (${placeholders})`,
			transactionIds as number[],
		)
		cnt = res.rowCount ?? 0
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

		const r1 = await this.runSql(`
			UPDATE transactions SET status = 'failed'
			WHERE status != 'failed'
			AND EXISTS (SELECT 1 FROM proven_tx_reqs AS r WHERE transactions.txid = r.txid AND r.status = 'invalid')
		`)
		let cnt = r1.rowCount ?? 0
		if (cnt > 0)
			r.log += `${cnt} transactions updated to status of 'failed' where provenTxReq with matching txid is 'invalid'\n`

		const r2 = await this.runSql(`
			UPDATE outputs SET "spentBy" = NULL, spendable = 1
			WHERE EXISTS (SELECT 1 FROM transactions AS t WHERE outputs."spentBy" = t."transactionId" AND t.status = 'failed')
		`)
		cnt = r2.rowCount ?? 0
		if (cnt > 0)
			r.log += `${cnt} outputs updated to spendable where spentBy is a transaction with status 'failed'\n`

		const r3 = await this.runSql(`
			UPDATE transactions SET status = 'completed',
				"provenTxId" = (SELECT "provenTxId" FROM proven_txs AS p WHERE transactions.txid = p.txid)
			WHERE "provenTxId" IS NULL
			AND EXISTS (SELECT 1 FROM proven_txs AS p WHERE transactions.txid = p.txid)
		`)
		cnt = r3.rowCount ?? 0
		if (cnt > 0)
			r.log += `${cnt} transactions updated with provenTxId and status of 'completed' where provenTx with matching txid exists\n`

		return r
	}

	// -----------------------------------------------------------------------
	// adminStats — MySQL-only in StorageKnex, throw here.
	// -----------------------------------------------------------------------

	async adminStats(_adminIdentityKey: string): Promise<AdminStatsResult> {
		throw new WERR_NOT_IMPLEMENTED('adminStats, only MySQL is supported')
	}
}
