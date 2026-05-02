import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import knexLib, { type Knex } from 'knex'
import Client_BunSqlite from '../src/index'

let dbPath: string
let knex: Knex

beforeEach(() => {
	dbPath = join(
		tmpdir(),
		`knex-bun-sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
	)
	knex = knexLib({
		client: Client_BunSqlite as unknown as Knex.Config['client'],
		connection: { filename: dbPath },
		useNullAsDefault: true,
	})
})

afterEach(async () => {
	await knex.destroy()
	if (existsSync(dbPath)) rmSync(dbPath)
})

describe('@1sat/knex-bun-sqlite', () => {
	test('runs portable schema-builder migrations (mirrors messagebox-server initial migration)', async () => {
		await knex.schema.createTable('messageBox', (t) => {
			t.increments('messageBoxId').primary()
			t.timestamps(true, true)
			t.string('type').notNullable()
			t.string('identityKey').notNullable()
			t.unique(['type', 'identityKey'])
		})

		await knex.schema.createTable('messages', (t) => {
			t.increments('messageId').primary()
			t.timestamps(true, true)
			t.integer('messageBoxId')
				.unsigned()
				.references('messageBoxId')
				.inTable('messageBox')
				.onDelete('CASCADE')
			t.string('sender').notNullable()
			t.string('recipient').notNullable()
			t.text('body', 'longtext').notNullable()
			t.boolean('acknowledged').defaultTo(false)
		})

		const tables = await knex
			.select<Array<{ name: string }>>('name')
			.from('sqlite_master')
			.where('type', 'table')
			.whereNot('name', 'like', 'sqlite_%')

		expect(tables.map((t) => t.name).sort()).toEqual(['messageBox', 'messages'])
	})

	test('insert returns autoincrement id and select retrieves rows', async () => {
		await knex.schema.createTable('messageBox', (t) => {
			t.increments('messageBoxId').primary()
			t.string('type').notNullable()
			t.string('identityKey').notNullable()
			t.unique(['type', 'identityKey'])
		})

		const [boxId] = await knex('messageBox').insert({
			type: 'inbox',
			identityKey: 'abc123',
		})

		expect(typeof boxId === 'number' || typeof boxId === 'bigint').toBe(true)
		expect(Number(boxId)).toBe(1)

		const rows = await knex('messageBox').select('*')
		expect(rows).toHaveLength(1)
		expect(rows[0].type).toBe('inbox')
		expect(rows[0].identityKey).toBe('abc123')
	})

	test('boolean and Date bindings are coerced', async () => {
		await knex.schema.createTable('events', (t) => {
			t.increments('id').primary()
			t.boolean('active').notNullable()
			t.bigInteger('ts').notNullable()
		})

		const now = new Date('2026-05-01T00:00:00Z')
		await knex('events').insert({ active: true, ts: now })

		const [row] = await knex('events').select('*')
		expect(row.active).toBe(1)
		expect(Number(row.ts)).toBe(now.valueOf())
	})

	test('update reports changes and delete removes rows', async () => {
		await knex.schema.createTable('items', (t) => {
			t.increments('id').primary()
			t.string('name').notNullable()
		})

		await knex('items').insert([{ name: 'a' }, { name: 'b' }, { name: 'c' }])

		const updated = await knex('items').where('name', 'b').update({ name: 'B' })
		expect(updated).toBe(1)

		const deleted = await knex('items').where('name', 'a').del()
		expect(deleted).toBe(1)

		const remaining = await knex('items').orderBy('id').select('name')
		expect(remaining.map((r) => r.name)).toEqual(['B', 'c'])
	})

	test('foreign key cascade deletes child rows', async () => {
		await knex.raw('PRAGMA foreign_keys = ON')

		await knex.schema.createTable('parents', (t) => {
			t.increments('id').primary()
		})
		await knex.schema.createTable('children', (t) => {
			t.increments('id').primary()
			t.integer('parentId')
				.unsigned()
				.references('id')
				.inTable('parents')
				.onDelete('CASCADE')
		})

		const [parentId] = await knex('parents').insert({})
		await knex('children').insert([{ parentId }, { parentId }])

		expect(await knex('children').count('* as n').first()).toEqual({ n: 2 })

		await knex('parents').where('id', parentId).del()

		expect(await knex('children').count('* as n').first()).toEqual({ n: 0 })
	})

	test('parameterized where + multi-row select', async () => {
		await knex.schema.createTable('messages', (t) => {
			t.increments('messageId').primary()
			t.string('sender').notNullable()
			t.string('recipient').notNullable()
			t.text('body').notNullable()
		})

		await knex('messages').insert([
			{ sender: 'alice', recipient: 'bob', body: 'hi' },
			{ sender: 'alice', recipient: 'carol', body: 'hello' },
			{ sender: 'dave', recipient: 'bob', body: 'yo' },
		])

		const fromAlice = await knex('messages')
			.where('sender', 'alice')
			.orderBy('messageId')
			.select('recipient', 'body')

		expect(fromAlice).toEqual([
			{ recipient: 'bob', body: 'hi' },
			{ recipient: 'carol', body: 'hello' },
		])
	})
})
