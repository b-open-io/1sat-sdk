import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoredGrant } from '@1sat/wallet'
import {
	FilePermissionStore,
	permissionStorePath,
} from '../src/wallet-api/permission-store'

const basketGrant = (originator: string, basket: string): StoredGrant => ({
	key: { type: 'basket', originator, basket },
	expiry: 0,
	grantedAt: 1_700_000_000_000,
	reason: 'test',
})

const protocolGrant = (originator: string): StoredGrant => ({
	key: {
		type: 'protocol',
		originator,
		privileged: false,
		protocolLevel: 1,
		protocolName: 'todo list',
		counterparty: '',
	},
	expiry: 0,
	grantedAt: 1_700_000_000_000,
})

describe('FilePermissionStore', () => {
	let dir: string
	let path: string

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), '1sat-perm-'))
		path = permissionStorePath(join(dir, 'data'), 'main')
	})

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
	})

	test('derives the path from data dir and chain', () => {
		expect(permissionStorePath('/x/data', 'test')).toBe(
			'/x/data/permissions-test.json',
		)
	})

	test('is empty before the file exists', async () => {
		const store = new FilePermissionStore(path)
		expect(await store.findGrant(basketGrant('gib', 'todo').key)).toBeNull()
		expect(await store.listGrants()).toEqual([])
		expect(existsSync(path)).toBe(false)
	})

	test('grants persist across instances with a private file mode', async () => {
		const a = new FilePermissionStore(path)
		await a.putGrant(basketGrant('gib', 'todo'))
		expect(statSync(path).mode & 0o777).toBe(0o600)
		expect(statSync(join(dir, 'data')).mode & 0o777).toBe(0o700)

		const b = new FilePermissionStore(path)
		expect(await b.findGrant(basketGrant('gib', 'todo').key)).toEqual(
			basketGrant('gib', 'todo'),
		)
	})

	test('put upserts by canonical key', async () => {
		const store = new FilePermissionStore(path)
		await store.putGrant(basketGrant('gib', 'todo'))
		await store.putGrant({ ...basketGrant('gib', 'todo'), expiry: 42 })
		const grants = await store.listGrants()
		expect(grants).toHaveLength(1)
		expect(grants[0].expiry).toBe(42)
	})

	test('delete removes one grant and is a no-op for unknown keys', async () => {
		const store = new FilePermissionStore(path)
		await store.putGrant(basketGrant('gib', 'todo'))
		await store.putGrant(protocolGrant('gib'))
		await store.deleteGrant(basketGrant('gib', 'todo').key)
		await store.deleteGrant(basketGrant('gib', 'missing').key)
		expect(await store.findGrant(basketGrant('gib', 'todo').key)).toBeNull()
		expect(
			await new FilePermissionStore(path).findGrant(protocolGrant('gib').key),
		).toEqual(protocolGrant('gib'))
	})

	test('lists by originator and type', async () => {
		const store = new FilePermissionStore(path)
		await store.putGrant(basketGrant('gib', 'todo'))
		await store.putGrant(basketGrant('bitplan.dev', 'plans'))
		await store.putGrant(protocolGrant('gib'))

		expect(await store.listGrants({ originator: 'gib' })).toHaveLength(2)
		expect(await store.listGrants({ type: 'basket' })).toHaveLength(2)
		expect(
			await store.listGrants({ originator: 'gib', type: 'protocol' }),
		).toEqual([protocolGrant('gib')])
	})

	test('deleteAllForOriginator reports the count and persists', async () => {
		const store = new FilePermissionStore(path)
		await store.putGrant(basketGrant('gib', 'todo'))
		await store.putGrant(protocolGrant('gib'))
		await store.putGrant(basketGrant('bitplan.dev', 'plans'))

		expect(await store.deleteAllForOriginator('gib')).toBe(2)
		expect(await store.deleteAllForOriginator('gib')).toBe(0)
		expect(await new FilePermissionStore(path).listGrants()).toEqual([
			basketGrant('bitplan.dev', 'plans'),
		])
	})
})
