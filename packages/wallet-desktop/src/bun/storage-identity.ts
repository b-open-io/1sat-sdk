import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'

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

/** New databases get a random provider identity; existing ones must reuse theirs. */
export function storageIdentityKeyForCreate(databasePath: string): string {
	return existsSync(databasePath)
		? loadStorageIdentityKey(databasePath)
		: createStorageIdentityKey()
}
