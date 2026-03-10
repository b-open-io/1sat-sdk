import type { ProcessedTxStore } from './ProcessedTxStore'

interface SqliteDatabase {
	exec(sql: string): void
	prepare(sql: string): SqliteStatement
	close(): void
}

interface SqliteStatement {
	run(...params: unknown[]): { changes: number }
	get(...params: unknown[]): unknown
}

export class ProcessedTxStoreSqlite implements ProcessedTxStore {
	private db: SqliteDatabase

	constructor(db: SqliteDatabase) {
		this.db = db
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS processed_txids (
				txid TEXT PRIMARY KEY,
				created_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS sync_state (
				key TEXT PRIMARY KEY,
				value REAL NOT NULL
			);
		`)
	}

	static open(
		dbPath: string,
		Database: new (path: string) => SqliteDatabase,
	): ProcessedTxStoreSqlite {
		return new ProcessedTxStoreSqlite(new Database(dbPath))
	}

	async has(txid: string): Promise<boolean> {
		const row = this.db
			.prepare('SELECT 1 FROM processed_txids WHERE txid = ?')
			.get(txid)
		return !!row
	}

	async add(txid: string): Promise<void> {
		this.db
			.prepare(
				'INSERT OR IGNORE INTO processed_txids (txid, created_at) VALUES (?, ?)',
			)
			.run(txid, Date.now())
	}

	async getLastScore(): Promise<number> {
		const row = this.db
			.prepare("SELECT value FROM sync_state WHERE key = 'lastScore'")
			.get() as { value: number } | undefined
		return row?.value ?? 0
	}

	async setLastScore(score: number): Promise<void> {
		this.db
			.prepare(
				"INSERT OR REPLACE INTO sync_state (key, value) VALUES ('lastScore', ?)",
			)
			.run(score)
	}

	async close(): Promise<void> {
		this.db.close()
	}
}
