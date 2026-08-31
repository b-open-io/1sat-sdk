import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, linkSync, unlinkSync } from 'node:fs'

const STORAGE_IDENTITY_PATTERN = /^1sat-wallet-[0-9a-f]{32}$/

export function createStorageIdentityKey(): string {
	return `1sat-wallet-${randomBytes(16).toString('hex')}`
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
	const stagedDatabasePath = `${databasePath}.creating-${randomBytes(8).toString('hex')}`

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
