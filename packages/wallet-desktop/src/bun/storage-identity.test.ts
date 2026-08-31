import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	createStorageIdentityKey,
	loadStorageIdentityKey,
	storageIdentityKeyForCreate,
} from './storage-identity'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
	const path = mkdtempSync(join(tmpdir(), '1sat-storage-identity-'))
	temporaryDirectories.push(path)
	return path
}

function writeSettings(databasePath: string, storageIdentityKey: string): void {
	const database = new Database(databasePath)
	database.exec('CREATE TABLE settings (storageIdentityKey TEXT NOT NULL)')
	database
		.query('INSERT INTO settings (storageIdentityKey) VALUES (?)')
		.run(storageIdentityKey)
	database.close()
}

afterEach(() => {
	for (const path of temporaryDirectories.splice(0)) {
		rmSync(path, { recursive: true, force: true })
	}
})

describe('desktop storage identity', () => {
	test('two installs of the same wallet get different provider identities', () => {
		const firstPath = join(temporaryDirectory(), 'wallet.db')
		const secondPath = join(temporaryDirectory(), 'wallet.db')

		const first = storageIdentityKeyForCreate(firstPath)
		const second = storageIdentityKeyForCreate(secondPath)

		expect(first).toMatch(/^1sat-wallet-[0-9a-f]{32}$/)
		expect(second).toMatch(/^1sat-wallet-[0-9a-f]{32}$/)
		expect(first).not.toBe(second)
	})

	test('reopen uses the exact identity persisted by the account database', () => {
		const databasePath = join(temporaryDirectory(), 'wallet.db')
		const created = createStorageIdentityKey()
		writeSettings(databasePath, created)

		expect(storageIdentityKeyForCreate(databasePath)).toBe(created)
		expect(loadStorageIdentityKey(databasePath)).toBe(created)
	})

	test('missing and legacy deterministic identities fail closed', () => {
		const missingPath = join(temporaryDirectory(), 'wallet.db')
		expect(() => loadStorageIdentityKey(missingPath)).toThrow(
			'missing its local storage identity',
		)

		const legacyPath = join(temporaryDirectory(), 'wallet.db')
		writeSettings(legacyPath, `1sat-wallet:${'02'.repeat(33)}`)
		expect(() => loadStorageIdentityKey(legacyPath)).toThrow(
			'invalid local storage identity',
		)

		const corruptPath = join(temporaryDirectory(), 'wallet.db')
		const corruptDatabase = new Database(corruptPath)
		corruptDatabase.exec('CREATE TABLE unrelated (value TEXT)')
		corruptDatabase.close()
		expect(() => loadStorageIdentityKey(corruptPath)).toThrow(
			'no readable local storage identity',
		)
	})

	test('identity is absent from WebView config and RPC source surfaces', () => {
		const directory = temporaryDirectory()
		const walletDatabasePath = join(directory, 'wallet.db')
		const storageIdentityKey = createStorageIdentityKey()
		writeSettings(walletDatabasePath, storageIdentityKey)
		expect(loadStorageIdentityKey(walletDatabasePath)).toBe(storageIdentityKey)

		for (const relativePath of [
			'./config-store.ts',
			'./rpc-handlers.ts',
			'../preloads/cwi.ts',
			'../mainview/rpc.ts',
			'../shared/types.ts',
		]) {
			const source = readFileSync(
				new URL(relativePath, import.meta.url),
				'utf8',
			)
			expect(source).not.toContain('storageIdentityKey')
		}
	})
})
