import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { Utils } from 'electrobun/bun'

const SCHEMA = `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`

let instance: ConfigStore | undefined

export function getConfigStore(): ConfigStore {
	if (!instance) {
		// Use Electrobun's channel-isolated userData directory
		const configPath = `${Utils.paths.userData}/config.db`
		instance = new ConfigStore(configPath)
	}
	return instance
}

export function closeConfigStore(): void {
	instance?.close()
	instance = undefined
}

export class ConfigStore {
	private db: Database

	constructor(path: string) {
		mkdirSync(dirname(path), { recursive: true })
		this.db = new Database(path)
		this.db.exec('PRAGMA journal_mode=WAL')
		this.db.exec('PRAGMA busy_timeout=5000')
		this.db.exec('PRAGMA synchronous=NORMAL')
		this.db.exec(SCHEMA)
	}

	get(key: string): string | undefined {
		const row = this.db
			.query<{ value: string }, [string]>(
				'SELECT value FROM config WHERE key = ?',
			)
			.get(key)
		return row?.value
	}

	set(key: string, value: string): void {
		this.db
			.query('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
			.run(key, value)
	}

	delete(key: string): void {
		this.db.query('DELETE FROM config WHERE key = ?').run(key)
	}

	list(prefix?: string): Record<string, string> {
		const rows = prefix
			? this.db
					.query<{ key: string; value: string }, [string]>(
						'SELECT key, value FROM config WHERE key LIKE ?',
					)
					.all(`${prefix}%`)
			: this.db
					.query<{ key: string; value: string }, []>(
						'SELECT key, value FROM config',
					)
					.all()

		const result: Record<string, string> = {}
		for (const row of rows) {
			result[row.key] = row.value
		}
		return result
	}

	close(): void {
		this.db.close()
	}
}
