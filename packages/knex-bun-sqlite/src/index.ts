import { Database } from 'bun:sqlite'
// @ts-expect-error knex internals don't ship a public type for sqlite3 dialect
import Client_SQLite3 from 'knex/lib/dialects/sqlite3/index.js'

interface ConnectionOptions {
	readonly?: boolean
	create?: boolean
	safeIntegers?: boolean
}

interface QueryObj {
	sql: string
	bindings?: unknown[]
	options?: ConnectionOptions
	response?: unknown
	context?: { lastID: number | bigint; changes: number }
}

interface KnexClientBase {
	connectionSettings: {
		filename?: string
		options?: ConnectionOptions
	}
	driver: typeof Database
}

class Client_BunSqlite extends (Client_SQLite3 as new (
	...args: unknown[]
) => KnexClientBase) {
	_driver(): typeof Database {
		return Database
	}

	async acquireRawConnection(): Promise<Database> {
		const filename = this.connectionSettings.filename ?? ':memory:'
		const options = this.connectionSettings.options ?? {}

		const db = new this.driver(filename, {
			readonly: options.readonly === true,
			create: options.create !== false,
			safeIntegers: options.safeIntegers === true,
		})

		return db
	}

	async destroyRawConnection(connection: Database): Promise<void> {
		connection.close()
	}

	async _query(connection: Database, obj: QueryObj): Promise<QueryObj> {
		if (!obj.sql) throw new Error('The query is empty')
		if (!connection) throw new Error('No connection provided')

		const statement = connection.prepare(obj.sql)
		const bindings = formatBindings(obj.bindings)

		const isReader = (statement.columnNames?.length ?? 0) > 0

		if (isReader) {
			obj.response = statement.all(...(bindings as never[]))
			return obj
		}

		const result = statement.run(...(bindings as never[])) as {
			changes: number
			lastInsertRowid: number | bigint
		}
		obj.response = result
		obj.context = {
			lastID: result.lastInsertRowid,
			changes: result.changes,
		}
		return obj
	}

	_formatBindings(bindings: unknown[] | undefined): unknown[] {
		return formatBindings(bindings)
	}
}

Object.assign(Client_BunSqlite.prototype, {
	driverName: 'better-sqlite3',
})

function formatBindings(bindings: unknown[] | undefined): unknown[] {
	if (!bindings) return []
	return bindings.map((binding) => {
		if (binding instanceof Date) return binding.valueOf()
		if (typeof binding === 'boolean') return Number(binding)
		return binding
	})
}

export default Client_BunSqlite
export { Client_BunSqlite }
