/**
 * Host account registry — the one row the host keeps per identity.
 *
 * An account is created by registering a username. The username is the
 * identity's handle on the host's user paymail domain (e.g. alice@1sat.app)
 * and is permanent: one username per identity, one identity per username,
 * no renames. Display name and avatar are editable presentation fields
 * served by the paymail public-profile capability.
 *
 * Storage capacity is *not* recorded here — it stays derived from the host
 * wallet's payment labels (see ./queries.ts).
 */

import type { Knex } from 'knex'

/** Lowercase label: 3-63 chars, alphanumeric ends, no leading/trailing hyphen. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

/** `txid_vout` origin of an image ordinal. */
export const AVATAR_ORIGIN_RE = /^[0-9a-f]{64}_\d+$/

export const DISPLAY_NAME_MAX = 64

export function normalizeUsername(input: unknown): string | null {
	if (typeof input !== 'string') return null
	const name = input.trim().toLowerCase()
	return USERNAME_RE.test(name) ? name : null
}

/**
 * Trim and bound a display name. Empty string clears the field (returns
 * null); non-strings and over-long values are invalid (undefined).
 */
export function normalizeDisplayName(
	input: unknown,
): string | null | undefined {
	if (input === null) return null
	if (typeof input !== 'string') return undefined
	const name = input.trim()
	if (name === '') return null
	if (name.length > DISPLAY_NAME_MAX) return undefined
	return name
}

/** Same contract as normalizeDisplayName for an avatar origin. */
export function normalizeAvatarOrigin(
	input: unknown,
): string | null | undefined {
	if (input === null) return null
	if (typeof input !== 'string') return undefined
	const origin = input.trim().toLowerCase()
	if (origin === '') return null
	return AVATAR_ORIGIN_RE.test(origin) ? origin : undefined
}

export interface Account {
	identityKey: string
	username: string
	displayName?: string
	avatarOrigin?: string
	createdAt: Date
	updatedAt: Date
}

export interface AccountProfile {
	/** `null` clears the field; `undefined` leaves it unchanged. */
	displayName?: string | null
	avatarOrigin?: string | null
}

export class UsernameTakenError extends Error {
	constructor(username: string) {
		super(`username "${username}" is already registered`)
		this.name = 'UsernameTakenError'
	}
}

export class AlreadyRegisteredError extends Error {
	constructor(username: string) {
		super(`identity is already registered as "${username}"`)
		this.name = 'AlreadyRegisteredError'
	}
}

export class NotRegisteredError extends Error {
	constructor() {
		super('identity has no registered account')
		this.name = 'NotRegisteredError'
	}
}

export interface AccountStore {
	getByIdentity(identityKey: string): Promise<Account | null>
	getByUsername(username: string): Promise<Account | null>
	/**
	 * Create the account. Idempotent when the identity already holds this
	 * exact username; throws AlreadyRegisteredError when it holds another,
	 * UsernameTakenError when someone else holds this one.
	 */
	register(
		identityKey: string,
		username: string,
		profile?: AccountProfile,
	): Promise<Account>
	/** Update presentation fields. Throws NotRegisteredError. */
	updateProfile(identityKey: string, profile: AccountProfile): Promise<Account>
}

interface AccountRow {
	identity_key: string
	username: string
	display_name: string | null
	avatar_origin: string | null
	created_at: string
	updated_at: string
}

function rowToAccount(row: AccountRow): Account {
	return {
		identityKey: row.identity_key,
		username: row.username,
		...(row.display_name && { displayName: row.display_name }),
		...(row.avatar_origin && { avatarOrigin: row.avatar_origin }),
		createdAt: new Date(row.created_at),
		updatedAt: new Date(row.updated_at),
	}
}

function profileColumns(profile: AccountProfile): Partial<AccountRow> {
	const cols: Partial<AccountRow> = {}
	if (profile.displayName !== undefined) {
		cols.display_name = profile.displayName
	}
	if (profile.avatarOrigin !== undefined) {
		cols.avatar_origin = profile.avatarOrigin
	}
	return cols
}

export class KnexAccountStore implements AccountStore {
	constructor(private db: Knex) {}

	async init(): Promise<void> {
		const has = await this.db.schema.hasTable('accounts')
		if (!has) {
			await this.db.schema.createTable('accounts', (t) => {
				t.string('identity_key').primary()
				t.string('username').notNullable().unique()
				t.string('display_name').nullable()
				t.string('avatar_origin').nullable()
				t.string('created_at').notNullable()
				t.string('updated_at').notNullable()
			})
		}
	}

	async getByIdentity(identityKey: string): Promise<Account | null> {
		const row = await this.db<AccountRow>('accounts')
			.where({ identity_key: identityKey })
			.first()
		return row ? rowToAccount(row) : null
	}

	async getByUsername(username: string): Promise<Account | null> {
		const row = await this.db<AccountRow>('accounts')
			.where({ username: username.toLowerCase() })
			.first()
		return row ? rowToAccount(row) : null
	}

	async register(
		identityKey: string,
		username: string,
		profile: AccountProfile = {},
	): Promise<Account> {
		const name = username.toLowerCase()
		const mine = await this.getByIdentity(identityKey)
		if (mine) {
			if (mine.username === name) return mine
			throw new AlreadyRegisteredError(mine.username)
		}
		const held = await this.getByUsername(name)
		if (held) throw new UsernameTakenError(name)

		const now = new Date().toISOString()
		try {
			await this.db('accounts').insert({
				identity_key: identityKey,
				username: name,
				display_name: null,
				avatar_origin: null,
				...profileColumns(profile),
				created_at: now,
				updated_at: now,
			})
		} catch (err) {
			// Unique-constraint race between the checks above and the insert.
			const mineNow = await this.getByIdentity(identityKey)
			if (mineNow) {
				if (mineNow.username === name) return mineNow
				throw new AlreadyRegisteredError(mineNow.username)
			}
			if (await this.getByUsername(name)) throw new UsernameTakenError(name)
			throw err
		}
		const created = await this.getByIdentity(identityKey)
		if (!created) throw new Error('account insert did not persist')
		return created
	}

	async updateProfile(
		identityKey: string,
		profile: AccountProfile,
	): Promise<Account> {
		const cols = profileColumns(profile)
		if (Object.keys(cols).length > 0) {
			const updated = await this.db('accounts')
				.where({ identity_key: identityKey })
				.update({ ...cols, updated_at: new Date().toISOString() })
			if (updated === 0) throw new NotRegisteredError()
		}
		const account = await this.getByIdentity(identityKey)
		if (!account) throw new NotRegisteredError()
		return account
	}
}
