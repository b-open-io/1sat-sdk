import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	acquireAccountStorageLease,
	createStorageIdentityKey,
	loadStorageIdentityKey,
	loadWalletUserIdentityKey,
	prepareStorageIdentityKey,
	sweepStaleStorageIdentityFiles,
	withStorageLifecycleLock,
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

	test('coordinator database excludes another connection and releases cleanly', async () => {
		const accountsRoot = join(temporaryDirectory(), 'accounts')
		await withStorageLifecycleLock(accountsRoot, () => {})
		const coordinatorPath = join(accountsRoot, '.lifecycle.sqlite')
		const holder = new Database(coordinatorPath)
		holder.exec('BEGIN IMMEDIATE')

		await expect(
			withStorageLifecycleLock(accountsRoot, () => 'unexpected', 0),
		).rejects.toThrow()
		holder.exec('ROLLBACK')
		holder.close()

		expect(
			await withStorageLifecycleLock(accountsRoot, () => 'acquired', 0),
		).toBe('acquired')
		expect(statSync(coordinatorPath).mode & 0o777).toBe(0o600)
	})

	test('coordinator database excludes another process until it exits', async () => {
		const accountsRoot = join(temporaryDirectory(), 'accounts')
		await withStorageLifecycleLock(accountsRoot, () => {})
		const coordinatorPath = join(accountsRoot, '.lifecycle.sqlite')
		const child = Bun.spawn(
			[
				process.execPath,
				'-e',
				`import { Database } from 'bun:sqlite'; const db = new Database(${JSON.stringify(coordinatorPath)}); db.exec('BEGIN IMMEDIATE'); console.log('locked'); await Bun.sleep(300); db.exec('ROLLBACK'); db.close();`,
			],
			{ stdout: 'pipe' },
		)
		const reader = child.stdout.getReader()
		const firstOutput = await reader.read()
		expect(new TextDecoder().decode(firstOutput.value)).toContain('locked')

		await expect(
			withStorageLifecycleLock(accountsRoot, () => 'unexpected', 0),
		).rejects.toThrow()
		expect(await child.exited).toBe(0)
		expect(
			await withStorageLifecycleLock(accountsRoot, () => 'acquired', 0),
		).toBe('acquired')
	})

	test('account lease blocks another process and crash-releases', async () => {
		const accountsRoot = join(temporaryDirectory(), 'accounts')
		const modulePath = join(import.meta.dir, 'storage-identity.ts')
		const child = Bun.spawn(
			[
				process.execPath,
				'-e',
				`import { acquireAccountStorageLease } from ${JSON.stringify(modulePath)}; const lease = acquireAccountStorageLease(${JSON.stringify(accountsRoot)}, '0123abcd'); console.log('leased'); await Bun.sleep(60_000); lease.release();`,
			],
			{ stdout: 'pipe' },
		)
		const reader = child.stdout.getReader()
		const firstOutput = await reader.read()
		expect(new TextDecoder().decode(firstOutput.value)).toContain('leased')

		expect(() => acquireAccountStorageLease(accountsRoot, '0123abcd')).toThrow(
			'open in another app process',
		)
		child.kill()
		await child.exited

		const recovered = acquireAccountStorageLease(accountsRoot, '0123abcd')
		recovered.release()
		expect(
			statSync(join(accountsRoot, '.leases', '0123abcd.sqlite')).mode & 0o777,
		).toBe(0o600)
	})

	test('delete takes or retains the account lease before removing storage', () => {
		const managerSource = readFileSync(
			new URL('./wallet-manager.ts', import.meta.url),
			'utf8',
		)
		const start = managerSource.indexOf('export async function deleteWallet')
		const end = managerSource.indexOf(
			'// ============================================================================',
			start,
		)
		const deleteSource = managerSource.slice(start, end)
		const leaseIndex = deleteSource.indexOf('acquireAccountStorageLease')
		const vaultDeleteIndex = deleteSource.indexOf('removeStoredKey')
		const databaseDeleteIndex = deleteSource.indexOf('unlinkSync')

		expect(leaseIndex).toBeGreaterThan(-1)
		expect(leaseIndex).toBeLessThan(vaultDeleteIndex)
		expect(leaseIndex).toBeLessThan(databaseDeleteIndex)
		expect(deleteSource).toContain('storageLease.release()')
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
		const now = 1_700_000_000_000
		const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000
		const root = temporaryDirectory()
		const accountsRoot = join(root, 'accounts')
		const accountPath = join(accountsRoot, '0123abcd')
		const invalidAccountPath = join(accountsRoot, 'not-an-account')
		mkdirSync(accountPath, { recursive: true })
		mkdirSync(invalidAccountPath, { recursive: true })

		const stem = 'wallet.db.creating-0123456789abcdef'
		for (const suffix of ['', '-wal', '-shm']) {
			const path = join(accountPath, `${stem}${suffix}`)
			writeFileSync(path, '')
			utimesSync(path, twoDaysAgo / 1000, twoDaysAgo / 1000)
		}
		const activeStem = `wallet.db.creating-4242-${twoDaysAgo}-0123456789abcdef`
		const staleDeadStem = `wallet.db.creating-5252-${twoDaysAgo}-0123456789abcdef`
		const youngDeadStem = `wallet.db.creating-5252-${now - 100}-fedcba9876543210`
		for (const suffix of ['', '-wal', '-shm']) {
			writeFileSync(join(accountPath, `${activeStem}${suffix}`), '')
			writeFileSync(join(accountPath, `${staleDeadStem}${suffix}`), '')
		}
		writeFileSync(join(accountPath, youngDeadStem), '')
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

		expect(
			sweepStaleStorageIdentityFiles(accountsRoot, {
				now,
				isProcessAlive: (pid) => pid === 4242,
			}),
		).toBe(6)
		expect(existsSync(join(accountPath, stem))).toBe(false)
		expect(existsSync(`${join(accountPath, stem)}-wal`)).toBe(false)
		expect(existsSync(`${join(accountPath, stem)}-shm`)).toBe(false)
		expect(existsSync(join(accountPath, `${stem}.tasks.json`))).toBe(true)
		expect(existsSync(join(accountPath, activeStem))).toBe(true)
		expect(existsSync(join(accountPath, `${activeStem}-wal`))).toBe(true)
		expect(existsSync(join(accountPath, `${activeStem}-shm`))).toBe(true)
		expect(existsSync(join(accountPath, staleDeadStem))).toBe(false)
		expect(existsSync(join(accountPath, youngDeadStem))).toBe(true)
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
		const registrySource = readFileSync(
			new URL('./account-registry-core.ts', import.meta.url),
			'utf8',
		)

		expect(indexSource).not.toContain('migrateLegacyWallet')
		expect(indexSource).not.toContain('legacyVaultLabel')
		expect(managerSource).not.toContain('function migrateLegacyWallet')
		expect(managerSource).not.toContain("const prefix = 'g1sat-wallet-'")
		expect(managerSource).toContain("const prefix = '1sat-wallet-'")
		expect(vaultSource).not.toContain('function legacyVaultLabel')
		expect(backupSource).toContain('installImportedAccount')
		expect(backupSource).toContain('decodeBapAccountBackup')
		expect(backupSource).not.toContain('protectRootKey')
		expect(backupSource).not.toContain('createDesktopVault')
		expect(managerSource).toContain('withAccountSingleFlight(accountId')
		expect(managerSource).toContain('withStorageLifecycleLock(root')
		expect(managerSource).toContain('acquireAccountStorageLease(accountsRoot()')
		expect(managerSource).toContain('await addAccount(account)')
		expect(rpcSource).not.toContain('addAccount(')
		expect(registrySource).toContain('withStorageLifecycleLock')
		expect(registrySource).toContain('this.reload()')
	})
})
