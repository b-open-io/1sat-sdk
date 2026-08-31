import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	createStorageIdentityKey,
	loadStorageIdentityKey,
	loadWalletUserIdentityKey,
	prepareStorageIdentityKey,
	sweepStaleStorageIdentityFiles,
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
		const first = createStorageIdentityKey()
		const second = createStorageIdentityKey()

		expect(first).toMatch(/^1sat-wallet-[0-9a-f]{32}$/)
		expect(second).toMatch(/^1sat-wallet-[0-9a-f]{32}$/)
		expect(first).not.toBe(second)
	})

	test('reopen uses the exact identity persisted by the account database', () => {
		const databasePath = join(temporaryDirectory(), 'wallet.db')
		const created = createStorageIdentityKey()
		writeSettings(databasePath, created)

		expect(loadStorageIdentityKey(databasePath)).toBe(created)
	})

	test('wallet user identity requires exactly one database user', () => {
		const databasePath = join(temporaryDirectory(), 'wallet.db')
		const storageIdentityKey = createStorageIdentityKey()
		writeSettings(databasePath, storageIdentityKey)
		const database = new Database(databasePath)
		database.exec('CREATE TABLE users (identityKey TEXT NOT NULL)')
		database.query('INSERT INTO users (identityKey) VALUES (?)').run('root-key')
		database.close()

		expect(loadWalletUserIdentityKey(databasePath)).toBe('root-key')

		const second = new Database(databasePath)
		second.query('INSERT INTO users (identityKey) VALUES (?)').run('other-key')
		second.close()
		expect(() => loadWalletUserIdentityKey(databasePath)).toThrow(
			'exactly one wallet user',
		)
	})

	test('interrupted first setup leaves no final database and retry succeeds', async () => {
		const databasePath = join(temporaryDirectory(), 'wallet.db')
		let interruptedPath = ''

		await expect(
			prepareStorageIdentityKey(databasePath, async (stagedPath) => {
				interruptedPath = stagedPath
				const database = new Database(stagedPath)
				database.exec('CREATE TABLE incomplete (value TEXT)')
				database.close()
				throw new Error('interrupted setup')
			}),
		).rejects.toThrow('interrupted setup')

		expect(existsSync(databasePath)).toBe(false)
		expect(existsSync(interruptedPath)).toBe(false)

		const storageIdentityKey = await prepareStorageIdentityKey(
			databasePath,
			async (stagedPath, identityKey) => {
				writeSettings(stagedPath, identityKey)
			},
		)

		expect(loadStorageIdentityKey(databasePath)).toBe(storageIdentityKey)
		expect(statSync(databasePath).mode & 0o777).toBe(0o600)
	})

	test('concurrent first setup converges on the identity published first', async () => {
		const databasePath = join(temporaryDirectory(), 'wallet.db')
		let ready = 0
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const initialize = async (stagedPath: string, identityKey: string) => {
			writeSettings(stagedPath, identityKey)
			ready++
			if (ready === 2) release()
			await gate
		}

		const [first, second] = await Promise.all([
			prepareStorageIdentityKey(databasePath, initialize),
			prepareStorageIdentityKey(databasePath, initialize),
		])

		expect(first).toBe(second)
		expect(loadStorageIdentityKey(databasePath)).toBe(first)
	})

	test('missing, legacy, and corrupt databases fail closed', async () => {
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

		let initialized = false
		await expect(
			prepareStorageIdentityKey(corruptPath, async () => {
				initialized = true
			}),
		).rejects.toThrow('no readable local storage identity')
		expect(initialized).toBe(false)
	})

	test('stale sweep removes only validated regular staging database files', () => {
		const root = temporaryDirectory()
		const accountsRoot = join(root, 'accounts')
		const accountPath = join(accountsRoot, '0123abcd')
		const invalidAccountPath = join(accountsRoot, 'not-an-account')
		mkdirSync(accountPath, { recursive: true })
		mkdirSync(invalidAccountPath, { recursive: true })

		const stem = 'wallet.db.creating-0123456789abcdef'
		for (const suffix of ['', '-wal', '-shm']) {
			writeFileSync(join(accountPath, `${stem}${suffix}`), '')
		}
		for (const filename of [
			`${stem}.tasks.json`,
			'wallet.db.creating-short',
			'wallet.db',
		]) {
			writeFileSync(join(accountPath, filename), '')
		}
		const invalidAccountFile = join(invalidAccountPath, stem)
		writeFileSync(invalidAccountFile, '')
		const symlinkPath = join(accountPath, 'wallet.db.creating-fedcba9876543210')
		symlinkSync(join(accountPath, 'wallet.db'), symlinkPath)

		expect(sweepStaleStorageIdentityFiles(accountsRoot)).toBe(3)
		expect(existsSync(join(accountPath, stem))).toBe(false)
		expect(existsSync(`${join(accountPath, stem)}-wal`)).toBe(false)
		expect(existsSync(`${join(accountPath, stem)}-shm`)).toBe(false)
		expect(existsSync(join(accountPath, `${stem}.tasks.json`))).toBe(true)
		expect(existsSync(invalidAccountFile)).toBe(true)
		expect(existsSync(symlinkPath)).toBe(true)
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

	test('startup does not migrate unsupported legacy wallets', () => {
		const indexSource = readFileSync(
			new URL('./index.ts', import.meta.url),
			'utf8',
		)
		const managerSource = readFileSync(
			new URL('./wallet-manager.ts', import.meta.url),
			'utf8',
		)
		const vaultSource = readFileSync(
			new URL('./vault-manager.ts', import.meta.url),
			'utf8',
		)
		const backupSource = readFileSync(
			new URL('./backup-import.ts', import.meta.url),
			'utf8',
		)
		const rpcSource = readFileSync(
			new URL('./rpc-handlers.ts', import.meta.url),
			'utf8',
		)

		expect(indexSource).not.toContain('migrateLegacyWallet')
		expect(indexSource).not.toContain('legacyVaultLabel')
		expect(managerSource).not.toContain('function migrateLegacyWallet')
		expect(managerSource).not.toContain("const prefix = 'g1sat-wallet-'")
		expect(managerSource).toContain("const prefix = '1sat-wallet-'")
		expect(vaultSource).not.toContain('function legacyVaultLabel')
		expect(backupSource).toContain('installImportedAccount')
		expect(backupSource).not.toContain('protectRootKey')
		expect(backupSource).not.toContain('createDesktopVault')
		expect(managerSource).toContain('withAccountSingleFlight(accountId')
		expect(managerSource).toContain('if (!existingAccount) addAccount(account)')
		expect(rpcSource).not.toContain('addAccount(')
	})
})
