import type {
	AddressSyncQueueInput,
	AddressSyncQueueItem,
	AddressSyncQueueItemStatus,
	AddressSyncQueueStats,
	AddressSyncQueueStorage,
	AddressSyncState,
} from '@1sat/types'

/**
 * Generic interface for SQLite database (works with better-sqlite3 and bun:sqlite)
 */
interface SqliteDatabase {
	exec(sql: string): void
	prepare(sql: string): SqliteStatement
	close(): void
}

interface SqliteStatement {
	run(...params: unknown[]): { changes: number }
	get(...params: unknown[]): unknown
	all(...params: unknown[]): unknown[]
}

/**
 * SQLite implementation of AddressSyncQueueStorage for Node/Bun environments.
 *
 * Works with both `better-sqlite3` (Node) and `bun:sqlite` (Bun).
 */
export class AddressSyncQueueSqlite implements AddressSyncQueueStorage {
	private db: SqliteDatabase

	/**
	 * Create a new SQLite address sync queue.
	 * @param db - SQLite database instance (from better-sqlite3 or bun:sqlite)
	 */
	constructor(db: SqliteDatabase) {
		this.db = db
		this.initialize()
	}

	/**
	 * Create and open a SQLite database for an account.
	 * Helper for common use case.
	 *
	 * @param accountId - Unique identifier for the account (e.g., address, pubkey hash)
	 * @param dataDir - Directory for database files
	 * @param Database - SQLite Database constructor (e.g., from better-sqlite3 or bun:sqlite)
	 */
	static create(
		accountId: string,
		dataDir: string,
		// biome-ignore lint/suspicious/noExplicitAny: accepts any SQLite constructor
		Database: new (path: string) => any,
	): AddressSyncQueueSqlite {
		const dbPath = `${dataDir}/sync-queue-${accountId}.db`
		const db = new Database(dbPath)
		return new AddressSyncQueueSqlite(db)
	}

	private initialize(): void {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id TEXT PRIMARY KEY,
        outpoint TEXT NOT NULL,
        score INTEGER NOT NULL,
        spend_txid TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
      CREATE INDEX IF NOT EXISTS idx_queue_outpoint ON queue(outpoint);

      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
	}

	async enqueue(items: AddressSyncQueueInput[]): Promise<void> {
		if (items.length === 0) return

		const now = Date.now()
		const checkStmt = this.db.prepare('SELECT status FROM queue WHERE id = ?')
		const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO queue (id, outpoint, score, spend_txid, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', COALESCE((SELECT attempts FROM queue WHERE id = ?), 0), COALESCE((SELECT created_at FROM queue WHERE id = ?), ?), ?)
    `)

		for (const item of items) {
			const id = `${item.outpoint}:${item.score}`

			// Skip if already done
			const existing = checkStmt.get(id) as { status: string } | undefined
			if (existing?.status === 'done') {
				continue
			}

			insertStmt.run(
				id,
				item.outpoint,
				item.score,
				item.spendTxid ?? null,
				id,
				id,
				now,
				now,
			)
		}
	}

	async claim(count = 1): Promise<Map<string, AddressSyncQueueItem[]>> {
		const now = Date.now()

		// Step 1: Get up to `count` pending items as seeds
		const seedRows = this.db
			.prepare("SELECT * FROM queue WHERE status = 'pending' LIMIT ?")
			.all(count) as RawQueueRow[]

		if (seedRows.length === 0) return new Map()

		// Step 2: Get unique txids from seeds
		const txids = new Set<string>()
		for (const row of seedRows) {
			txids.add(row.outpoint.substring(0, 64))
		}

		// Step 3: For each txid, get ALL pending items
		const byTxid = new Map<string, AddressSyncQueueItem[]>()
		const allIds: string[] = []

		for (const txid of txids) {
			const rows = this.db
				.prepare(
					"SELECT * FROM queue WHERE outpoint LIKE ? AND status = 'pending'",
				)
				.all(`${txid}%`) as RawQueueRow[]

			if (rows.length > 0) {
				const items = rows.map((row) => this.rowToItem(row, 'processing', now))
				byTxid.set(txid, items)
				allIds.push(...rows.map((r) => r.id))
			}
		}

		// Step 4: Mark all gathered items as processing
		if (allIds.length > 0) {
			const placeholders = allIds.map(() => '?').join(',')
			this.db
				.prepare(
					`UPDATE queue SET status = 'processing', attempts = attempts + 1, updated_at = ?
           WHERE id IN (${placeholders})`,
				)
				.run(now, ...allIds)
		}

		return byTxid
	}

	async complete(id: string): Promise<void> {
		return this.completeMany([id])
	}

	async completeMany(ids: string[]): Promise<void> {
		if (ids.length === 0) return

		const now = Date.now()
		const placeholders = ids.map(() => '?').join(',')
		this.db
			.prepare(
				`UPDATE queue SET status = 'done', updated_at = ? WHERE id IN (${placeholders})`,
			)
			.run(now, ...ids)
	}

	async fail(id: string, error: string): Promise<void> {
		const now = Date.now()
		this.db
			.prepare(
				"UPDATE queue SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?",
			)
			.run(error, now, id)
	}

	async getByTxid(txid: string): Promise<AddressSyncQueueItem[]> {
		const rows = this.db
			.prepare('SELECT * FROM queue WHERE outpoint LIKE ?')
			.all(`${txid}%`) as RawQueueRow[]

		return rows.map((row) => this.rowToItem(row))
	}

	async getByStatus(
		status: AddressSyncQueueItemStatus,
		limit = 100,
	): Promise<AddressSyncQueueItem[]> {
		const rows = this.db
			.prepare('SELECT * FROM queue WHERE status = ? LIMIT ?')
			.all(status, limit) as RawQueueRow[]

		return rows.map((row) => this.rowToItem(row))
	}

	async getStats(): Promise<AddressSyncQueueStats> {
		const row = this.db
			.prepare(
				`SELECT
          COUNT(DISTINCT CASE WHEN status = 'pending' THEN substr(outpoint, 1, 64) END) as pending,
          COUNT(DISTINCT CASE WHEN status = 'processing' THEN substr(outpoint, 1, 64) END) as processing,
          COUNT(DISTINCT CASE WHEN status = 'done' THEN substr(outpoint, 1, 64) END) as done,
          COUNT(DISTINCT CASE WHEN status = 'failed' THEN substr(outpoint, 1, 64) END) as failed
        FROM queue`,
			)
			.get() as {
			pending: number
			processing: number
			done: number
			failed: number
		}

		return {
			pending: row.pending ?? 0,
			processing: row.processing ?? 0,
			done: row.done ?? 0,
			failed: row.failed ?? 0,
		}
	}

	async getState(): Promise<AddressSyncState> {
		const row = this.db
			.prepare("SELECT value FROM state WHERE key = 'syncState'")
			.get() as { value: string } | undefined

		if (!row) {
			return { lastQueuedScore: 0 }
		}

		return JSON.parse(row.value) as AddressSyncState
	}

	async setState(state: Partial<AddressSyncState>): Promise<void> {
		const current = await this.getState()
		const updated = { ...current, ...state }

		this.db
			.prepare(
				"INSERT OR REPLACE INTO state (key, value) VALUES ('syncState', ?)",
			)
			.run(JSON.stringify(updated))
	}

	async resetProcessing(): Promise<number> {
		const now = Date.now()
		const result = this.db
			.prepare(
				"UPDATE queue SET status = 'pending', updated_at = ? WHERE status = 'processing'",
			)
			.run(now)
		return result.changes
	}

	async clear(): Promise<void> {
		this.db.exec('DELETE FROM queue; DELETE FROM state;')
	}

	async close(): Promise<void> {
		this.db.close()
	}

	private rowToItem(
		row: RawQueueRow,
		statusOverride?: AddressSyncQueueItemStatus,
		updatedAtOverride?: number,
	): AddressSyncQueueItem {
		return {
			id: row.id,
			outpoint: row.outpoint,
			score: row.score,
			spendTxid: row.spend_txid ?? undefined,
			status: statusOverride ?? (row.status as AddressSyncQueueItemStatus),
			attempts: statusOverride ? row.attempts + 1 : row.attempts,
			lastError: row.last_error ?? undefined,
			createdAt: row.created_at,
			updatedAt: updatedAtOverride ?? row.updated_at,
		}
	}
}

interface RawQueueRow {
	id: string
	outpoint: string
	score: number
	spend_txid: string | null
	status: string
	attempts: number
	last_error: string | null
	created_at: number
	updated_at: number
}
