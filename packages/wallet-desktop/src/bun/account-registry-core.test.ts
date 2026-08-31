import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountRegistry, type RegistryStore } from './account-registry-core'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
	const path = mkdtempSync(join(tmpdir(), '1sat-account-registry-'))
	temporaryDirectories.push(path)
	return path
}

class SqliteRegistryStore implements RegistryStore {
	private readonly database: Database

	constructor(path: string) {
		this.database = new Database(path, { create: true })
		this.database.exec(
			'CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
		)
	}

	get(key: string): string | undefined {
		return this.database
			.query<{ value: string }, [string]>(
				'SELECT value FROM config WHERE key = ?',
			)
			.get(key)?.value
	}

	set(key: string, value: string): void {
		this.database
			.query('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
			.run(key, value)
	}

	close(): void {
		this.database.close()
	}
}

afterEach(() => {
	for (const path of temporaryDirectories.splice(0)) {
		rmSync(path, { recursive: true, force: true })
	}
})

describe('desktop account registry coordination', () => {
	test('separate stale processes preserve both registry updates', async () => {
		const root = temporaryDirectory()
		const accountsRoot = join(root, 'accounts')
		const configPath = join(root, 'config.sqlite')
		const setupStore = new SqliteRegistryStore(configPath)
		const setupRegistry = new AccountRegistry(setupStore, accountsRoot)
		await setupRegistry.addAccount({
			id: '0123abcd',
			identityKey: 'identity-a',
			displayName: 'Original A',
			color: 'blue',
			createdAt: '2026-01-01T00:00:00.000Z',
			lastUsedAt: '2026-01-01T00:00:00.000Z',
		})
		await setupRegistry.addAccount({
			id: '89abcdef',
			identityKey: 'identity-b',
			displayName: 'Original B',
			color: 'violet',
			createdAt: '2026-01-01T00:00:00.000Z',
			lastUsedAt: '2026-01-01T00:00:00.000Z',
		})
		setupStore.close()

		const barrierPath = join(root, 'go')
		const modulePath = join(import.meta.dir, 'account-registry-core.ts')
		const childScript = (accountId: string, displayName: string) =>
			`import { Database } from 'bun:sqlite'; import { existsSync } from 'node:fs'; import { AccountRegistry } from ${JSON.stringify(modulePath)}; const db = new Database(${JSON.stringify(configPath)}); db.exec('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)'); const store = { get(key) { return db.query('SELECT value FROM config WHERE key = ?').get(key)?.value }, set(key, value) { db.query('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value) } }; const registry = new AccountRegistry(store, ${JSON.stringify(accountsRoot)}); registry.listAccounts(); console.log('ready'); while (!existsSync(${JSON.stringify(barrierPath)})) await Bun.sleep(5); await registry.updateAccount(${JSON.stringify(accountId)}, { displayName: ${JSON.stringify(displayName)} }); db.close();`
		const first = Bun.spawn(
			[process.execPath, '-e', childScript('0123abcd', 'Updated A')],
			{ stdout: 'pipe' },
		)
		const second = Bun.spawn(
			[process.execPath, '-e', childScript('89abcdef', 'Updated B')],
			{ stdout: 'pipe' },
		)
		for (const child of [first, second]) {
			const output = await child.stdout.getReader().read()
			expect(new TextDecoder().decode(output.value)).toContain('ready')
		}
		writeFileSync(barrierPath, '')
		expect(await first.exited).toBe(0)
		expect(await second.exited).toBe(0)

		const verifyStore = new SqliteRegistryStore(configPath)
		const verified = new AccountRegistry(
			verifyStore,
			accountsRoot,
		).listAccounts()
		expect(
			verified.find((account) => account.id === '0123abcd')?.displayName,
		).toBe('Updated A')
		expect(
			verified.find((account) => account.id === '89abcdef')?.displayName,
		).toBe('Updated B')
		verifyStore.close()
	})
})
