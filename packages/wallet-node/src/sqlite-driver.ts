/**
 * Runtime-selected SQLite driver.
 *
 * `bun:sqlite` under Bun, `node:sqlite` (Node ≥ 22.13) under Node, exposed
 * behind the three calls StorageBunSqlite actually uses: `run`, `query`,
 * `close`. Both are loaded synchronously through `process.getBuiltinModule`
 * so the storage constructor stays synchronous and nothing here is bundled.
 */

export type SqliteParam =
	| string
	| number
	| bigint
	| boolean
	| null
	| undefined
	| Buffer
	| Uint8Array

export interface SqliteStatement {
	/** First row, or null when none. */
	get(...params: SqliteParam[]): unknown
	all(...params: SqliteParam[]): unknown[]
}

export interface SqliteDb {
	/** Execute a statement (or several, when no params are bound). */
	run(sql: string, params?: SqliteParam[]): void
	query(sql: string): SqliteStatement
	close(): void
}

/** Minimal `prepare`-style surface shared by both drivers' Database classes. */
export interface SqliteDatabaseLike {
	prepare(sql: string): {
		get(...params: SqliteParam[]): unknown
		all(...params: SqliteParam[]): unknown[]
		run(...params: SqliteParam[]): unknown
	}
	exec?(sql: string): void
	close(): void
}

type BuiltinLoader = (id: string) => unknown

function builtin(id: string): unknown {
	const load = (process as unknown as { getBuiltinModule?: BuiltinLoader })
		.getBuiltinModule
	if (typeof load !== 'function') {
		throw new Error(
			`process.getBuiltinModule is unavailable; ${id} needs Bun ≥ 1.1 or Node ≥ 22.3`,
		)
	}
	return load(id)
}

export function isBun(): boolean {
	return 'Bun' in globalThis
}

/**
 * The runtime's Database class (`bun:sqlite` Database or `node:sqlite`
 * DatabaseSync). Both expose `prepare(sql).get/all/run`.
 */
export function sqliteDatabaseClass(): new (
	filename: string,
) => SqliteDatabaseLike {
	if (isBun()) {
		return (builtin('bun:sqlite') as { Database: unknown }).Database as new (
			filename: string,
		) => SqliteDatabaseLike
	}
	return (builtin('node:sqlite') as { DatabaseSync: unknown })
		.DatabaseSync as new (
		filename: string,
	) => SqliteDatabaseLike
}

/** Open a database file (or ':memory:') with the runtime's driver. */
export function openSqlite(filename: string): SqliteDb {
	const Database = sqliteDatabaseClass()
	const db = new Database(filename)
	// bun:sqlite's Database already has run/query/close with these shapes.
	if (isBun()) return db as unknown as SqliteDb
	return new NodeSqliteDb(db)
}

/** node:sqlite refuses booleans and undefined; bun coerces them. */
function bind(params: SqliteParam[]): SqliteParam[] {
	return params.map((p) =>
		p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p,
	)
}

class NodeSqliteDb implements SqliteDb {
	constructor(private db: SqliteDatabaseLike) {}

	run(sql: string, params: SqliteParam[] = []): void {
		if (params.length === 0 && this.db.exec) {
			// exec handles multi-statement SQL (schema blocks); prepare does not.
			this.db.exec(sql)
			return
		}
		this.db.prepare(sql).run(...bind(params))
	}

	query(sql: string): SqliteStatement {
		const st = this.db.prepare(sql)
		return {
			get: (...params) => st.get(...bind(params)) ?? null,
			all: (...params) => st.all(...bind(params)),
		}
	}

	close(): void {
		this.db.close()
	}
}
