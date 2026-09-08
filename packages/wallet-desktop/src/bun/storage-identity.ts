import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import type { Dirent } from 'node:fs'
import {
	chmodSync,
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	statSync,
	unlinkSync,
} from 'node:fs'

const STORAGE_IDENTITY_PATTERN = /^1sat-wallet-[0-9a-f]{32}$/
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}$/

export function createStorageIdentityKey(): string {
	return `1sat-wallet-${randomBytes(16).toString('hex')}`
}

export interface AccountStorageLease {
	readonly accountId: string
	release(): void
}

/**
 * Retain an OS-released, cross-process lease while an account database is in
 * use. Lease files are persistent and must never be unlinked or replaced.
 */
export function acquireAccountStorageLease(
	accountsRoot: string,
	accountId: string,
): AccountStorageLease {
	if (!ACCOUNT_ID_PATTERN.test(accountId)) {
		throw new Error('Invalid account ID for storage lease')
	}
	mkdirSync(accountsRoot, { recursive: true, mode: 0o700 })
	chmodSync(accountsRoot, 0o700)
	const leaseDirectory = `${accountsRoot}/.leases`
	mkdirSync(leaseDirectory, { recursive: true, mode: 0o700 })
	chmodSync(leaseDirectory, 0o700)
	const leasePath = `${leaseDirectory}/${accountId}.sqlite`
	const database = new Database(leasePath, { create: true })
	let locked = false
	try {
		chmodSync(leasePath, 0o600)
		database.exec('PRAGMA busy_timeout = 0')
		database.exec('BEGIN IMMEDIATE')
		locked = true
	} catch (error) {
		database.close()
		const message = error instanceof Error ? error.message : String(error)
		if (/busy|locked/i.test(message)) {
			throw new Error('Wallet account is open in another app process')
		}
		throw error
	}

	let released = false
	return {
		accountId,
		release: () => {
			if (released) return
			released = true
			try {
				if (locked) database.exec('ROLLBACK')
			} finally {
				locked = false
				database.close()
			}
		},
	}
}

export async function withStorageLifecycleLock<T>(
	accountsRoot: string,
	operation: () => Promise<T> | T,
	busyTimeoutMs = 30_000,
): Promise<T> {
	mkdirSync(accountsRoot, { recursive: true, mode: 0o700 })
	chmodSync(accountsRoot, 0o700)
	const coordinatorPath = `${accountsRoot}/.lifecycle.sqlite`
	const coordinator = new Database(coordinatorPath, { create: true })
	chmodSync(coordinatorPath, 0o600)
	const timeout = Math.max(0, Math.min(Math.trunc(busyTimeoutMs), 30_000))
	let locked = false
	try {
		coordinator.exec(`PRAGMA busy_timeout = ${timeout}`)
		coordinator.exec('BEGIN IMMEDIATE')
		locked = true
		return await operation()
	} finally {
		try {
			if (locked) coordinator.exec('ROLLBACK')
		} finally {
			coordinator.close()
		}
	}
}

export function loadStorageIdentityKey(databasePath: string): string {
	if (!existsSync(databasePath)) {
		throw new Error('Wallet database is missing its local storage identity')
	}

	const database = new Database(databasePath, { readonly: true })
	try {
		const row = database
			.query<{ storageIdentityKey: string }, []>(
				'SELECT storageIdentityKey FROM settings LIMIT 1',
			)
			.get()
		const storageIdentityKey = row?.storageIdentityKey
		if (
			typeof storageIdentityKey !== 'string' ||
			!STORAGE_IDENTITY_PATTERN.test(storageIdentityKey)
		) {
			throw new Error('Wallet database has an invalid local storage identity')
		}
		return storageIdentityKey
	} catch (error) {
		if (error instanceof Error && error.message.includes('storage identity')) {
			throw error
		}
		throw new Error(
			`Wallet database has no readable local storage identity: ${error instanceof Error ? error.message : String(error)}`,
		)
	} finally {
		database.close()
	}
}

export function loadWalletUserIdentityKey(databasePath: string): string {
	loadStorageIdentityKey(databasePath)
	const database = new Database(databasePath, { readonly: true })
	try {
		const rows = database
			.query<{ identityKey: string }, []>('SELECT identityKey FROM users')
			.all()
		if (rows.length !== 1 || typeof rows[0]?.identityKey !== 'string') {
			throw new Error(
				'Wallet database does not contain exactly one wallet user',
			)
		}
		return rows[0].identityKey
	} finally {
		database.close()
	}
}

function removeStagedDatabase(databasePath: string): void {
	for (const suffix of ['', '-wal', '-shm', '.tasks.json']) {
		const path = `${databasePath}${suffix}`
		if (existsSync(path)) unlinkSync(path)
	}
}

/**
 * Initialize a new database off-path and publish it only after setup succeeds.
 * Existing databases are never replaced or repaired here.
 */
export async function prepareStorageIdentityKey(
	databasePath: string,
	initialize: (
		stagedDatabasePath: string,
		storageIdentityKey: string,
	) => Promise<void>,
): Promise<string> {
	if (existsSync(databasePath)) return loadStorageIdentityKey(databasePath)

	const storageIdentityKey = createStorageIdentityKey()
	const stagedDatabasePath = `${databasePath}.creating-${process.pid}-${Date.now()}-${randomBytes(8).toString('hex')}`

	try {
		await initialize(stagedDatabasePath, storageIdentityKey)
		chmodSync(stagedDatabasePath, 0o600)
		if (existsSync(`${stagedDatabasePath}-wal`)) {
			throw new Error('Staged wallet database is still open')
		}

		try {
			// Hard-link publication is atomic and never replaces another completed create.
			linkSync(stagedDatabasePath, databasePath)
		} catch (error) {
			if ((error as { code?: string }).code !== 'EEXIST') throw error
			return loadStorageIdentityKey(databasePath)
		}
		unlinkSync(stagedDatabasePath)
		return storageIdentityKey
	} finally {
		removeStagedDatabase(stagedDatabasePath)
	}
}

const ACCOUNT_DIRECTORY_PATTERN = /^[0-9a-f]{8}$/
const OWNED_STAGED_DATABASE_PATTERN =
	/^wallet\.db\.creating-(\d+)-(\d{13})-[0-9a-f]{16}(?:-wal|-shm)?$/
const LEGACY_STAGED_DATABASE_PATTERN =
	/^wallet\.db\.creating-[0-9a-f]{16}(?:-wal|-shm)?$/
const DEFAULT_STALE_STAGE_AGE_MS = 24 * 60 * 60 * 1000

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as { code?: string }).code === 'EPERM'
	}
}

/** Remove only staging files created by prepareStorageIdentityKey. */
export function sweepStaleStorageIdentityFiles(
	accountsRoot: string,
	options: {
		isProcessAlive?: (pid: number) => boolean
		now?: number
		staleAfterMs?: number
	} = {},
): number {
	if (!existsSync(accountsRoot)) return 0
	const now = options.now ?? Date.now()
	const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_STAGE_AGE_MS
	const isProcessAlive = options.isProcessAlive ?? processIsAlive
	let removed = 0
	let accountEntries: Dirent[]
	try {
		accountEntries = readdirSync(accountsRoot, { withFileTypes: true })
	} catch {
		return 0
	}

	for (const accountEntry of accountEntries) {
		if (
			!accountEntry.isDirectory() ||
			!ACCOUNT_DIRECTORY_PATTERN.test(accountEntry.name)
		) {
			continue
		}
		const accountPath = `${accountsRoot}/${accountEntry.name}`
		let filenames: string[]
		try {
			filenames = readdirSync(accountPath)
		} catch {
			continue
		}
		for (const filename of filenames) {
			const path = `${accountPath}/${filename}`
			try {
				if (!lstatSync(path).isFile()) continue
				const ownedMatch = filename.match(OWNED_STAGED_DATABASE_PATTERN)
				if (ownedMatch) {
					const ownerPid = Number(ownedMatch[1])
					const createdAt = Number(ownedMatch[2])
					if (
						!Number.isSafeInteger(ownerPid) ||
						!Number.isSafeInteger(createdAt) ||
						now - createdAt < staleAfterMs ||
						isProcessAlive(ownerPid)
					) {
						continue
					}
				} else if (LEGACY_STAGED_DATABASE_PATTERN.test(filename)) {
					if (now - statSync(path).mtimeMs < staleAfterMs) continue
				} else {
					continue
				}
				unlinkSync(path)
				removed++
			} catch {
				// The entry disappeared or became unsafe while the directory was scanned.
			}
		}
	}

	return removed
}
